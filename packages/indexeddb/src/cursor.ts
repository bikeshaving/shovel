/**
 * IDBCursor and IDBCursorWithValue implementations.
 *
 * These classes provide the cursor interface used by object stores and indexes.
 * Backend cursors handle data traversal; these wrappers handle key decoding,
 * value decoding, and event integration (continue/advance fire success events).
 */

import {type IDBTransaction, kHoldOpen, kRelease} from "./transaction.js";
import {IDBRequest} from "./request.js";
import {encodeKey, decodeKey, validateKey, compareKeys, extractKeyFromValue} from "./key.js";
import {encodeValue, decodeValue} from "./structured-clone.js";
import {
	DataError,
	InvalidStateError,
	TransactionInactiveError,
	ReadOnlyError,
} from "./errors.js";
import type {IDBBackendCursor} from "./backend.js";

/**
 * IDBCursor — iterates over records without values.
 */
export class IDBCursor {
	_backendCursor: IDBBackendCursor;
	_request: IDBRequest;
	_transaction: IDBTransaction;
	_source: any;
	_direction: IDBCursorDirection;
	_gotValue: boolean;
	// Snapshot of cursor state before advance/continue — serves old values until success fires
	_keySnapshot: Uint8Array | null = null;
	_primaryKeySnapshot: Uint8Array | null = null;
	// Cached decoded keys — same object returned on repeated access (spec requirement)
	_cachedKey: any = undefined;
	_cachedKeySource: Uint8Array | null = null;
	_cachedPrimaryKey: any = undefined;
	_cachedPrimaryKeySource: Uint8Array | null = null;

	constructor(
		backendCursor: IDBBackendCursor,
		request: IDBRequest,
		transaction: IDBTransaction,
		source: any,
		direction: IDBCursorDirection = "next",
	) {
		this._backendCursor = backendCursor;
		this._request = request;
		this._transaction = transaction;
		this._source = source;
		this._direction = direction;
		this._gotValue = true;
	}

	get [Symbol.toStringTag](): string {
		return "IDBCursor";
	}

	get key(): IDBValidKey {
		const raw = this._keySnapshot ?? this._backendCursor.key;
		if (this._cachedKeySource === raw && this._cachedKey !== undefined) {
			return this._cachedKey;
		}
		this._cachedKey = decodeKey(raw);
		this._cachedKeySource = raw;
		return this._cachedKey;
	}

	get primaryKey(): IDBValidKey {
		const raw = this._primaryKeySnapshot ?? this._backendCursor.primaryKey;
		if (this._cachedPrimaryKeySource === raw && this._cachedPrimaryKey !== undefined) {
			return this._cachedPrimaryKey;
		}
		this._cachedPrimaryKey = decodeKey(raw);
		this._cachedPrimaryKeySource = raw;
		return this._cachedPrimaryKey;
	}

	get source(): any {
		return this._source;
	}

	get direction(): IDBCursorDirection {
		return this._direction;
	}

	get request(): IDBRequest {
		return this._request;
	}

	continue(key?: IDBValidKey): void {
		if (!this._transaction._active) {
			throw TransactionInactiveError("Transaction is not active");
		}
		if (this._source._deleted || (this._source.objectStore && this._source.objectStore._deleted)) {
			throw InvalidStateError("The cursor's source or effective object store has been deleted");
		}
		if (!this._gotValue) {
			throw InvalidStateError("Cursor is not pointing at a value");
		}
		let targetKey: Uint8Array | undefined;
		if (key !== undefined) {
			const validated = validateKey(key);
			const encoded = encodeKey(validated);
			// Validate key direction — key must be strictly in cursor's direction
			const cmp = compareKeys(encoded, this._backendCursor.key);
			if (this._direction === "next" || this._direction === "nextunique") {
				if (cmp <= 0) {
					throw DataError(
						"The key is less than or equal to the cursor's current key",
					);
				}
			} else {
				if (cmp >= 0) {
					throw DataError(
						"The key is greater than or equal to the cursor's current key",
					);
				}
			}
			targetKey = encoded;
		}
		this._gotValue = false;
		// Snapshot current state before advancing
		this._keySnapshot = this._backendCursor.key;
		this._primaryKeySnapshot = this._backendCursor.primaryKey;
		this._snapshotValue();
		this._transaction[kHoldOpen]();
		// Advance cursor — if a target key was provided, advance until we reach/pass it
		let found = false;
		if (targetKey) {
			while (this._backendCursor.continue()) {
				const cmp = compareKeys(this._backendCursor.key, targetKey);
				if (this._direction === "next" || this._direction === "nextunique") {
					if (cmp >= 0) { found = true; break; }
				} else {
					if (cmp <= 0) { found = true; break; }
				}
			}
		} else {
			found = this._backendCursor.continue();
		}
		queueMicrotask(() => {
			// Clear snapshots — getters now read from backend cursor
			this._keySnapshot = null;
			this._primaryKeySnapshot = null;
			this._clearKeyCache();
			this._clearValueSnapshot();
			if (found) this._gotValue = true;
			this._request._resolve(found ? this : null);
			this._transaction[kRelease]();
		});
	}

	advance(count: number): void {
		if (this._source._deleted || (this._source.objectStore && this._source.objectStore._deleted)) {
			throw InvalidStateError("The cursor's source or effective object store has been deleted");
		}
		if (!this._transaction._active) {
			throw TransactionInactiveError("Transaction is not active");
		}
		if (!Number.isInteger(count) || count <= 0) {
			throw new TypeError(
				"Failed to execute 'advance' on 'IDBCursor': A count argument with value 0 (zero) was specified, must be greater than 0.",
			);
		}
		if (!this._gotValue) {
			throw InvalidStateError("Cursor is not pointing at a value");
		}
		this._gotValue = false;
		// Snapshot current state before advancing
		this._keySnapshot = this._backendCursor.key;
		this._primaryKeySnapshot = this._backendCursor.primaryKey;
		this._snapshotValue();
		this._transaction[kHoldOpen]();
		let advanced = true;
		for (let i = 0; i < count && advanced; i++) {
			advanced = this._backendCursor.continue();
		}
		queueMicrotask(() => {
			// Clear snapshots
			this._keySnapshot = null;
			this._primaryKeySnapshot = null;
			this._clearKeyCache();
			this._clearValueSnapshot();
			if (advanced) this._gotValue = true;
			this._request._resolve(advanced ? this : null);
			this._transaction[kRelease]();
		});
	}

	continuePrimaryKey(key: IDBValidKey, primaryKey: IDBValidKey): void {
		if (!this._transaction._active) {
			throw TransactionInactiveError("Transaction is not active");
		}
		if (!this._gotValue) {
			throw InvalidStateError("Cursor is not pointing at a value");
		}
		// continuePrimaryKey only works on index cursors with "next" or "prev" direction
		if (!this._source.objectStore) {
			throw new DOMException(
				"continuePrimaryKey can only be called on index cursors",
				"InvalidAccessError",
			);
		}
		if (this._direction === "nextunique" || this._direction === "prevunique") {
			throw new DOMException(
				"continuePrimaryKey cannot be called with unique direction",
				"InvalidAccessError",
			);
		}
		const validatedKey = validateKey(key);
		const validatedPK = validateKey(primaryKey);
		const encodedKey = encodeKey(validatedKey);
		const encodedPK = encodeKey(validatedPK);

		// Key must be in cursor direction, or equal with primaryKey strictly in direction
		const cmp = compareKeys(encodedKey, this._backendCursor.key);
		if (this._direction === "next") {
			if (cmp < 0) throw DataError("Key is before cursor's current key");
			if (cmp === 0) {
				const pkCmp = compareKeys(encodedPK, this._backendCursor.primaryKey);
				if (pkCmp <= 0) throw DataError("Primary key is not after cursor's current primary key");
			}
		} else {
			if (cmp > 0) throw DataError("Key is after cursor's current key");
			if (cmp === 0) {
				const pkCmp = compareKeys(encodedPK, this._backendCursor.primaryKey);
				if (pkCmp >= 0) throw DataError("Primary key is not before cursor's current primary key");
			}
		}

		this._gotValue = false;
		this._keySnapshot = this._backendCursor.key;
		this._primaryKeySnapshot = this._backendCursor.primaryKey;
		this._snapshotValue();
		this._transaction[kHoldOpen]();
		// Advance until we reach or pass the target key+primaryKey
		let found = false;
		while (this._backendCursor.continue()) {
			const keyCmp = compareKeys(this._backendCursor.key, encodedKey);
			if (this._direction === "next") {
				if (keyCmp > 0 || (keyCmp === 0 && compareKeys(this._backendCursor.primaryKey, encodedPK) >= 0)) {
					found = true;
					break;
				}
			} else {
				if (keyCmp < 0 || (keyCmp === 0 && compareKeys(this._backendCursor.primaryKey, encodedPK) <= 0)) {
					found = true;
					break;
				}
			}
		}
		queueMicrotask(() => {
			this._keySnapshot = null;
			this._primaryKeySnapshot = null;
			this._clearKeyCache();
			this._clearValueSnapshot();
			if (found) this._gotValue = true;
			this._request._resolve(found ? this : null);
			this._transaction[kRelease]();
		});
	}

	_clearKeyCache(): void {
		this._cachedKey = undefined;
		this._cachedKeySource = null;
		this._cachedPrimaryKey = undefined;
		this._cachedPrimaryKeySource = null;
	}

	/** Override in IDBCursorWithValue to snapshot the value */
	_snapshotValue(): void {}
	_clearValueSnapshot(): void {}
}

/**
 * IDBCursorWithValue — iterates over records with values.
 */
export class IDBCursorWithValue extends IDBCursor {
	_valueSnapshot: Uint8Array | null = null;
	/** Cached decoded value — same object returned on repeated access */
	_cachedValue: any = undefined;
	_cachedValueSource: Uint8Array | null = null;

	get [Symbol.toStringTag](): string {
		return "IDBCursorWithValue";
	}

	get value(): any {
		const rawBytes = this._valueSnapshot ?? this._backendCursor.value;
		// Return cached value if still reading from same bytes
		if (this._cachedValueSource === rawBytes && this._cachedValue !== undefined) {
			return this._cachedValue;
		}
		this._cachedValue = decodeValue(rawBytes);
		this._cachedValueSource = rawBytes;
		return this._cachedValue;
	}

	_snapshotValue(): void {
		this._valueSnapshot = this._backendCursor.value;
	}

	_clearValueSnapshot(): void {
		this._valueSnapshot = null;
		this._cachedValue = undefined;
		this._cachedValueSource = null;
	}

	delete(): IDBRequest {
		if (this._source._deleted || (this._source.objectStore && this._source.objectStore._deleted)) {
			throw InvalidStateError("The cursor's source or effective object store has been deleted");
		}
		if (!this._transaction._active) {
			throw TransactionInactiveError("Transaction is not active");
		}
		if (
			this._transaction.mode !== "readwrite" &&
			this._transaction.mode !== "versionchange"
		) {
			throw ReadOnlyError("Transaction is read-only");
		}
		if (!this._gotValue) {
			throw InvalidStateError("Cursor is not pointing at a value");
		}
		const request = new IDBRequest();
		request._setSource(this);
		const primaryKey = this._backendCursor.primaryKey;
		// Get the effective object store name
		const storeName = this._getEffectiveStoreName();

		return this._transaction._executeRequest(request, (tx) => {
			tx.delete(storeName, {
				lower: primaryKey,
				upper: primaryKey,
				lowerOpen: false,
				upperOpen: false,
			});
			return undefined;
		});
	}

	update(value: any): IDBRequest {
		if (arguments.length === 0) {
			throw new TypeError(
				"Failed to execute 'update' on 'IDBCursor': 1 argument required, but only 0 present.",
			);
		}
		if (this._source._deleted || (this._source.objectStore && this._source.objectStore._deleted)) {
			throw InvalidStateError("The cursor's source or effective object store has been deleted");
		}
		if (!this._transaction._active) {
			throw TransactionInactiveError("Transaction is not active");
		}
		if (
			this._transaction.mode !== "readwrite" &&
			this._transaction.mode !== "versionchange"
		) {
			throw ReadOnlyError("Transaction is read-only");
		}
		if (!this._gotValue) {
			throw InvalidStateError("Cursor is not pointing at a value");
		}
		// Spec: clone the value before key extraction
		let clonedValue: any;
		try {
			clonedValue = structuredClone(value);
		} catch (e: any) {
			// Re-throw clone errors as-is (getter errors should propagate)
			throw e;
		}
		// Validate in-line key: if the effective object store uses a keyPath,
		// the key at that path in the cloned value must match the cursor's effective key
		const effectiveStore = this._source.objectStore || this._source;
		if (effectiveStore.keyPath !== null) {
			try {
				const keyInValue = extractKeyFromValue(clonedValue, effectiveStore.keyPath);
				const encodedKeyInValue = encodeKey(keyInValue);
				if (compareKeys(encodedKeyInValue, this._backendCursor.primaryKey) !== 0) {
					throw DataError("The key in the value does not match the cursor's effective key");
				}
			} catch (e: any) {
				if (e instanceof DOMException && e.name === "DataError") {
					throw e;
				}
				throw DataError("The key in the value does not match the cursor's effective key");
			}
		}
		const request = new IDBRequest();
		request._setSource(this);
		const primaryKey = this._backendCursor.primaryKey;
		const storeName = this._getEffectiveStoreName();
		const encodedValue = encodeValue(clonedValue);

		return this._transaction._executeRequest(request, (tx) => {
			tx.put(storeName, primaryKey, encodedValue);
			return decodeKey(primaryKey);
		});
	}

	_getEffectiveStoreName(): string {
		// If source is an IDBObjectStore, use its name directly
		// If source is an IDBIndex, use its objectStore's name
		const source = this._source;
		if (source.objectStore) {
			// IDBIndex — has an objectStore property
			return source.objectStore.name;
		}
		return source.name;
	}
}
