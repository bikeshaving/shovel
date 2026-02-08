/**
 * IDBIndex implementation.
 */

import {type IDBTransaction} from "./transaction.js";
import {IDBRequest} from "./request.js";
import {IDBKeyRange} from "./key-range.js";
import {IDBCursor, IDBCursorWithValue} from "./cursor.js";
import {encodeKey, decodeKey, validateKey} from "./key.js";
import {decodeValue} from "./structured-clone.js";
import {TransactionInactiveError} from "./errors.js";
import type {IndexMeta, KeyRangeSpec} from "./types.js";

export class IDBIndex {
	readonly name: string;
	readonly keyPath: string | string[];
	readonly unique: boolean;
	readonly multiEntry: boolean;
	readonly objectStore: any;

	#transaction: IDBTransaction;
	#storeName: string;

	constructor(
		transaction: IDBTransaction,
		storeName: string,
		meta: IndexMeta,
		objectStore: any,
	) {
		this.#transaction = transaction;
		this.#storeName = storeName;
		this.name = meta.name;
		this.keyPath = meta.keyPath;
		this.unique = meta.unique;
		this.multiEntry = meta.multiEntry;
		this.objectStore = objectStore;
	}

	get(query: IDBValidKey | IDBKeyRange): IDBRequest {
		this.#checkActive();
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
				return results.length > 0
					? decodeValue(results[0].value)
					: undefined;
			}
			const encoded = encodeKey(validateKey(query));
			const record = tx.indexGet(this.#storeName, this.name, encoded);
			return record ? decodeValue(record.value) : undefined;
		});
	}

	getKey(query: IDBValidKey | IDBKeyRange): IDBRequest {
		this.#checkActive();
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

	getAll(
		query?: IDBValidKey | IDBKeyRange | null,
		count?: number,
	): IDBRequest {
		this.#checkActive();
		const request = new IDBRequest();
		request._setSource(this);

		return this.#transaction._executeRequest(request, (tx) => {
			const range = this.#toRangeSpec(query);
			const records = tx.indexGetAll(
				this.#storeName,
				this.name,
				range,
				count,
			);
			return records.map((r) => decodeValue(r.value));
		});
	}

	getAllKeys(
		query?: IDBValidKey | IDBKeyRange | null,
		count?: number,
	): IDBRequest {
		this.#checkActive();
		const request = new IDBRequest();
		request._setSource(this);

		return this.#transaction._executeRequest(request, (tx) => {
			const range = this.#toRangeSpec(query);
			return tx
				.indexGetAllKeys(this.#storeName, this.name, range, count)
				.map((k) => decodeKey(k));
		});
	}

	count(query?: IDBValidKey | IDBKeyRange | null): IDBRequest {
		this.#checkActive();
		const request = new IDBRequest();
		request._setSource(this);

		return this.#transaction._executeRequest(request, (tx) => {
			const range = this.#toRangeSpec(query);
			return tx.indexCount(this.#storeName, this.name, range);
		});
	}

	openCursor(
		query?: IDBValidKey | IDBKeyRange | null,
		direction?: IDBCursorDirection,
	): IDBRequest {
		this.#checkActive();
		const request = new IDBRequest();
		request._setSource(this);

		return this.#transaction._executeRequest(request, (tx) => {
			const range = this.#toRangeSpec(query);
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
		const request = new IDBRequest();
		request._setSource(this);

		return this.#transaction._executeRequest(request, (tx) => {
			const range = this.#toRangeSpec(query);
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
