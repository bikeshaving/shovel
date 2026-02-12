/**
 * IDBIndex implementation.
 */

import {type IDBTransaction} from "./transaction.js";
import {IDBRequest} from "./request.js";
import {IDBKeyRange} from "./key-range.js";
import {IDBCursor, IDBCursorWithValue} from "./cursor.js";
import {encodeKey, decodeKey, validateKey} from "./key.js";
import {decodeValue} from "./structured-clone.js";
import {TransactionInactiveError, InvalidStateError} from "./errors.js";
import type {IndexMeta, KeyRangeSpec} from "./types.js";

function enforceRangeCount(count: unknown): void {
	const n = Number(count);
	if (!Number.isFinite(n) || n < 0 || n > 0xffffffff) {
		throw new TypeError(
			`The count parameter is not a valid unsigned long value.`,
		);
	}
}

export class IDBIndex {
	readonly unique: boolean;
	readonly multiEntry: boolean;
	readonly objectStore: any;
	_deleted!: boolean;

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
		if (!this.#transaction._active) {
			throw TransactionInactiveError("Transaction is not active");
		}
		if (this._deleted || this.objectStore._deleted) {
			throw InvalidStateError("Index or its object store has been deleted");
		}
		const oldName = this.#name;
		if (newName === oldName) return;
		// Spec: ConstraintError if an index with the new name already exists on the same store
		if (this.objectStore._indexNames.includes(newName)) {
			throw new DOMException(
				`Index "${newName}" already exists on store "${this.#storeName}"`,
				"ConstraintError",
			);
		}
		// Rename in backend
		this.#transaction._backendTx.renameIndex(this.#storeName, oldName, newName);
		this.#name = newName;
		// Update objectStore._indexNames
		const idx = this.objectStore._indexNames.indexOf(oldName);
		if (idx >= 0) {
			this.objectStore._indexNames[idx] = newName;
		}
		// Record for abort reversion
		this.#transaction._recordIndexRename(this, this.objectStore, oldName, newName);
	}

	/** @internal - Revert name after transaction abort */
	_revertName(name: string): void {
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
		this._deleted = false;
		this.#keyPathCache = null;
	}

	get(query: IDBValidKey | IDBKeyRange): IDBRequest {
		this.#checkActive();
		if (!(query instanceof IDBKeyRange)) {
			validateKey(query);
		}
		const request = new IDBRequest();
		request._setSource(this);

		return this.#transaction._executeRequest(request, (tx) => {
			if (query instanceof IDBKeyRange) {
				const results = tx.indexGetAll(
					this.#storeName,
					this.name,
					query._toSpec(),
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
		request._setSource(this);

		return this.#transaction._executeRequest(request, (tx) => {
			if (query instanceof IDBKeyRange) {
				const keys = tx.indexGetAllKeys(
					this.#storeName,
					this.name,
					query._toSpec(),
					1,
				);
				return keys.length > 0 ? decodeKey(keys[0]) : undefined;
			}
			const encoded = encodeKey(validateKey(query));
			const record = tx.indexGet(this.#storeName, this.name, encoded);
			return record ? decodeKey(record.key) : undefined;
		});
	}

	getAll(query?: IDBValidKey | IDBKeyRange | null, count?: number): IDBRequest {
		this.#checkActive();
		if (count !== undefined) enforceRangeCount(count);
		const range = this.#toRangeSpec(query);
		const request = new IDBRequest();
		request._setSource(this);

		return this.#transaction._executeRequest(request, (tx) => {
			const records = tx.indexGetAll(this.#storeName, this.name, range, count);
			return records.map((r) => decodeValue(r.value));
		});
	}

	getAllKeys(
		query?: IDBValidKey | IDBKeyRange | null,
		count?: number,
	): IDBRequest {
		this.#checkActive();
		if (count !== undefined) enforceRangeCount(count);
		const range = this.#toRangeSpec(query);
		const request = new IDBRequest();
		request._setSource(this);

		return this.#transaction._executeRequest(request, (tx) => {
			return tx
				.indexGetAllKeys(this.#storeName, this.name, range, count)
				.map((k) => decodeKey(k));
		});
	}

	count(query?: IDBValidKey | IDBKeyRange | null): IDBRequest {
		this.#checkActive();
		const range = this.#toRangeSpec(query);
		const request = new IDBRequest();
		request._setSource(this);

		return this.#transaction._executeRequest(request, (tx) => {
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
		request._setSource(this);

		return this.#transaction._executeRequest(request, (tx) => {
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
		request._setSource(this);

		return this.#transaction._executeRequest(request, (tx) => {
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
		if (this._deleted || this.objectStore._deleted) {
			throw InvalidStateError("Index or its object store has been deleted");
		}
		if (!this.#transaction._active) {
			throw TransactionInactiveError("Transaction is not active");
		}
	}

	#toRangeSpec(
		query: IDBValidKey | IDBKeyRange | null | undefined,
	): KeyRangeSpec | undefined {
		if (query == null) return undefined;
		if (query instanceof IDBKeyRange) return query._toSpec();
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
