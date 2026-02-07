/**
 * IDBRequest and IDBOpenDBRequest implementations.
 */

import {IDBVersionChangeEvent} from "./events.js";

export type IDBRequestReadyState = "pending" | "done";

/**
 * IDBRequest - represents an async operation on the database.
 */
export class IDBRequest extends EventTarget {
	#result: any = undefined;
	#error: DOMException | null = null;
	#readyState: IDBRequestReadyState = "pending";
	#source: any = null;
	#transaction: any = null;

	onsuccess: ((ev: Event) => void) | null = null;
	onerror: ((ev: Event) => void) | null = null;

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

	/** @internal - Resolve the request with a result */
	_resolve(result: any): void {
		this.#readyState = "done";
		this.#result = result;
		this.#error = null;
		const event = new Event("success", {bubbles: false, cancelable: false});
		if (this.onsuccess) {
			this.onsuccess(event);
		}
		this.dispatchEvent(event);
	}

	/** @internal - Reject the request with an error */
	_reject(error: DOMException): void {
		this.#readyState = "done";
		this.#error = error;
		this.#result = undefined;
		const event = new Event("error", {bubbles: true, cancelable: true});
		if (this.onerror) {
			this.onerror(event);
		}
		this.dispatchEvent(event);
	}
}

/**
 * IDBOpenDBRequest - result of IDBFactory.open() or IDBFactory.deleteDatabase()
 */
export class IDBOpenDBRequest extends IDBRequest {
	onblocked: ((ev: Event) => void) | null = null;
	onupgradeneeded: ((ev: IDBVersionChangeEvent) => void) | null = null;

	/** @internal */
	_fireUpgradeNeeded(oldVersion: number, newVersion: number): void {
		const event = new IDBVersionChangeEvent("upgradeneeded", {
			oldVersion,
			newVersion,
		});
		if (this.onupgradeneeded) {
			this.onupgradeneeded(event);
		}
		this.dispatchEvent(event);
	}

	/** @internal */
	_fireBlocked(oldVersion: number, newVersion: number): void {
		const event = new IDBVersionChangeEvent("blocked", {
			oldVersion,
			newVersion,
		});
		if (this.onblocked) {
			this.onblocked(event as unknown as Event);
		}
		this.dispatchEvent(event);
	}
}
