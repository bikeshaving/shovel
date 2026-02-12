/**
 * IDBRequest and IDBOpenDBRequest implementations.
 */

import {SafeEventTarget} from "./event-target.js";
import {IDBVersionChangeEvent} from "./events.js";

export type IDBRequestReadyState = "pending" | "done";

/**
 * IDBRequest - represents an async operation on the database.
 */
export class IDBRequest extends SafeEventTarget {
	#result: any = undefined;
	#error: DOMException | null = null;
	#readyState: IDBRequestReadyState = "pending";
	#source: any = null;
	#transaction: any = null;

	#onsuccessHandler: ((ev: Event) => void) | null = null;
	#onerrorHandler: ((ev: Event) => void) | null = null;

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
	_setSource(source: any): void {
		this.#source = source;
	}

	/** @internal */
	_setTransaction(txn: any): void {
		this.#transaction = txn;
	}

	/** @internal - Set result without firing events (for upgradeneeded) */
	_resolveWithoutEvent(result: any): void {
		this.#readyState = "done";
		this.#result = result;
		this.#error = null;
	}

	/** @internal - Set result without firing events (base for subclass event dispatch) */
	_resolveRaw(result: any): void {
		this.#readyState = "done";
		this.#result = result;
		this.#error = null;
	}

	/** @internal - Resolve the request with a result */
	_resolve(result: any): void {
		// Guard: if already rejected (e.g., abort handler fired first), skip
		if (this.#error !== null) return;
		this.#readyState = "done";
		this.#result = result;
		this.dispatchEvent(
			new Event("success", {bubbles: false, cancelable: false}),
		);
	}

	/** @internal - Reject the request with an error.
	 * Returns true if preventDefault() was called on the error event. */
	_reject(error: DOMException): boolean {
		this.#readyState = "done";
		this.#error = error;
		this.#result = undefined;
		const event = new Event("error", {bubbles: true, cancelable: true});
		this.dispatchEvent(event);
		return event.defaultPrevented;
	}
}

/**
 * IDBOpenDBRequest - result of IDBFactory.open() or IDBFactory.deleteDatabase()
 */
export class IDBOpenDBRequest extends IDBRequest {
	#onblockedHandler: ((ev: Event) => void) | null = null;
	#onupgradeneededHandler: ((ev: IDBVersionChangeEvent) => void) | null = null;

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
			this.removeEventListener("upgradeneeded", this.#onupgradeneededHandler as EventListener);
		}
		this.#onupgradeneededHandler = handler;
		if (handler) {
			this.addEventListener("upgradeneeded", handler as EventListener);
		}
	}

	/** @internal - Resolve with IDBVersionChangeEvent (for deleteDatabase success) */
	_resolveWithVersionChange(result: any, oldVersion: number): void {
		(this as any)._resolveRaw(result);
		this.dispatchEvent(
			new IDBVersionChangeEvent("success", {
				oldVersion,
				newVersion: null as any,
			}),
		);
	}

	/** @internal */
	_fireUpgradeNeeded(oldVersion: number, newVersion: number): void {
		this.dispatchEvent(
			new IDBVersionChangeEvent("upgradeneeded", {
				oldVersion,
				newVersion,
			}),
		);
	}

	/** @internal */
	_fireBlocked(oldVersion: number, newVersion: number | null): void {
		this.dispatchEvent(
			new IDBVersionChangeEvent("blocked", {
				oldVersion,
				newVersion,
			}),
		);
	}
}
