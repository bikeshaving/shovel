/**
 * IDBObjectStore implementation.
 */

import {type IDBTransaction} from "./transaction.js";
import {IDBRequest} from "./request.js";
import {IDBKeyRange} from "./key-range.js";
import {IDBIndex} from "./idb-index.js";
import {IDBCursor, IDBCursorWithValue} from "./cursor.js";
import {
	encodeKey,
	decodeKey,
	validateKey,
	validateKeyPath,
	extractKeyFromValue,
	injectKeyIntoValue,
} from "./key.js";
import {encodeValue, decodeValue} from "./structured-clone.js";
import {
	DataError,
	ReadOnlyError,
	InvalidStateError,
	TransactionInactiveError,
} from "./errors.js";
import {makeDOMStringList} from "./types.js";
import type {ObjectStoreMeta, KeyRangeSpec} from "./types.js";

export class IDBObjectStore {
	readonly name: string;
	readonly keyPath: string | string[] | null;
	readonly autoIncrement: boolean;
	readonly _indexNames: string[] = [];

	#transaction: IDBTransaction;

	constructor(transaction: IDBTransaction, meta: ObjectStoreMeta) {
		this.#transaction = transaction;
		this.name = meta.name;
		this.keyPath = meta.keyPath;
		this.autoIncrement = meta.autoIncrement;
	}

	get indexNames(): DOMStringList {
		return makeDOMStringList(this._indexNames);
	}

	get transaction(): IDBTransaction {
		return this.#transaction;
	}

	/**
	 * Add a record (fails if key already exists).
	 */
	add(value: any, key?: IDBValidKey): IDBRequest {
		this.#checkWritable();
		this.#validateKeyInput(value, key);
		const request = new IDBRequest();
		request._setSource(this);

		return this.#transaction._executeRequest(request, (tx) => {
			const {encodedKey, encodedValue} = this.#prepareRecord(
				value,
				key,
				tx,
			);
			tx.add(this.name, encodedKey, encodedValue);
			return decodeKey(encodedKey);
		});
	}

	/**
	 * Put a record (overwrites if key exists).
	 */
	put(value: any, key?: IDBValidKey): IDBRequest {
		this.#checkWritable();
		this.#validateKeyInput(value, key);
		const request = new IDBRequest();
		request._setSource(this);

		return this.#transaction._executeRequest(request, (tx) => {
			const {encodedKey, encodedValue} = this.#prepareRecord(
				value,
				key,
				tx,
			);
			tx.put(this.name, encodedKey, encodedValue);
			return decodeKey(encodedKey);
		});
	}

	/**
	 * Get a record by key.
	 */
	get(query: IDBValidKey | IDBKeyRange): IDBRequest {
		this.#checkActive();
		// Validate key synchronously (throws DataError for invalid keys)
		if (!(query instanceof IDBKeyRange)) {
			validateKey(query);
		}
		const request = new IDBRequest();
		request._setSource(this);

		return this.#transaction._executeRequest(request, (tx) => {
			if (query instanceof IDBKeyRange) {
				const results = tx.getAll(this.name, query._toSpec(), 1);
				return results.length > 0
					? decodeValue(results[0].value)
					: undefined;
			}
			const encoded = encodeKey(validateKey(query));
			const record = tx.get(this.name, encoded);
			return record ? decodeValue(record.value) : undefined;
		});
	}

	/**
	 * Get a key by query.
	 */
	getKey(query: IDBValidKey | IDBKeyRange): IDBRequest {
		this.#checkActive();
		if (!(query instanceof IDBKeyRange)) {
			validateKey(query);
		}
		const request = new IDBRequest();
		request._setSource(this);

		return this.#transaction._executeRequest(request, (tx) => {
			if (query instanceof IDBKeyRange) {
				const keys = tx.getAllKeys(this.name, query._toSpec(), 1);
				return keys.length > 0 ? decodeKey(keys[0]) : undefined;
			}
			const encoded = encodeKey(validateKey(query));
			const record = tx.get(this.name, encoded);
			return record ? decodeKey(record.key) : undefined;
		});
	}

	/**
	 * Get all records matching a query.
	 */
	getAll(
		query?: IDBValidKey | IDBKeyRange | null,
		count?: number,
	): IDBRequest {
		this.#checkActive();
		const range = this.#toRangeSpec(query);
		const request = new IDBRequest();
		request._setSource(this);

		return this.#transaction._executeRequest(request, (tx) => {
			const records = tx.getAll(this.name, range, count);
			return records.map((r) => decodeValue(r.value));
		});
	}

	/**
	 * Get all keys matching a query.
	 */
	getAllKeys(
		query?: IDBValidKey | IDBKeyRange | null,
		count?: number,
	): IDBRequest {
		this.#checkActive();
		const range = this.#toRangeSpec(query);
		const request = new IDBRequest();
		request._setSource(this);

		return this.#transaction._executeRequest(request, (tx) => {
			const keys = tx.getAllKeys(this.name, range, count);
			return keys.map((k) => decodeKey(k));
		});
	}

	/**
	 * Delete record(s) by key or range.
	 */
	delete(query: IDBValidKey | IDBKeyRange): IDBRequest {
		this.#checkWritable();
		const range = this.#toDeleteRange(query);
		const request = new IDBRequest();
		request._setSource(this);

		return this.#transaction._executeRequest(request, (tx) => {
			tx.delete(this.name, range);
			return undefined;
		});
	}

	/**
	 * Clear all records in the object store.
	 */
	clear(): IDBRequest {
		this.#checkWritable();
		const request = new IDBRequest();
		request._setSource(this);

		return this.#transaction._executeRequest(request, (tx) => {
			tx.clear(this.name);
			return undefined;
		});
	}

	/**
	 * Count records matching a query.
	 */
	count(query?: IDBValidKey | IDBKeyRange | null): IDBRequest {
		this.#checkActive();
		const range = this.#toRangeSpec(query);
		const request = new IDBRequest();
		request._setSource(this);

		return this.#transaction._executeRequest(request, (tx) => {
			return tx.count(this.name, range);
		});
	}

	/**
	 * Open a cursor over the object store.
	 */
	openCursor(
		query?: IDBValidKey | IDBKeyRange | null,
		direction?: IDBCursorDirection,
	): IDBRequest {
		this.#checkActive();
		const range = this.#toRangeSpec(query);
		const request = new IDBRequest();
		request._setSource(this);

		return this.#transaction._executeRequest(request, (tx) => {
			const cursor = tx.openCursor(this.name, range, direction as any);
			if (!cursor) return null;

			return this.#wrapCursor(cursor, request, tx, direction);
		});
	}

	/**
	 * Open a key cursor over the object store.
	 */
	openKeyCursor(
		query?: IDBValidKey | IDBKeyRange | null,
		direction?: IDBCursorDirection,
	): IDBRequest {
		this.#checkActive();
		const range = this.#toRangeSpec(query);
		const request = new IDBRequest();
		request._setSource(this);

		return this.#transaction._executeRequest(request, (tx) => {
			const cursor = tx.openKeyCursor(this.name, range, direction as any);
			if (!cursor) return null;

			return this.#wrapKeyCursor(cursor, request, tx, direction);
		});
	}

	/**
	 * Create an index (versionchange transactions only).
	 */
	createIndex(
		name: string,
		keyPath: string | string[],
		options?: {unique?: boolean; multiEntry?: boolean},
	): any {
		if (this.#transaction.mode !== "versionchange") {
			throw InvalidStateError(
				"createIndex can only be called during a versionchange transaction",
			);
		}
		if (!this.#transaction._active) {
			throw TransactionInactiveError("Transaction is not active");
		}
		// Spec: ConstraintError if index name already exists (before keyPath validation)
		if (this._indexNames.includes(name)) {
			throw new DOMException(
				`Index "${name}" already exists on store "${this.name}"`,
				"ConstraintError",
			);
		}
		validateKeyPath(keyPath);
		// multiEntry and array keyPath are incompatible
		if (options?.multiEntry && Array.isArray(keyPath)) {
			throw InvalidStateError(
				"multiEntry flag cannot be combined with an array keyPath",
			);
		}
		const meta = {
			name,
			storeName: this.name,
			keyPath,
			unique: options?.unique ?? false,
			multiEntry: options?.multiEntry ?? false,
		};
		this.#transaction._backendTx.createIndex(meta);
		if (!this._indexNames.includes(name)) {
			this._indexNames.push(name);
		}
		return new IDBIndex(this.#transaction, this.name, meta, this);
	}

	/**
	 * Delete an index (versionchange transactions only).
	 */
	deleteIndex(name: string): void {
		if (this.#transaction.mode !== "versionchange") {
			throw InvalidStateError(
				"deleteIndex can only be called during a versionchange transaction",
			);
		}
		if (!this.#transaction._active) {
			throw TransactionInactiveError("Transaction is not active");
		}
		if (!this._indexNames.includes(name)) {
			throw new DOMException(
				`Index "${name}" not found on store "${this.name}"`,
				"NotFoundError",
			);
		}
		this.#transaction._backendTx.deleteIndex(this.name, name);
		const idx = this._indexNames.indexOf(name);
		if (idx >= 0) {
			this._indexNames.splice(idx, 1);
		}
	}

	/**
	 * Get an index by name.
	 */
	index(name: string): IDBIndex {
		if (!this.#transaction._active) {
			throw TransactionInactiveError("Transaction is not active");
		}
		// Get index metadata from the backend
		const db = this.#transaction.db;
		const dbMeta = db._connection.getMetadata();
		const indexes = dbMeta.indexes.get(this.name) || [];
		const indexMeta = indexes.find((i: any) => i.name === name);
		if (!indexMeta) {
			throw new DOMException(
				`Index "${name}" not found on store "${this.name}"`,
				"NotFoundError",
			);
		}
		return new IDBIndex(this.#transaction, this.name, indexMeta, this);
	}

	// ---- Private helpers ----

	#checkActive(): void {
		if (!this.#transaction._active) {
			throw TransactionInactiveError("Transaction is not active");
		}
	}

	#checkWritable(): void {
		this.#checkActive();
		if (
			this.#transaction.mode !== "readwrite" &&
			this.#transaction.mode !== "versionchange"
		) {
			throw ReadOnlyError("Transaction is read-only");
		}
	}

	/**
	 * Synchronous validation per IDB spec — must throw before creating request.
	 * Checks: in-line key + explicit key conflict, key injection feasibility,
	 * out-of-line key validity.
	 */
	#validateKeyInput(value: any, key?: IDBValidKey): void {
		if (this.keyPath !== null) {
			// In-line keys: providing an explicit key is always an error
			if (key !== undefined) {
				throw DataError(
					"Cannot provide a key when object store has a keyPath",
				);
			}
			if (this.autoIncrement) {
				// If autoIncrement, check if the key can be extracted or injected
				if (typeof this.keyPath === "string") {
					try {
						extractKeyFromValue(value, this.keyPath);
					} catch {
						// Key not present — check if injection is possible per spec:
						// Walk the path; if any existing segment is a non-object primitive,
						// injection fails. Undefined/null segments are OK (will be created).
						const parts = this.keyPath.split(".");
						let current: any = value;
						if (current == null || typeof current !== "object") {
							throw DataError(
								`Cannot inject key at path "${this.keyPath}": value is not an object`,
							);
						}
						for (let i = 0; i < parts.length - 1; i++) {
							const next = current[parts[i]];
							if (next == null) break; // Will be created during injection
							if (typeof next !== "object") {
								throw DataError(
									`Cannot inject key at path "${this.keyPath}": "${parts[i]}" is not an object`,
								);
							}
							current = next;
						}
					}
				}
			} else {
				// No autoIncrement: key MUST be extractable from value
				extractKeyFromValue(value, this.keyPath);
			}
		} else {
			// Out-of-line keys
			if (key !== undefined) {
				validateKey(key);
			} else if (!this.autoIncrement) {
				// No key provided and no key generator
				throw DataError(
					"No key provided and object store has no keyPath or autoIncrement",
				);
			}
		}
	}

	#prepareRecord(
		value: any,
		key: IDBValidKey | undefined,
		tx: any,
	): {encodedKey: Uint8Array; encodedValue: Uint8Array} {
		let resolvedKey: IDBValidKey;

		if (this.keyPath !== null) {
			// In-line keys
			if (key !== undefined) {
				throw DataError(
					"Cannot provide a key when object store has a keyPath",
				);
			}
			if (this.autoIncrement) {
				// Try to extract key from value; if not present, generate one
				try {
					resolvedKey = extractKeyFromValue(value, this.keyPath);
					// Spec: update key generator if explicit key is numeric
					if (typeof resolvedKey === "number") {
						tx.maybeUpdateKeyGenerator(this.name, resolvedKey);
					}
				} catch {
					const nextKey = tx.nextAutoIncrementKey(this.name);
					resolvedKey = nextKey;
					// Inject into value
					if (typeof this.keyPath === "string") {
						// Clone value to avoid mutating the original
						value = structuredClone(value);
						injectKeyIntoValue(value, this.keyPath, nextKey);
					}
				}
			} else {
				resolvedKey = extractKeyFromValue(value, this.keyPath);
			}
		} else {
			// Out-of-line keys
			if (key !== undefined) {
				resolvedKey = validateKey(key);
				// Spec: update key generator if explicit key is numeric
				if (this.autoIncrement && typeof resolvedKey === "number") {
					tx.maybeUpdateKeyGenerator(this.name, resolvedKey);
				}
			} else if (this.autoIncrement) {
				resolvedKey = tx.nextAutoIncrementKey(this.name);
			} else {
				throw DataError("No key provided and object store has no keyPath or autoIncrement");
			}
		}

		return {
			encodedKey: encodeKey(resolvedKey),
			encodedValue: encodeValue(value),
		};
	}

	#toRangeSpec(
		query: IDBValidKey | IDBKeyRange | null | undefined,
	): KeyRangeSpec | undefined {
		if (query == null) return undefined;
		if (query instanceof IDBKeyRange) return query._toSpec();
		const key = encodeKey(validateKey(query));
		return {lower: key, upper: key, lowerOpen: false, upperOpen: false};
	}

	#toDeleteRange(query: IDBValidKey | IDBKeyRange): KeyRangeSpec {
		if (query instanceof IDBKeyRange) return query._toSpec();
		const key = encodeKey(validateKey(query));
		return {lower: key, upper: key, lowerOpen: false, upperOpen: false};
	}

	#wrapCursor(
		backendCursor: any,
		request: IDBRequest,
		_tx: any,
		cursorDirection: IDBCursorDirection = "next",
	): IDBCursorWithValue {
		return new IDBCursorWithValue(
			backendCursor,
			request,
			this.#transaction,
			this,
			cursorDirection,
		);
	}

	#wrapKeyCursor(
		backendCursor: any,
		request: IDBRequest,
		_tx: any,
		cursorDirection: IDBCursorDirection = "next",
	): IDBCursor {
		return new IDBCursor(
			backendCursor,
			request,
			this.#transaction,
			this,
			cursorDirection,
		);
	}
}
