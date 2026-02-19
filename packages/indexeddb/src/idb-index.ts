/**
 * IDBIndex implementation.
 */

import {type IDBTransaction} from "./transaction.js";
import {IDBRequest} from "./request.js";
import {IDBKeyRange} from "./key-range.js";
import {IDBCursor, IDBCursorWithValue} from "./cursor.js";
import {encodeKey, decodeKey, validateKey} from "./key.js";
import {decodeValue} from "./structured-clone.js";
import {IDBRecord} from "./object-store.js";
import {TransactionInactiveError, InvalidStateError} from "./errors.js";
import type {IndexMeta, KeyRangeSpec} from "./types.js";
import {
	kActive,
	kBackendTx,
	kDeleted,
	kExecuteRequest,
	kIndexNames,
	kRecordIndexRename,
	kRevertName,
	kSetSource,
	kToSpec,
} from "./symbols.js";

function enforceRangeCount(count: unknown): void {
	const n = Number(count);
	if (!Number.isFinite(n) || n < 0 || n > 0xffffffff) {
		throw new TypeError(
			`The count parameter is not a valid unsigned long value.`,
		);
	}
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

export class IDBIndex {
	readonly unique: boolean;
	readonly multiEntry: boolean;
	readonly objectStore: any;
	[kDeleted]!: boolean;

	#name: string;
	#transaction: IDBTransaction;
	#storeName: string;
	#keyPath: string | string[];
	#keyPathCache!: string[] | null;

	get [Symbol.toStringTag](): string {
		return "IDBIndex";
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
				"Index name can only be changed during a versionchange transaction",
			);
		}
		if (!this.#transaction[kActive]) {
			throw TransactionInactiveError("Transaction is not active");
		}
		if (this[kDeleted] || this.objectStore[kDeleted]) {
			throw InvalidStateError("Index or its object store has been deleted");
		}
		const oldName = this.#name;
		if (newName === oldName) return;
		// Spec: ConstraintError if an index with the new name already exists on the same store
		if (this.objectStore[kIndexNames].includes(newName)) {
			throw new DOMException(
				`Index "${newName}" already exists on store "${this.#storeName}"`,
				"ConstraintError",
			);
		}
		// Rename in backend
		this.#transaction[kBackendTx].renameIndex(
			this.#storeName,
			oldName,
			newName,
		);
		this.#name = newName;
		// Update objectStore[kIndexNames]
		const idx = this.objectStore[kIndexNames].indexOf(oldName);
		if (idx >= 0) {
			this.objectStore[kIndexNames][idx] = newName;
		}
		// Record for abort reversion
		this.#transaction[kRecordIndexRename](
			this,
			this.objectStore,
			oldName,
			newName,
		);
	}

	/** @internal - Revert name after transaction abort */
	[kRevertName](name: string): void {
		this.#name = name;
	}

	get keyPath(): string | string[] {
		// Spec: return same array instance on repeated access
		if (Array.isArray(this.#keyPath)) {
			if (!this.#keyPathCache) {
				this.#keyPathCache = [...this.#keyPath];
			}
			return this.#keyPathCache;
		}
		return this.#keyPath;
	}

	constructor(
		transaction: IDBTransaction,
		storeName: string,
		meta: IndexMeta,
		objectStore: any,
	) {
		this.#transaction = transaction;
		this.#storeName = storeName;
		this.#name = meta.name;
		this.#keyPath = meta.keyPath;
		this.unique = meta.unique;
		this.multiEntry = meta.multiEntry;
		this.objectStore = objectStore;
		this[kDeleted] = false;
		this.#keyPathCache = null;
	}

	get(query: IDBValidKey | IDBKeyRange): IDBRequest {
		this.#checkActive();
		if (!(query instanceof IDBKeyRange)) {
			validateKey(query);
		}
		const request = new IDBRequest();
		request[kSetSource](this);

		return this.#transaction[kExecuteRequest](request, (tx) => {
			if (query instanceof IDBKeyRange) {
				const results = tx.indexGetAll(
					this.#storeName,
					this.name,
					query[kToSpec](),
					1,
				);
				return results.length > 0 ? decodeValue(results[0].value) : undefined;
			}
			const encoded = encodeKey(validateKey(query));
			const record = tx.indexGet(this.#storeName, this.name, encoded);
			return record ? decodeValue(record.value) : undefined;
		});
	}

	getKey(query: IDBValidKey | IDBKeyRange): IDBRequest {
		this.#checkActive();
		if (!(query instanceof IDBKeyRange)) {
			validateKey(query);
		}
		const request = new IDBRequest();
		request[kSetSource](this);

		return this.#transaction[kExecuteRequest](request, (tx) => {
			if (query instanceof IDBKeyRange) {
				const keys = tx.indexGetAllKeys(
					this.#storeName,
					this.name,
					query[kToSpec](),
					1,
				);
				return keys.length > 0 ? decodeKey(keys[0]) : undefined;
			}
			const encoded = encodeKey(validateKey(query));
			const record = tx.indexGet(this.#storeName, this.name, encoded);
			return record ? decodeKey(record.key) : undefined;
		});
	}

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
			if (direction && direction !== "next") {
				// Use cursor for non-default directions
				const results: any[] = [];
				const cursor = tx.openIndexCursor(
					this.#storeName,
					this.name,
					range,
					direction as any,
				);
				if (cursor) {
					do {
						results.push(decodeValue(cursor.value));
						if (cnt !== undefined && results.length >= cnt) break;
					} while (cursor.continue());
				}
				return results;
			}
			const records = tx.indexGetAll(this.#storeName, this.name, range, cnt);
			return records.map((r) => decodeValue(r.value));
		});
	}

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
			if (direction && direction !== "next") {
				// Use cursor for non-default directions
				const results: any[] = [];
				const cursor = tx.openIndexKeyCursor(
					this.#storeName,
					this.name,
					range,
					direction as any,
				);
				if (cursor) {
					do {
						results.push(decodeKey(cursor.primaryKey));
						if (cnt !== undefined && results.length >= cnt) break;
					} while (cursor.continue());
				}
				return results;
			}
			return tx
				.indexGetAllKeys(this.#storeName, this.name, range, cnt)
				.map((k) => decodeKey(k));
		});
	}

	getAllRecords(options?: any): IDBRequest {
		this.#checkActive();
		const {query, count, direction} = parseGetAllArgs(options);
		if (count !== undefined) enforceRangeCount(count);
		const range = this.#toRangeSpec(query);
		const request = new IDBRequest();
		request[kSetSource](this);

		return this.#transaction[kExecuteRequest](request, (tx) => {
			// Use cursor-based iteration to get index key, primary key, and value
			const results: IDBRecord[] = [];
			const cursor = tx.openIndexCursor(
				this.#storeName,
				this.name,
				range,
				(direction || "next") as any,
			);
			if (cursor) {
				do {
					const record = tx.get(this.#storeName, cursor.primaryKey);
					results.push(
						new IDBRecord(
							decodeKey(cursor.key),
							decodeKey(cursor.primaryKey),
							record ? decodeValue(record.value) : undefined,
						),
					);
					if (count !== undefined && results.length >= count) break;
				} while (cursor.continue());
			}
			return results;
		});
	}

	count(query?: IDBValidKey | IDBKeyRange | null): IDBRequest {
		this.#checkActive();
		const range = this.#toRangeSpec(query);
		const request = new IDBRequest();
		request[kSetSource](this);

		return this.#transaction[kExecuteRequest](request, (tx) => {
			return tx.indexCount(this.#storeName, this.name, range);
		});
	}

	openCursor(
		query?: IDBValidKey | IDBKeyRange | null,
		direction?: IDBCursorDirection,
	): IDBRequest {
		this.#checkActive();
		const range = this.#toRangeSpec(query);
		const request = new IDBRequest();
		request[kSetSource](this);

		return this.#transaction[kExecuteRequest](request, (tx) => {
			const cursor = tx.openIndexCursor(
				this.#storeName,
				this.name,
				range,
				direction as any,
			);
			if (!cursor) return null;

			return this.#wrapCursor(cursor, request, direction);
		});
	}

	openKeyCursor(
		query?: IDBValidKey | IDBKeyRange | null,
		direction?: IDBCursorDirection,
	): IDBRequest {
		this.#checkActive();
		const range = this.#toRangeSpec(query);
		const request = new IDBRequest();
		request[kSetSource](this);

		return this.#transaction[kExecuteRequest](request, (tx) => {
			const cursor = tx.openIndexKeyCursor(
				this.#storeName,
				this.name,
				range,
				direction as any,
			);
			if (!cursor) return null;

			return this.#wrapKeyCursor(cursor, request, direction);
		});
	}

	#checkActive(): void {
		if (this[kDeleted] || this.objectStore[kDeleted]) {
			throw InvalidStateError("Index or its object store has been deleted");
		}
		if (!this.#transaction[kActive]) {
			throw TransactionInactiveError("Transaction is not active");
		}
	}

	#toRangeSpec(
		query: IDBValidKey | IDBKeyRange | null | undefined,
	): KeyRangeSpec | undefined {
		if (query == null) return undefined;
		if (query instanceof IDBKeyRange) return query[kToSpec]();
		const key = encodeKey(validateKey(query));
		return {lower: key, upper: key, lowerOpen: false, upperOpen: false};
	}

	#wrapCursor(
		backendCursor: any,
		request: IDBRequest,
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
