/**
 * IDBCursor and IDBCursorWithValue implementations.
 *
 * These classes provide the cursor interface used by object stores and indexes.
 * Backend cursors handle data traversal; these wrappers handle key decoding,
 * value decoding, and event integration (continue/advance fire success events).
 */

import {type IDBTransaction, kHoldOpen, kRelease} from "./transaction.js";
import {IDBRequest} from "./request.js";
import {encodeKey, decodeKey, validateKey, compareKeys} from "./key.js";
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

	get key(): IDBValidKey {
		if (this._keySnapshot) return decodeKey(this._keySnapshot);
		return decodeKey(this._backendCursor.key);
	}

	get primaryKey(): IDBValidKey {
		if (this._primaryKeySnapshot) return decodeKey(this._primaryKeySnapshot);
		return decodeKey(this._backendCursor.primaryKey);
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
		if (!this._gotValue) {
			throw InvalidStateError("Cursor is not pointing at a value");
		}
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
		}
		this._gotValue = false;
		// Snapshot current state before advancing
		this._keySnapshot = this._backendCursor.key;
		this._primaryKeySnapshot = this._backendCursor.primaryKey;
		this._snapshotValue();
		this._transaction[kHoldOpen]();
		const next = this._backendCursor.continue();
		queueMicrotask(() => {
			// Clear snapshots — getters now read from backend cursor
			this._keySnapshot = null;
			this._primaryKeySnapshot = null;
			this._clearValueSnapshot();
			if (next) this._gotValue = true;
			this._request._resolve(next ? this : null);
			this._transaction[kRelease]();
		});
	}

	advance(count: number): void {
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
			this._clearValueSnapshot();
			if (found) this._gotValue = true;
			this._request._resolve(found ? this : null);
			this._transaction[kRelease]();
		});
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

	get value(): any {
		if (this._valueSnapshot) return decodeValue(this._valueSnapshot);
		return decodeValue(this._backendCursor.value);
	}

	_snapshotValue(): void {
		this._valueSnapshot = this._backendCursor.value;
	}

	_clearValueSnapshot(): void {
		this._valueSnapshot = null;
	}

	delete(): IDBRequest {
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
		const storeName = this._getEffectiveStoreName();
		const encodedValue = encodeValue(value);

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
