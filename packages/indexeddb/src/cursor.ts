/**
 * IDBCursor and IDBCursorWithValue implementations.
 *
 * These classes provide the cursor interface used by object stores and indexes.
 * Backend cursors handle data traversal; these wrappers handle key decoding,
 * value decoding, and event integration (continue/advance fire success events).
 */

import {type IDBTransaction, kHoldOpen, kRelease} from "./transaction.js";
import {type IDBRequest} from "./request.js";
import {encodeKey, decodeKey, validateKey} from "./key.js";
import {decodeValue} from "./structured-clone.js";
import {TransactionInactiveError} from "./errors.js";
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
		this._gotValue = false;
	}

	get key(): IDBValidKey {
		return decodeKey(this._backendCursor.key);
	}

	get primaryKey(): IDBValidKey {
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
		if (key !== undefined) {
			const validated = validateKey(key);
			const encoded = encodeKey(validated);
			// Validate key direction
			this._validateContinueKey(encoded);
		}
		this._gotValue = false;
		this._transaction[kHoldOpen]();
		const next = this._backendCursor.continue();
		queueMicrotask(() => {
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
		this._gotValue = false;
		this._transaction[kHoldOpen]();
		let advanced = true;
		for (let i = 0; i < count && advanced; i++) {
			advanced = this._backendCursor.continue();
		}
		queueMicrotask(() => {
			this._request._resolve(advanced ? this : null);
			this._transaction[kRelease]();
		});
	}

	_validateContinueKey(_encoded: Uint8Array): void {
		// Subclasses can override for direction-specific validation
	}
}

/**
 * IDBCursorWithValue — iterates over records with values.
 */
export class IDBCursorWithValue extends IDBCursor {
	get value(): any {
		return decodeValue(this._backendCursor.value);
	}

	delete(): IDBRequest {
		if (!this._transaction._active) {
			throw TransactionInactiveError("Transaction is not active");
		}
		return this._source.delete(this.primaryKey);
	}

	update(value: any): IDBRequest {
		if (!this._transaction._active) {
			throw TransactionInactiveError("Transaction is not active");
		}
		return this._source.put(value);
	}
}
