/**
 * EventTarget implementation that catches errors in event listeners.
 *
 * Bun/Node's native EventTarget reports listener errors as unhandled
 * exceptions, which differs from browser behavior where errors are
 * caught by the event loop. This implementation matches browser
 * behavior by catching and absorbing listener errors.
 */

type Listener = EventListener | ((event: Event) => void);

export class SafeEventTarget {
	#listeners = new Map<string, Set<Listener>>();

	addEventListener(type: string, listener: Listener): void {
		if (!this.#listeners.has(type)) {
			this.#listeners.set(type, new Set());
		}
		this.#listeners.get(type)!.add(listener);
	}

	removeEventListener(type: string, listener: Listener): void {
		this.#listeners.get(type)?.delete(listener);
	}

	dispatchEvent(event: Event): boolean {
		Object.defineProperty(event, "target", {
			value: this,
			configurable: true,
		});
		Object.defineProperty(event, "currentTarget", {
			value: this,
			configurable: true,
		});

		const listeners = this.#listeners.get(event.type);
		if (listeners) {
			for (const listener of listeners) {
				try {
					if (typeof listener === "function") {
						listener.call(this, event);
					} else {
						listener.handleEvent(event);
					}
				} catch {
					// Errors in event handlers are absorbed (browser behavior)
				}
			}
		}
		return !event.defaultPrevented;
	}
}
