/**
 * IDBObjectStore implementation.
 */

import type {IDBTransaction} from "./transaction.js";
import {IDBRequest} from "./request.js";
import {IDBKeyRange} from "./key-range.js";
import {IDBIndex} from "./idb-index.js";
import {IDBCursor, IDBCursorWithValue} from "./cursor.js";
import {
	kDeleted,
	kIndexNames,
	kIndexInstances,
	kRevertName,
	kActive,
	kFinished,
	kBackendTx,
	kScope,
	kExecuteRequest,
	kAbortWithError,
	kRenameStoreInCache,
	kSetSource,
	kToSpec,
	kConnection,
	kRefreshStoreNames,
	kHoldOpen,
	kRelease,
} from "./symbols.js";
import {
	encodeKey,
	decodeKey,
	validateKey,
	validateKeyPath,
	extractKeyFromValue,
	extractRawValueAtKeyPath,
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

/**
 * Web IDL [EnforceRange] unsigned long validation for count parameters.
 */
function enforceRangeCount(count: unknown): void {
	const n = Number(count);
	if (!Number.isFinite(n) || n < 0 || n > 0xffffffff) {
		throw new TypeError(
			`The count parameter is not a valid unsigned long value.`,
		);
	}
}

/**
 * Parse getAll/getAllKeys arguments: supports both (query, count) and ({query, count}).
 */
/**
 * IDBRecord — returned by getAllRecords().
 */
export class IDBRecord {
	readonly key: any;
	readonly primaryKey: any;
	readonly value: any;
	constructor(key: any, primaryKey: any, value: any) {
		this.key = key;
		this.primaryKey = primaryKey;
		this.value = value;
	}
	get [Symbol.toStringTag](): string {
		return "IDBRecord";
	}
}

function makeIDBRecord(key: any, primaryKey: any, value: any): IDBRecord {
	return new IDBRecord(key, primaryKey, value);
}

function parseGetAllArgs(
	queryOrOptions?: any,
	countArg?: number,
): {
	query: any;
	count: number | undefined;
	direction: IDBCursorDirection | undefined;
} {
	// Detect options dictionary: plain objects (not Date, Array, IDBKeyRange, etc.)
	if (
		queryOrOptions !== null &&
		queryOrOptions !== undefined &&
		typeof queryOrOptions === "object" &&
		Object.getPrototypeOf(queryOrOptions) === Object.prototype
	) {
		const cnt = queryOrOptions.count;
		return {
			query: queryOrOptions.query ?? null,
			count: cnt === 0 ? undefined : cnt,
			direction: queryOrOptions.direction,
		};
	}
	return {
		query: queryOrOptions,
		count: countArg === 0 ? undefined : countArg,
		direction: undefined,
	};
}

export class IDBObjectStore {
	readonly autoIncrement: boolean;
	readonly [kIndexNames]!: string[];
	[kDeleted]!: boolean;
	/** @internal - track IDBIndex instances for marking as deleted */
	[kIndexInstances]!: IDBIndex[];

	#name: string;
	#transaction: IDBTransaction;
	#keyPath: string | string[] | null;
	#keyPathCache!: string[] | null;

	get [Symbol.toStringTag](): string {
		return "IDBObjectStore";
	}

	get name(): string {
		return this.#name;
	}

	set name(newName: string) {
		// Web IDL: DOMString setter stringifies the value
		newName = String(newName);
		// Spec: renaming is only allowed during versionchange transactions
		if (this.#transaction.mode !== "versionchange") {
			throw InvalidStateError(
				"Object store name can only be changed during a versionchange transaction",
			);
		}
		if (!this.#transaction[kActive]) {
			throw TransactionInactiveError("Transaction is not active");
		}
		if (this[kDeleted]) {
			throw InvalidStateError("Object store has been deleted");
		}
		const oldName = this.#name;
		if (newName === oldName) return;
		// Spec: ConstraintError if a store with the new name already exists
		const db = this.#transaction.db;
		if (db.objectStoreNames.contains(newName)) {
			throw new DOMException(
				`Object store "${newName}" already exists`,
				"ConstraintError",
			);
		}
		// Rename in backend
		this.#transaction[kBackendTx].renameObjectStore(oldName, newName);
		this.#name = newName;
		// Update transaction scope
		const scopeIdx = this.#transaction[kScope].indexOf(oldName);
		if (scopeIdx >= 0) {
			this.#transaction[kScope][scopeIdx] = newName;
		}
		// Update transaction's store cache and record for abort reversion
		this.#transaction[kRenameStoreInCache](oldName, newName, this);
		// Refresh database store names
		db[kRefreshStoreNames]();
	}

	/** @internal - Revert name after transaction abort */
	[kRevertName](name: string): void {
		this.#name = name;
	}

	get keyPath(): string | string[] | null {
		// Spec: return same array instance on repeated access
		if (Array.isArray(this.#keyPath)) {
			if (!this.#keyPathCache) {
				this.#keyPathCache = [...this.#keyPath];
			}
			return this.#keyPathCache;
		}
		return this.#keyPath;
	}

	constructor(transaction: IDBTransaction, meta: ObjectStoreMeta) {
		this[kIndexNames] = [];
		this[kDeleted] = false;
		this[kIndexInstances] = [];
		this.#transaction = transaction;
		this.#keyPath = meta.keyPath;
		this.#keyPathCache = null;
		this.#name = meta.name;
		this.autoIncrement = meta.autoIncrement;
	}

	get indexNames(): DOMStringList {
		return makeDOMStringList(this[kIndexNames]);
	}

	get transaction(): IDBTransaction {
		return this.#transaction;
	}

	/**
	 * Add a record (fails if key already exists).
	 */
	add(value: any, key?: IDBValidKey): IDBRequest {
		this.#checkWritable();
		// Spec: transaction is inactive during structured clone
		this.#transaction[kActive] = false;
		let clone: any;
		try {
			clone = structuredClone(value);
		} finally {
			this.#transaction[kActive] = true;
		}
		this.#validateKeyInput(clone, key);
		const request = new IDBRequest();
		request[kSetSource](this);

		return this.#transaction[kExecuteRequest](request, (tx) => {
			const savedAutoInc = tx.getAutoIncrementCurrent(this.name);
			const {encodedKey, encodedValue} = this.#prepareRecord(clone, key, tx);
			try {
				tx.add(this.name, encodedKey, encodedValue);
			} catch (e) {
				if (savedAutoInc !== undefined) {
					tx.setAutoIncrementCurrent(this.name, savedAutoInc);
				}
				throw e;
			}
			return decodeKey(encodedKey);
		});
	}

	/**
	 * Put a record (overwrites if key exists).
	 */
	put(value: any, key?: IDBValidKey): IDBRequest {
		this.#checkWritable();
		// Spec: transaction is inactive during structured clone
		this.#transaction[kActive] = false;
		let clone: any;
		try {
			clone = structuredClone(value);
		} finally {
			this.#transaction[kActive] = true;
		}
		this.#validateKeyInput(clone, key);
		const request = new IDBRequest();
		request[kSetSource](this);

		return this.#transaction[kExecuteRequest](request, (tx) => {
			const savedAutoInc = tx.getAutoIncrementCurrent(this.name);
			const {encodedKey, encodedValue} = this.#prepareRecord(clone, key, tx);
			try {
				tx.put(this.name, encodedKey, encodedValue);
			} catch (e) {
				if (savedAutoInc !== undefined) {
					tx.setAutoIncrementCurrent(this.name, savedAutoInc);
				}
				throw e;
			}
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
		request[kSetSource](this);

		return this.#transaction[kExecuteRequest](request, (tx) => {
			if (query instanceof IDBKeyRange) {
				const results = tx.getAll(this.name, query[kToSpec](), 1);
				return results.length > 0 ? decodeValue(results[0].value) : undefined;
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
		if (arguments.length === 0) {
			throw new TypeError(
				"Failed to execute 'getKey' on 'IDBObjectStore': 1 argument required.",
			);
		}
		this.#checkActive();
		if (!(query instanceof IDBKeyRange)) {
			validateKey(query);
		}
		const request = new IDBRequest();
		request[kSetSource](this);

		return this.#transaction[kExecuteRequest](request, (tx) => {
			if (query instanceof IDBKeyRange) {
				const keys = tx.getAllKeys(this.name, query[kToSpec](), 1);
				return keys.length > 0 ? decodeKey(keys[0]) : undefined;
			}
			const encoded = encodeKey(validateKey(query));
			const record = tx.get(this.name, encoded);
			return record ? decodeKey(record.key) : undefined;
		});
	}

	/**
	 * Get all records matching a query.
	 * Accepts (query, count) or ({query, count}) options dictionary.
	 */
	getAll(queryOrOptions?: any, count?: number): IDBRequest {
		this.#checkActive();
		const {
			query,
			count: cnt,
			direction,
		} = parseGetAllArgs(queryOrOptions, count);
		if (cnt !== undefined) enforceRangeCount(cnt);
		const range = this.#toRangeSpec(query);
		const request = new IDBRequest();
		request[kSetSource](this);

		return this.#transaction[kExecuteRequest](request, (tx) => {
			if (direction && direction !== "next" && direction !== "nextunique") {
				// Use cursor for reverse directions
				const results: any[] = [];
				const cursor = tx.openCursor(this.name, range, direction);
				if (cursor) {
					do {
						results.push(decodeValue(cursor.value));
						if (cnt !== undefined && results.length >= cnt) break;
					} while (cursor.continue());
				}
				return results;
			}
			const records = tx.getAll(this.name, range, cnt);
			return records.map((r) => decodeValue(r.value));
		});
	}

	/**
	 * Get all keys matching a query.
	 * Accepts (query, count) or ({query, count}) options dictionary.
	 */
	getAllKeys(queryOrOptions?: any, count?: number): IDBRequest {
		this.#checkActive();
		const {
			query,
			count: cnt,
			direction,
		} = parseGetAllArgs(queryOrOptions, count);
		if (cnt !== undefined) enforceRangeCount(cnt);
		const range = this.#toRangeSpec(query);
		const request = new IDBRequest();
		request[kSetSource](this);

		return this.#transaction[kExecuteRequest](request, (tx) => {
			if (direction && direction !== "next" && direction !== "nextunique") {
				// Use cursor for reverse directions
				const results: any[] = [];
				const cursor = tx.openKeyCursor(this.name, range, direction);
				if (cursor) {
					do {
						results.push(decodeKey(cursor.key));
						if (cnt !== undefined && results.length >= cnt) break;
					} while (cursor.continue());
				}
				return results;
			}
			const keys = tx.getAllKeys(this.name, range, cnt);
			return keys.map((k) => decodeKey(k));
		});
	}

	/**
	 * Get all records matching a query, returning IDBRecord objects.
	 */
	getAllRecords(options?: any): IDBRequest {
		this.#checkActive();
		const {query, count, direction} = parseGetAllArgs(options);
		if (count !== undefined) enforceRangeCount(count);
		const range = this.#toRangeSpec(query);
		const request = new IDBRequest();
		request[kSetSource](this);

		return this.#transaction[kExecuteRequest](request, (tx) => {
			if (direction && direction !== "next" && direction !== "nextunique") {
				// Use cursor for reverse directions
				const results: IDBRecord[] = [];
				const cursor = tx.openCursor(this.name, range, direction);
				if (cursor) {
					do {
						results.push(
							makeIDBRecord(
								decodeKey(cursor.key),
								decodeKey(cursor.key),
								decodeValue(cursor.value),
							),
						);
						if (count !== undefined && results.length >= count) break;
					} while (cursor.continue());
				}
				return results;
			}
			const records = tx.getAll(this.name, range, count);
			return records.map((r) =>
				makeIDBRecord(decodeKey(r.key), decodeKey(r.key), decodeValue(r.value)),
			);
		});
	}

	/**
	 * Delete record(s) by key or range.
	 */
	delete(query: IDBValidKey | IDBKeyRange): IDBRequest {
		this.#checkWritable();
		const range = this.#toDeleteRange(query);
		const request = new IDBRequest();
		request[kSetSource](this);

		return this.#transaction[kExecuteRequest](request, (tx) => {
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
		request[kSetSource](this);

		return this.#transaction[kExecuteRequest](request, (tx) => {
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
		request[kSetSource](this);

		return this.#transaction[kExecuteRequest](request, (tx) => {
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
		request[kSetSource](this);

		return this.#transaction[kExecuteRequest](request, (tx) => {
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
		request[kSetSource](this);

		return this.#transaction[kExecuteRequest](request, (tx) => {
			const cursor = tx.openKeyCursor(this.name, range, direction as any);
			if (!cursor) return null;

			return this.#wrapKeyCursor(cursor, request, tx, direction);
		});
	}

	/**
	 * Create an index (versionchange transactions only).
	 */
	createIndex(
		rawName: string,
		keyPath: string | string[],
		options?: {unique?: boolean; multiEntry?: boolean},
	): any {
		// Web IDL: stringify the name
		const name = String(rawName);
		if (this[kDeleted]) {
			throw InvalidStateError("Object store has been deleted");
		}
		if (this.#transaction.mode !== "versionchange") {
			throw InvalidStateError(
				"createIndex can only be called during a versionchange transaction",
			);
		}
		if (!this.#transaction[kActive]) {
			throw TransactionInactiveError("Transaction is not active");
		}
		// Spec: ConstraintError if index name already exists (before keyPath validation)
		if (this[kIndexNames].includes(name)) {
			throw new DOMException(
				`Index "${name}" already exists on store "${this.name}"`,
				"ConstraintError",
			);
		}
		validateKeyPath(keyPath);
		// multiEntry and array keyPath are incompatible (spec: InvalidAccessError)
		if (options?.multiEntry && Array.isArray(keyPath)) {
			throw new DOMException(
				"multiEntry flag cannot be combined with an array keyPath",
				"InvalidAccessError",
			);
		}
		const meta = {
			name,
			storeName: this.name,
			keyPath,
			unique: options?.unique ?? false,
			multiEntry: options?.multiEntry ?? false,
		};
		try {
			this.#transaction[kBackendTx].createIndex(meta);
		} catch (e: any) {
			// Spec: unique constraint violation during createIndex causes async abort.
			// createIndex returns the IDBIndex, and the transaction aborts asynchronously.
			if (e instanceof DOMException && e.name === "ConstraintError") {
				if (!this[kIndexNames].includes(name)) {
					this[kIndexNames].push(name);
				}
				const index = new IDBIndex(this.#transaction, this.name, meta, this);
				this[kIndexInstances].push(index);
				const txn = this.#transaction;
				// Hold transaction open so auto-commit doesn't race the deferred abort.
				// The abort fires as a macrotask (after pending request events).
				txn[kHoldOpen]();
				setTimeout(() => {
					txn[kAbortWithError](e);
					txn[kRelease]();
				});
				return index;
			}
			throw e;
		}
		if (!this[kIndexNames].includes(name)) {
			this[kIndexNames].push(name);
		}
		const index = new IDBIndex(this.#transaction, this.name, meta, this);
		this[kIndexInstances].push(index);
		return index;
	}

	/**
	 * Delete an index (versionchange transactions only).
	 */
	deleteIndex(name: string): void {
		if (this[kDeleted]) {
			throw InvalidStateError("Object store has been deleted");
		}
		if (this.#transaction.mode !== "versionchange") {
			throw InvalidStateError(
				"deleteIndex can only be called during a versionchange transaction",
			);
		}
		if (!this.#transaction[kActive]) {
			throw TransactionInactiveError("Transaction is not active");
		}
		if (!this[kIndexNames].includes(name)) {
			throw new DOMException(
				`Index "${name}" not found on store "${this.name}"`,
				"NotFoundError",
			);
		}
		// Mark all existing index instances as deleted
		for (const inst of this[kIndexInstances]) {
			if (inst.name === name) {
				inst[kDeleted] = true;
			}
		}
		this.#transaction[kBackendTx].deleteIndex(this.name, name);
		const idx = this[kIndexNames].indexOf(name);
		if (idx >= 0) {
			this[kIndexNames].splice(idx, 1);
		}
	}

	/**
	 * Get an index by name.
	 */
	index(name: string): IDBIndex {
		if (this[kDeleted]) {
			throw InvalidStateError("Object store has been deleted");
		}
		if (this.#transaction[kFinished]) {
			throw InvalidStateError("Transaction has finished");
		}
		// Check if index exists in the indexNames list
		if (!this[kIndexNames].includes(name)) {
			throw new DOMException(
				`Index "${name}" not found on store "${this.name}"`,
				"NotFoundError",
			);
		}
		// Return cached instance if available (spec: same object identity)
		const existing = this[kIndexInstances].find((i) => i.name === name);
		if (existing) return existing;
		// Get index metadata from the backend
		const db = this.#transaction.db;
		const dbMeta = db[kConnection].getMetadata();
		const indexes = dbMeta.indexes.get(this.name) || [];
		const indexMeta = indexes.find((i: any) => i.name === name);
		if (!indexMeta) {
			throw new DOMException(
				`Index "${name}" not found on store "${this.name}"`,
				"NotFoundError",
			);
		}
		const index = new IDBIndex(this.#transaction, this.name, indexMeta, this);
		this[kIndexInstances].push(index);
		return index;
	}

	// ---- Private helpers ----

	#checkActive(): void {
		if (this[kDeleted]) {
			throw InvalidStateError("Object store has been deleted");
		}
		if (!this.#transaction[kActive]) {
			throw TransactionInactiveError("Transaction is not active");
		}
	}

	#checkWritable(): void {
		if (this[kDeleted]) {
			throw InvalidStateError("Object store has been deleted");
		}
		if (!this.#transaction[kActive]) {
			throw TransactionInactiveError("Transaction is not active");
		}
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
	 * NOTE: `value` is expected to already be a structuredClone of the original.
	 */
	#validateKeyInput(value: any, key?: IDBValidKey): void {
		if (this.keyPath !== null) {
			// In-line keys: providing an explicit key is always an error
			if (key !== undefined) {
				throw DataError("Cannot provide a key when object store has a keyPath");
			}
			if (this.autoIncrement) {
				// Spec: if a key generator is used, check the raw value at the key path.
				// - undefined → will auto-generate (check injection feasibility)
				// - valid key → will use it
				// - exists but not valid → DataError
				if (typeof this.keyPath === "string") {
					const rawValue = extractRawValueAtKeyPath(value, this.keyPath);
					if (rawValue !== undefined) {
						// Value exists at key path — must be a valid key
						validateKey(rawValue);
					} else {
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
				// No autoIncrement: key MUST be extractable
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

	/**
	 * Prepare a record for storage.
	 * NOTE: `value` is expected to already be a structuredClone of the original.
	 */
	#prepareRecord(
		value: any,
		key: IDBValidKey | undefined,
		tx: any,
	): {encodedKey: Uint8Array; encodedValue: Uint8Array} {
		let resolvedKey: IDBValidKey;

		if (this.keyPath !== null) {
			// In-line keys
			if (key !== undefined) {
				throw DataError("Cannot provide a key when object store has a keyPath");
			}
			if (this.autoIncrement) {
				// Try to extract key from cloned value; if not present, generate one
				try {
					resolvedKey = extractKeyFromValue(value, this.keyPath);
					// Spec: update key generator if explicit key is numeric
					if (typeof resolvedKey === "number") {
						tx.maybeUpdateKeyGenerator(this.name, resolvedKey);
					}
				} catch (_error) {
					const nextKey = tx.nextAutoIncrementKey(this.name);
					resolvedKey = nextKey;
					// Inject into cloned value
					if (typeof this.keyPath === "string") {
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
				throw DataError(
					"No key provided and object store has no keyPath or autoIncrement",
				);
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
		if (query === undefined || query === null) return undefined;
		if (query instanceof IDBKeyRange) return query[kToSpec]();
		// Validate key synchronously — throws DataError for invalid keys
		const key = encodeKey(validateKey(query));
		return {lower: key, upper: key, lowerOpen: false, upperOpen: false};
	}

	#toDeleteRange(query: IDBValidKey | IDBKeyRange): KeyRangeSpec {
		if (query instanceof IDBKeyRange) return query[kToSpec]();
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
