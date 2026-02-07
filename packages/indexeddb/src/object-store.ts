/**
 * IDBObjectStore implementation.
 */

import type {IDBTransaction} from "./transaction.js";
import {IDBRequest} from "./request.js";
import {IDBKeyRange} from "./key-range.js";
import {IDBIndex} from "./idb-index.js";
import {
	encodeKey,
	decodeKey,
	validateKey,
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
import type {ObjectStoreMeta, KeyRangeSpec} from "./types.js";

export class IDBObjectStore {
	readonly name: string;
	readonly keyPath: string | string[] | null;
	readonly autoIncrement: boolean;
	readonly indexNames: string[] = [];

	#transaction: IDBTransaction;

	constructor(transaction: IDBTransaction, meta: ObjectStoreMeta) {
		this.#transaction = transaction;
		this.name = meta.name;
		this.keyPath = meta.keyPath;
		this.autoIncrement = meta.autoIncrement;
	}

	get transaction(): IDBTransaction {
		return this.#transaction;
	}

	/**
	 * Add a record (fails if key already exists).
	 */
	add(value: any, key?: IDBValidKey): IDBRequest {
		this.#checkWritable();
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
		const request = new IDBRequest();
		request._setSource(this);

		return this.#transaction._executeRequest(request, (tx) => {
			if (query instanceof IDBKeyRange) {
				// Get first record in range
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
		const request = new IDBRequest();
		request._setSource(this);

		return this.#transaction._executeRequest(request, (tx) => {
			const range = this.#toRangeSpec(query);
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
		const request = new IDBRequest();
		request._setSource(this);

		return this.#transaction._executeRequest(request, (tx) => {
			const range = this.#toRangeSpec(query);
			const keys = tx.getAllKeys(this.name, range, count);
			return keys.map((k) => decodeKey(k));
		});
	}

	/**
	 * Delete record(s) by key or range.
	 */
	delete(query: IDBValidKey | IDBKeyRange): IDBRequest {
		this.#checkWritable();
		const request = new IDBRequest();
		request._setSource(this);

		return this.#transaction._executeRequest(request, (tx) => {
			const range = this.#toDeleteRange(query);
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
		const request = new IDBRequest();
		request._setSource(this);

		return this.#transaction._executeRequest(request, (tx) => {
			const range = this.#toRangeSpec(query);
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
		const request = new IDBRequest();
		request._setSource(this);

		return this.#transaction._executeRequest(request, (tx) => {
			const range = this.#toRangeSpec(query);
			const cursor = tx.openCursor(this.name, range, direction as any);
			if (!cursor) return null;

			// Wrap in an IDBCursorWithValue-like object
			return this.#wrapCursor(cursor, request, tx);
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
		const request = new IDBRequest();
		request._setSource(this);

		return this.#transaction._executeRequest(request, (tx) => {
			const range = this.#toRangeSpec(query);
			const cursor = tx.openKeyCursor(this.name, range, direction as any);
			if (!cursor) return null;

			return this.#wrapKeyCursor(cursor, request, tx);
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
		const meta = {
			name,
			storeName: this.name,
			keyPath,
			unique: options?.unique ?? false,
			multiEntry: options?.multiEntry ?? false,
		};
		this.#transaction._backendTx.createIndex(meta);
		if (!this.indexNames.includes(name)) {
			(this.indexNames as string[]).push(name);
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
		this.#transaction._backendTx.deleteIndex(this.name, name);
		const idx = (this.indexNames as string[]).indexOf(name);
		if (idx >= 0) {
			(this.indexNames as string[]).splice(idx, 1);
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
	): any {
		const self = this;
		const cursor = {
			get key() {
				return decodeKey(backendCursor.key);
			},
			get primaryKey() {
				return decodeKey(backendCursor.primaryKey);
			},
			get value() {
				return decodeValue(backendCursor.value);
			},
			get source() {
				return self;
			},
			get direction() {
				return "next";
			},
			get request() {
				return request;
			},
			continue() {
				if (backendCursor.continue()) {
					// Re-fire success with updated cursor
					queueMicrotask(() => {
						request._resolve(cursor);
					});
				} else {
					queueMicrotask(() => {
						request._resolve(null);
					});
				}
			},
			advance(count: number) {
				let advanced = true;
				for (let i = 0; i < count && advanced; i++) {
					advanced = backendCursor.continue();
				}
				if (advanced) {
					queueMicrotask(() => request._resolve(cursor));
				} else {
					queueMicrotask(() => request._resolve(null));
				}
			},
			delete() {
				const delRequest = self.delete(cursor.primaryKey);
				return delRequest;
			},
			update(value: any) {
				const putRequest = self.put(value, cursor.primaryKey);
				return putRequest;
			},
		};
		return cursor;
	}

	#wrapKeyCursor(
		backendCursor: any,
		request: IDBRequest,
		_tx: any,
	): any {
		const cursor = {
			get key() {
				return decodeKey(backendCursor.key);
			},
			get primaryKey() {
				return decodeKey(backendCursor.primaryKey);
			},
			get source() {
				return this;
			},
			get direction() {
				return "next";
			},
			get request() {
				return request;
			},
			continue() {
				if (backendCursor.continue()) {
					queueMicrotask(() => request._resolve(cursor));
				} else {
					queueMicrotask(() => request._resolve(null));
				}
			},
		};
		return cursor;
	}
}
