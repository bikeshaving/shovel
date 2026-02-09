/**
 * EventTarget implementation that catches errors in event listeners
 * and supports basic event bubbling.
 *
 * Bun/Node's native EventTarget reports listener errors as unhandled
 * exceptions, which differs from browser behavior where errors are
 * caught by the event loop. This implementation matches browser
 * behavior by catching and absorbing listener errors.
 *
 * Bubbling: set `_parent` to enable event propagation from child to parent
 * (e.g., IDBRequest → IDBTransaction → IDBDatabase).
 */

type Listener = EventListener | ((event: Event) => void);

export class SafeEventTarget {
	#listeners = new Map<string, Set<Listener>>();
	_parent: SafeEventTarget | null = null;

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
		// Set target to the originating object (only on first dispatch)
		if (!(event as any)._target) {
			Object.defineProperty(event, "_target", {
				value: this,
				configurable: true,
			});
		}
		Object.defineProperty(event, "target", {
			value: (event as any)._target,
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

		// Bubble to parent if event bubbles and propagation wasn't stopped
		if (event.bubbles && this._parent && !(event as any)._stopPropagation) {
			this._parent.dispatchEvent(event);
		}

		return !event.defaultPrevented;
	}
}
