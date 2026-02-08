/**
 * IDBTransaction implementation.
 *
 * Manages auto-commit: when no pending requests remain at microtask boundary,
 * the transaction commits automatically.
 */

import type {IDBBackendTransaction} from "./backend.js";
import {SafeEventTarget} from "./event-target.js";
import {IDBRequest} from "./request.js";
import {AbortError, InvalidStateError, TransactionInactiveError} from "./errors.js";
import type {TransactionMode} from "./types.js";

/** Hold the transaction open (increment pending count). Pair with kRelease. */
export const kHoldOpen = Symbol("holdOpen");

/** Release a hold on the transaction (decrement pending count). */
export const kRelease = Symbol("release");

export class IDBTransaction extends SafeEventTarget {
	readonly mode: TransactionMode;
	readonly objectStoreNames: string[];

	#db: any; // IDBDatabase (avoid circular import)
	#backendTx: IDBBackendTransaction;
	#active: boolean = true;
	#committed: boolean = false;
	#aborted: boolean = false;
	#pendingRequests: number = 0;
	#error: DOMException | null = null;

	#oncompleteHandler: ((ev: Event) => void) | null = null;
	#onerrorHandler: ((ev: Event) => void) | null = null;
	#onabortHandler: ((ev: Event) => void) | null = null;

	get oncomplete(): ((ev: Event) => void) | null {
		return this.#oncompleteHandler;
	}
	set oncomplete(handler: ((ev: Event) => void) | null) {
		if (this.#oncompleteHandler) {
			this.removeEventListener("complete", this.#oncompleteHandler);
		}
		this.#oncompleteHandler = handler;
		if (handler) {
			this.addEventListener("complete", handler);
		}
	}

	get onerror(): ((ev: Event) => void) | null {
		return this.#onerrorHandler;
	}
	set onerror(handler: ((ev: Event) => void) | null) {
		if (this.#onerrorHandler) {
			this.removeEventListener("error", this.#onerrorHandler);
		}
		this.#onerrorHandler = handler;
		if (handler) {
			this.addEventListener("error", handler);
		}
	}

	get onabort(): ((ev: Event) => void) | null {
		return this.#onabortHandler;
	}
	set onabort(handler: ((ev: Event) => void) | null) {
		if (this.#onabortHandler) {
			this.removeEventListener("abort", this.#onabortHandler);
		}
		this.#onabortHandler = handler;
		if (handler) {
			this.addEventListener("abort", handler);
		}
	}

	constructor(
		db: any,
		storeNames: string[],
		mode: TransactionMode,
		backendTx: IDBBackendTransaction,
	) {
		super();
		this.#db = db;
		this.objectStoreNames = storeNames;
		this.mode = mode;
		this.#backendTx = backendTx;
	}

	get db(): any {
		return this.#db;
	}

	get error(): DOMException | null {
		return this.#error;
	}

	/** @internal */
	get _backendTx(): IDBBackendTransaction {
		return this.#backendTx;
	}

	/** @internal */
	get _active(): boolean {
		return this.#active;
	}

	/**
	 * Create an IDBObjectStore accessor for this transaction.
	 */
	objectStore(name: string): any {
		if (!this.objectStoreNames.includes(name)) {
			throw new DOMException(
				`Object store "${name}" is not in this transaction's scope`,
				"NotFoundError",
			);
		}
		if (this.#aborted || this.#committed) {
			throw InvalidStateError("Transaction is no longer active");
		}
		// Lazy import to avoid circular dependency
		const {IDBObjectStore} = require("./object-store.js");
		const meta = this.#db._getStoreMeta(name);
		const store = new IDBObjectStore(this, meta);
		// Populate indexNames from database metadata
		const dbMeta = this.#db._connection.getMetadata();
		const indexes = dbMeta.indexes.get(name) || [];
		for (const idx of indexes) {
			if (!store.indexNames.includes(idx.name)) {
				store.indexNames.push(idx.name);
			}
		}
		return store;
	}

	/**
	 * Abort the transaction.
	 */
	abort(): void {
		if (this.#committed || this.#aborted) {
			throw InvalidStateError("Transaction already finished");
		}
		this.#aborted = true;
		this.#active = false;
		this.#backendTx.abort();

		this.#error = AbortError("Transaction was aborted");

		this.dispatchEvent(
			new Event("abort", {bubbles: true, cancelable: false}),
		);
	}

	/**
	 * Explicitly commit the transaction.
	 */
	commit(): void {
		if (this.#committed || this.#aborted) {
			throw InvalidStateError("Transaction already finished");
		}
		this.#doCommit();
	}

	/** @internal - Execute a request within this transaction */
	_executeRequest(
		request: IDBRequest,
		operation: (tx: IDBBackendTransaction) => any,
	): IDBRequest {
		if (!this.#active) {
			throw TransactionInactiveError("Transaction is not active");
		}

		request._setTransaction(this);
		this.#pendingRequests++;

		// Execute synchronously (memory/SQLite backends are sync)
		try {
			const result = operation(this.#backendTx);
			// Fire success via microtask
			queueMicrotask(() => {
				request._resolve(result);
				this.#pendingRequests--;
				this.#maybeAutoCommit();
			});
		} catch (error) {
			queueMicrotask(() => {
				request._reject(
					error instanceof DOMException
						? error
						: new DOMException(String(error), "UnknownError"),
				);
				this.#pendingRequests--;
				// On error, abort the transaction
				if (!this.#aborted && !this.#committed) {
					this.abort();
				}
			});
		}

		return request;
	}

	/** @internal - Deactivate the transaction (end of upgradeneeded) */
	_deactivate(): void {
		this.#active = false;
	}

	/** @internal - Reactivate after upgradeneeded for auto-commit */
	_scheduleAutoCommit(): void {
		queueMicrotask(() => {
			if (!this.#aborted && !this.#committed && this.#pendingRequests === 0) {
				this.#doCommit();
			}
		});
	}

	/** Hold the transaction open (e.g. during cursor iteration). */
	[kHoldOpen](): void {
		this.#pendingRequests++;
	}

	/** Release a hold, allowing auto-commit when all pending work is done. */
	[kRelease](): void {
		this.#pendingRequests--;
		this.#maybeAutoCommit();
	}

	#maybeAutoCommit(): void {
		if (
			this.#pendingRequests === 0 &&
			!this.#committed &&
			!this.#aborted
		) {
			// Schedule auto-commit at end of microtask
			queueMicrotask(() => {
				if (
					this.#pendingRequests === 0 &&
					!this.#committed &&
					!this.#aborted
				) {
					this.#doCommit();
				}
			});
		}
	}

	#doCommit(): void {
		this.#committed = true;
		this.#active = false;

		try {
			this.#backendTx.commit();
		} catch (error) {
			this.#error =
				error instanceof DOMException
					? error
					: new DOMException(String(error), "UnknownError");
			this.dispatchEvent(
				new Event("error", {bubbles: true, cancelable: false}),
			);
			return;
		}

		this.dispatchEvent(
			new Event("complete", {bubbles: false, cancelable: false}),
		);
	}
}
