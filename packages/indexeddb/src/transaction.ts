/**
 * IDBTransaction implementation.
 *
 * Manages auto-commit: when no pending requests remain after all microtasks
 * settle, the transaction commits automatically. Events fire as macrotasks
 * (via setTimeout) per the IDB spec.
 */

import type {IDBBackendTransaction} from "./backend.js";
import {SafeEventTarget} from "./event-target.js";
import {IDBRequest} from "./request.js";
import {
	AbortError,
	InvalidStateError,
	TransactionInactiveError,
} from "./errors.js";
import {makeDOMStringList} from "./types.js";
import type {TransactionMode} from "./types.js";
import {IDBObjectStore} from "./object-store.js";
import {
	kScope,
	kParent,
	kBackendTx,
	kOnDone,
	kOnSyncAbort,
	kStart,
	kAborted,
	kActive,
	kFinished,
	kExecuteRequest,
	kAbortWithError,
	kRenameStoreInCache,
	kRecordIndexRename,
	kScheduleAutoCommit,
	kScheduleDeactivation,
	kDeactivate,
	kHoldOpen,
	kRelease,
	kSetTransaction,
	kResolve,
	kReject,
	kLastDispatchHadError,
	kGetStoreMeta,
	kConnection,
	kRefreshStoreNames,
	kIndexNames,
	kRevertName,
} from "./symbols.js";

export class IDBTransaction extends SafeEventTarget {
	readonly mode: TransactionMode;
	readonly [kScope]: string[]; // mutable internal list
	readonly durability: string;

	get [Symbol.toStringTag](): string {
		return "IDBTransaction";
	}

	#db: any; // IDBDatabase (avoid circular import)
	#backendTx: IDBBackendTransaction | null;
	#active!: boolean;
	#committed!: boolean;
	#aborted!: boolean;
	#commitPending!: boolean;
	#pendingRequests!: number;
	#error!: DOMException | null;
	#needsAbortEvent!: boolean;
	#storeCache!: Map<string, any>;
	/** Maps store instance → name before first rename in this transaction */
	#originalStoreNames!: Map<any, string>;
	/** Maps index instance → {store, name before first rename} */
	#originalIndexNames!: Map<any, {store: any; name: string}>;
	#initialScope!: string[];
	/** Buffered operations when backendTx is null (deferred start) */
	#pendingOps!: Array<{
		request: IDBRequest;
		operation: (tx: IDBBackendTransaction) => any;
	}> | null;
	/** @internal - Synchronous callback invoked during abort() before the event fires.
	 *  Used by the factory to revert frontend metadata synchronously. */
	[kOnSyncAbort]!: (() => void) | null;
	/** @internal - Called when the transaction finishes (committed or aborted).
	 *  Used by the scheduler to unblock waiting transactions. */
	[kOnDone]!: (() => void) | null;

	#oncompleteHandler!: ((ev: Event) => void) | null;
	#onerrorHandler!: ((ev: Event) => void) | null;
	#onabortHandler!: ((ev: Event) => void) | null;

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
		backendTx: IDBBackendTransaction | null,
		durability: string = "default",
	) {
		super();
		this.#active = true;
		this.#committed = false;
		this.#aborted = false;
		this.#commitPending = false;
		this.#pendingRequests = 0;
		this.#error = null;
		this.#needsAbortEvent = false;
		this.#storeCache = new Map();
		this.#originalStoreNames = new Map();
		this.#originalIndexNames = new Map();
		this.#pendingOps = null;
		this[kOnSyncAbort] = null;
		this[kOnDone] = null;
		this.#oncompleteHandler = null;
		this.#onerrorHandler = null;
		this.#onabortHandler = null;
		this.#db = db;
		this[kScope] = [...storeNames];
		this.#initialScope = [...storeNames];
		this.mode = mode;
		this.#backendTx = backendTx;
		this.durability = durability;
		if (!backendTx) {
			this.#pendingOps = [];
		}
	}

	get objectStoreNames(): DOMStringList {
		return makeDOMStringList(this[kScope]);
	}

	get db(): any {
		return this.#db;
	}

	get error(): DOMException | null {
		return this.#error;
	}

	/** @internal — only access when the transaction has started (non-null) */
	get [kBackendTx](): IDBBackendTransaction {
		return this.#backendTx!;
	}

	/** @internal */
	get [kActive](): boolean {
		return this.#active;
	}

	/** @internal — temporarily deactivate during structuredClone */
	set [kActive](value: boolean) {
		this.#active = value;
	}

	/** @internal - Start a deferred transaction (called by scheduler). */
	[kStart](backendTx: IDBBackendTransaction): void {
		this.#backendTx = backendTx;
		const ops = this.#pendingOps;
		this.#pendingOps = null;
		if (ops) {
			for (const {request, operation} of ops) {
				this.#executeOp(request, operation);
			}
		}
		// Reschedule auto-commit (may have been skipped due to null backendTx)
		this.#maybeAutoCommit();
	}

	/** @internal */
	get [kAborted](): boolean {
		return this.#aborted;
	}

	/** @internal - true if the transaction has committed or aborted */
	get [kFinished](): boolean {
		return this.#committed || this.#aborted;
	}

	/**
	 * Create an IDBObjectStore accessor for this transaction.
	 */
	objectStore(name: string): any {
		// Spec order: finished check before scope check
		if (this.#aborted || this.#committed) {
			throw InvalidStateError("Transaction is no longer active");
		}
		if (!this[kScope].includes(name)) {
			throw new DOMException(
				`Object store "${name}" is not in this transaction's scope`,
				"NotFoundError",
			);
		}
		// Return cached instance if available (spec: same object identity)
		const cached = this.#storeCache.get(name);
		if (cached) return cached;
		const meta = this.#db[kGetStoreMeta](name);
		const store = new IDBObjectStore(this, meta);
		// Populate indexNames from database metadata
		const dbMeta = this.#db[kConnection].getMetadata();
		const indexes = dbMeta.indexes.get(name) || [];
		for (const idx of indexes) {
			if (!store[kIndexNames].includes(idx.name)) {
				store[kIndexNames].push(idx.name);
			}
		}
		this.#storeCache.set(name, store);
		return store;
	}

	/**
	 * Abort the transaction.
	 */
	abort(): void {
		if (this.#committed || this.#aborted || this.#commitPending) {
			throw InvalidStateError("Transaction already finished");
		}
		this.#aborted = true;
		this.#active = false;
		if (this.#backendTx) {
			this.#backendTx.abort();
		}
		this.#revertRenames();
		// Invoke synchronous metadata revert (e.g. factory marks stores as deleted)
		this[kOnSyncAbort]?.();
		// Clear buffered ops — they'll never execute
		if (this.#pendingOps) {
			this.#pendingRequests -= this.#pendingOps.length;
			this.#pendingOps = null;
		}

		this.#error = AbortError("Transaction was aborted");

		if (this.mode === ("versionchange" as TransactionMode)) {
			// Spec: abort event fires after abort() returns and after one level
			// of microtasks, so code after abort() AND Promise.resolve().then()
			// still see request.transaction and db[kUpgradeTx] set.
			// Double-nested microtask ensures the abort event fires within the
			// same macrotask's microtask checkpoint (no other setTimeout
			// callbacks can interleave).
			queueMicrotask(() => {
				queueMicrotask(() => {
					this.dispatchEvent(
						new Event("abort", {bubbles: true, cancelable: false}),
					);
					this[kOnDone]?.();
				});
			});
		} else {
			this.dispatchEvent(
				new Event("abort", {bubbles: true, cancelable: false}),
			);
			this[kOnDone]?.();
		}
	}

	/** @internal - Update store cache when a store is renamed */
	[kRenameStoreInCache](oldName: string, newName: string, store: any): void {
		this.#storeCache.delete(oldName);
		this.#storeCache.set(newName, store);
		// Record original name only on first rename
		if (!this.#originalStoreNames.has(store)) {
			this.#originalStoreNames.set(store, oldName);
		}
	}

	/** @internal - Record an index rename for abort reversion */
	[kRecordIndexRename](
		index: any,
		store: any,
		oldName: string,
		_newName: string,
	): void {
		// Record original name only on first rename
		if (!this.#originalIndexNames.has(index)) {
			this.#originalIndexNames.set(index, {store, name: oldName});
		}
	}

	#revertRenames(): void {
		// After backend abort, metadata reflects pre-transaction state.
		// Only revert names for pre-existing stores/indexes (not created in this tx).
		const meta = this.#db[kConnection].getMetadata();

		// Revert index renames — only for indexes that existed before this tx
		for (const [index, {store, name: originalName}] of this
			.#originalIndexNames) {
			const storeOrigName = this.#originalStoreNames.has(store)
				? this.#originalStoreNames.get(store)!
				: store.name;
			// Check if the index existed in the backend's reverted state
			const storeIndexes = meta.indexes.get(storeOrigName) || [];
			const indexExisted = storeIndexes.some(
				(i: any) => i.name === originalName,
			);
			if (!indexExisted) continue;
			const currentName = index.name;
			if (currentName === originalName) continue;
			index[kRevertName](originalName);
			const idxNames: string[] = store[kIndexNames];
			const pos = idxNames.indexOf(currentName);
			if (pos >= 0) idxNames[pos] = originalName;
		}
		// Revert store renames — only for pre-existing stores
		for (const [store, originalName] of this.#originalStoreNames) {
			if (!this.#initialScope.includes(originalName)) continue;
			const currentName = store.name;
			if (currentName === originalName) continue;
			store[kRevertName](originalName);
			const pos = this[kScope].indexOf(currentName);
			if (pos >= 0) this[kScope][pos] = originalName;
			this.#storeCache.delete(currentName);
			this.#storeCache.set(originalName, store);
		}
		this.#db[kRefreshStoreNames]();
	}

	/**
	 * Explicitly commit the transaction.
	 */
	commit(): void {
		if (this.#committed || this.#aborted || this.#commitPending) {
			throw InvalidStateError("Transaction already finished");
		}
		if (!this.#active) {
			throw InvalidStateError("Transaction is not active");
		}
		this.#active = false;
		this.#commitPending = true;
		if (this.#pendingRequests === 0) {
			if (!this.#backendTx) return; // Deferred — will commit after _start
			// Spec: commit is asynchronous — double-nested microtask so
			// EventWatcher promise chains have time to register listeners.
			queueMicrotask(() => {
				queueMicrotask(() => {
					if (!this.#aborted && !this.#committed) {
						this.#doCommit();
					}
				});
			});
		}
	}

	/** @internal - Abort with a specific error (for async constraint violations).
	 * Defers the abort event until all pending requests have fired their errors,
	 * matching the spec ordering: request errors first, then abort event. */
	[kAbortWithError](error: DOMException): void {
		if (this.#committed || this.#aborted) return;
		this.#aborted = true;
		this.#active = false;
		if (this.#backendTx) {
			this.#backendTx.abort();
		}
		this.#revertRenames();
		this[kOnSyncAbort]?.();
		// Clear buffered ops
		if (this.#pendingOps) {
			this.#pendingRequests -= this.#pendingOps.length;
			this.#pendingOps = null;
		}
		this.#error = error;
		if (this.#pendingRequests > 0) {
			// Pending requests will fire their error events first.
			// The abort event fires when the last one settles.
			this.#needsAbortEvent = true;
		} else {
			// Defer abort event by one microtask so that promise chains
			// listening for 'error' have time to set up their 'abort' listener.
			queueMicrotask(() => {
				this.dispatchEvent(
					new Event("abort", {bubbles: true, cancelable: false}),
				);
				this[kOnDone]?.();
			});
		}
	}

	/** @internal - Execute a request within this transaction */
	[kExecuteRequest](
		request: IDBRequest,
		operation: (tx: IDBBackendTransaction) => any,
	): IDBRequest {
		if (!this.#active) {
			throw TransactionInactiveError("Transaction is not active");
		}

		request[kSetTransaction](this);
		// Set parent for event bubbling: request → transaction → database
		(request as any)[kParent] = this;
		this.#pendingRequests++;

		if (!this.#backendTx) {
			// Transaction not yet started (deferred by scheduler) — buffer
			this.#pendingOps!.push({request, operation});
			return request;
		}

		this.#executeOp(request, operation);
		return request;
	}

	#executeOp(
		request: IDBRequest,
		operation: (tx: IDBBackendTransaction) => any,
	): void {
		// Execute synchronously (memory/SQLite backends are sync)
		try {
			const result = operation(this.#backendTx!);
			// Fire success as a macrotask (IDB spec: events fire as tasks)
			setTimeout(() => {
				this.#pendingRequests--;
				if (this.#aborted) {
					// Transaction was aborted — fire error event with AbortError
					request[kReject](AbortError("Transaction was aborted"));
					this.#maybeFireDeferredAbort();
					return;
				}
				// Spec: transaction is active during event dispatch
				this.#active = true;
				const hadError = request[kResolve](result);
				// Deactivate after microtask checkpoint so Promise.resolve().then()
				// in handlers still sees active, but setTimeout(0) sees inactive.
				this[kScheduleDeactivation]();
				if (
					hadError &&
					!this.#aborted &&
					!this.#committed &&
					!this.#commitPending
				) {
					// Exception thrown during success dispatch → abort
					// (but not if commit() was explicitly called)
					this[kAbortWithError](
						AbortError("An exception was thrown in an event handler"),
					);
				} else if (this.#commitPending && this.#pendingRequests === 0) {
					this.#doCommit();
				} else {
					this.#maybeAutoCommit();
				}
			});
		} catch (error) {
			setTimeout(() => {
				this.#pendingRequests--;
				if (this.#aborted) {
					// Transaction was already aborted — fire error on request
					request[kReject](AbortError("Transaction was aborted"));
					this.#maybeFireDeferredAbort();
					return;
				}
				const domError =
					error instanceof DOMException
						? error
						: new DOMException(String(error), "UnknownError");
				// Spec: transaction is active during event dispatch
				this.#active = true;
				const prevented = request[kReject](domError);
				// Deactivate after microtask checkpoint
				this[kScheduleDeactivation]();
				if (
					request[kLastDispatchHadError] &&
					!this.#aborted &&
					!this.#committed &&
					!this.#commitPending
				) {
					// Exception thrown during error dispatch → abort with AbortError
					this[kAbortWithError](
						AbortError("An exception was thrown in an event handler"),
					);
				} else if (prevented) {
					// preventDefault() was called — transaction continues
					if (this.#commitPending && this.#pendingRequests === 0) {
						// Defer commit by one microtask so that promise chains
						// listening for 'error' have time to set up their 'complete' listener.
						queueMicrotask(() => {
							if (!this.#aborted && !this.#committed) {
								this.#doCommit();
							}
						});
					} else {
						this.#maybeAutoCommit();
					}
				} else if (!this.#aborted && !this.#committed) {
					// Abort the transaction, deferring the abort event
					// until all pending requests have fired their errors
					this[kAbortWithError](domError);
				}
			});
		}
	}

	/** @internal - Deactivate the transaction (end of upgradeneeded) */
	[kDeactivate](): void {
		this.#active = false;
	}

	/** @internal - Reactivate after upgradeneeded for auto-commit */
	[kScheduleAutoCommit](): void {
		queueMicrotask(() => {
			if (!this.#aborted && !this.#committed && this.#pendingRequests === 0) {
				if (!this.#backendTx) return; // Deferred — _start will trigger
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
		if (this.#aborted) {
			this.#maybeFireDeferredAbort();
		} else {
			this.#maybeAutoCommit();
		}
	}

	#maybeFireDeferredAbort(): void {
		if (this.#needsAbortEvent && this.#pendingRequests === 0) {
			this.#needsAbortEvent = false;
			this.dispatchEvent(
				new Event("abort", {bubbles: true, cancelable: false}),
			);
			this[kOnDone]?.();
		}
	}

	/** @internal - Schedule deactivation after all microtasks from the current
	 * event dispatch settle. Double-nested so Promise.resolve().then() in
	 * handlers still sees active, but setTimeout(0) sees inactive. */
	[kScheduleDeactivation](): void {
		queueMicrotask(() => {
			queueMicrotask(() => {
				if (!this.#committed && !this.#aborted) {
					this.#active = false;
				}
			});
		});
	}

	#maybeAutoCommit(): void {
		if (this.#pendingRequests === 0 && !this.#committed && !this.#aborted) {
			if (!this.#backendTx) return; // Deferred — _start will trigger
			// Double-nested microtask: ensures auto-commit runs after promise
			// continuations from EventWatcher/promiseForRequest chains settle.
			// Since events fire as macrotasks (via setTimeout), these microtasks
			// run within that macrotask's microtask checkpoint — after promise
			// chains but before the event loop yields to timers.
			queueMicrotask(() => {
				if (this.#pendingRequests === 0 && !this.#committed && !this.#aborted) {
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
			});
		}
	}

	#doCommit(): void {
		if (this.#aborted || this.#committed) return; // Safety guard
		this.#committed = true;
		this.#active = false;

		try {
			this.#backendTx!.commit();
		} catch (error) {
			this.#error =
				error instanceof DOMException
					? error
					: new DOMException(String(error), "UnknownError");
			this.dispatchEvent(
				new Event("error", {bubbles: true, cancelable: false}),
			);
			this[kOnDone]?.();
			return;
		}

		this.dispatchEvent(
			new Event("complete", {bubbles: false, cancelable: false}),
		);
		this[kOnDone]?.();
	}
}
