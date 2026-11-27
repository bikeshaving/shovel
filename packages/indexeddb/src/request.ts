/**
 * IDBRequest and IDBOpenDBRequest implementations.
 */

import {SafeEventTarget} from "./event-target.js";
import {IDBVersionChangeEvent} from "./events.js";
import {
	kSetSource,
	kSetTransaction,
	kResolveWithoutEvent,
	kResolveRaw,
	kResolve,
	kReject,
	kLastDispatchHadError,
	kResolveWithVersionChange,
	kFireUpgradeNeeded,
	kFireBlocked,
} from "./symbols.js";

export type IDBRequestReadyState = "pending" | "done";

/**
 * IDBRequest - represents an async operation on the database.
 */
export class IDBRequest extends SafeEventTarget {
	#result!: any;
	#error!: DOMException | null;
	#readyState!: IDBRequestReadyState;
	#source!: any;
	#transaction!: any;

	#onsuccessHandler!: ((ev: Event) => void) | null;
	#onerrorHandler!: ((ev: Event) => void) | null;

	constructor() {
		super();
		this.#result = undefined;
		this.#error = null;
		this.#readyState = "pending";
		this.#source = null;
		this.#transaction = null;
		this.#onsuccessHandler = null;
		this.#onerrorHandler = null;
		this[kLastDispatchHadError] = false;
	}

	get [Symbol.toStringTag](): string {
		return "IDBRequest";
	}

	get onsuccess(): ((ev: Event) => void) | null {
		return this.#onsuccessHandler;
	}
	set onsuccess(handler: ((ev: Event) => void) | null) {
		if (this.#onsuccessHandler) {
			this.removeEventListener("success", this.#onsuccessHandler);
		}
		this.#onsuccessHandler = handler;
		if (handler) {
			this.addEventListener("success", handler);
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

	get result(): any {
		if (this.#readyState === "pending") {
			throw new DOMException(
				"The request has not finished",
				"InvalidStateError",
			);
		}
		return this.#result;
	}

	get error(): DOMException | null {
		if (this.#readyState === "pending") {
			throw new DOMException(
				"The request has not finished",
				"InvalidStateError",
			);
		}
		return this.#error;
	}

	get readyState(): IDBRequestReadyState {
		return this.#readyState;
	}

	get source(): any {
		return this.#source;
	}

	get transaction(): any {
		return this.#transaction;
	}

	/** @internal */
	[kSetSource](source: any): void {
		this.#source = source;
	}

	/** @internal */
	[kSetTransaction](txn: any): void {
		this.#transaction = txn;
	}

	/** @internal - Set result without firing events (for upgradeneeded) */
	[kResolveWithoutEvent](result: any): void {
		this.#readyState = "done";
		this.#result = result;
		this.#error = null;
	}

	/** @internal - Set result without firing events (base for subclass event dispatch) */
	[kResolveRaw](result: any): void {
		this.#readyState = "done";
		this.#result = result;
		this.#error = null;
	}

	/** @internal - Resolve the request with a result.
	 * Returns true if an exception was thrown during dispatch. */
	[kResolve](result: any): boolean {
		// Guard: if already rejected (e.g., abort handler fired first), skip
		if (this.#error !== null) return false;
		this.#readyState = "done";
		this.#result = result;
		const event = new Event("success", {bubbles: false, cancelable: false});
		this.dispatchEvent(event);
		return !!(event as any)._dispatchHadError;
	}

	/** @internal - true if the last dispatch had an exception thrown in a handler */
	[kLastDispatchHadError]!: boolean;

	/** @internal - Reject the request with an error.
	 * Returns true if preventDefault() was called and no exception was thrown. */
	[kReject](error: DOMException): boolean {
		this.#readyState = "done";
		this.#error = error;
		this.#result = undefined;
		const event = new Event("error", {bubbles: true, cancelable: true});
		this.dispatchEvent(event);
		this[kLastDispatchHadError] = !!(event as any)._dispatchHadError;
		// Spec: if an exception was thrown during dispatch, treat as not prevented
		if (this[kLastDispatchHadError]) return false;
		return event.defaultPrevented;
	}
}

/**
 * IDBOpenDBRequest - result of IDBFactory.open() or IDBFactory.deleteDatabase()
 */
export class IDBOpenDBRequest extends IDBRequest {
	#onblockedHandler!: ((ev: Event) => void) | null;
	#onupgradeneededHandler!: ((ev: IDBVersionChangeEvent) => void) | null;

	constructor() {
		super();
		this.#onblockedHandler = null;
		this.#onupgradeneededHandler = null;
	}

	get [Symbol.toStringTag](): string {
		return "IDBOpenDBRequest";
	}

	get onblocked(): ((ev: Event) => void) | null {
		return this.#onblockedHandler;
	}
	set onblocked(handler: ((ev: Event) => void) | null) {
		if (this.#onblockedHandler) {
			this.removeEventListener("blocked", this.#onblockedHandler);
		}
		this.#onblockedHandler = handler;
		if (handler) {
			this.addEventListener("blocked", handler as EventListener);
		}
	}

	get onupgradeneeded(): ((ev: IDBVersionChangeEvent) => void) | null {
		return this.#onupgradeneededHandler;
	}
	set onupgradeneeded(handler: ((ev: IDBVersionChangeEvent) => void) | null) {
		if (this.#onupgradeneededHandler) {
			this.removeEventListener(
				"upgradeneeded",
				this.#onupgradeneededHandler as EventListener,
			);
		}
		this.#onupgradeneededHandler = handler;
		if (handler) {
			this.addEventListener("upgradeneeded", handler as EventListener);
		}
	}

	/** @internal - Resolve with IDBVersionChangeEvent (for deleteDatabase success) */
	[kResolveWithVersionChange](result: any, oldVersion: number): void {
		(this as any)[kResolveRaw](result);
		this.dispatchEvent(
			new IDBVersionChangeEvent("success", {
				oldVersion,
				newVersion: null as any,
			}),
		);
	}

	/** @internal - Returns true if an exception was thrown during dispatch. */
	[kFireUpgradeNeeded](oldVersion: number, newVersion: number): boolean {
		const event = new IDBVersionChangeEvent("upgradeneeded", {
			oldVersion,
			newVersion,
		});
		this.dispatchEvent(event);
		return !!(event as any)._dispatchHadError;
	}

	/** @internal */
	[kFireBlocked](oldVersion: number, newVersion: number | null): void {
		this.dispatchEvent(
			new IDBVersionChangeEvent("blocked", {
				oldVersion,
				newVersion,
			}),
		);
	}
}
