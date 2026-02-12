/**
 * EventTarget implementation that catches errors in event listeners
 * and supports DOM capture → target → bubble event propagation.
 *
 * Bun/Node's native EventTarget reports listener errors as unhandled
 * exceptions, which differs from browser behavior where errors are
 * caught by the event loop. This implementation matches browser
 * behavior by catching and absorbing listener errors.
 *
 * Propagation: set `_parent` to enable event propagation from child to parent
 * (e.g., IDBRequest → IDBTransaction → IDBDatabase).
 *
 * Phase order: capture (root → target's parent) → target → bubble (target's parent → root)
 */

type Listener = EventListener | EventListenerObject;

interface ListenerEntry {
	listener: Listener;
	capture: boolean;
}

export class SafeEventTarget {
	#listeners: Map<string, ListenerEntry[]>;
	_parent: SafeEventTarget | null;

	constructor() {
		this.#listeners = new Map();
		this._parent = null;
	}

	addEventListener(
		type: string,
		listener: Listener | null,
		options?: boolean | AddEventListenerOptions,
	): void {
		if (!listener) return;
		const capture = typeof options === "boolean" ? options : !!options?.capture;
		if (!this.#listeners.has(type)) {
			this.#listeners.set(type, []);
		}
		const entries = this.#listeners.get(type)!;
		// Per spec: adding same listener+capture is a no-op
		if (entries.some((e) => e.listener === listener && e.capture === capture)) {
			return;
		}
		entries.push({listener, capture});
	}

	removeEventListener(
		type: string,
		listener: Listener | null,
		options?: boolean | EventListenerOptions,
	): void {
		if (!listener) return;
		const capture = typeof options === "boolean" ? options : !!options?.capture;
		const entries = this.#listeners.get(type);
		if (!entries) return;
		const idx = entries.findIndex(
			(e) => e.listener === listener && e.capture === capture,
		);
		if (idx >= 0) entries.splice(idx, 1);
	}

	dispatchEvent(event: Event): boolean {
		// Intercept stopPropagation/stopImmediatePropagation so our
		// custom dispatch respects them (native methods only affect
		// the built-in EventTarget, not our propagation chain).
		if (!(event as any)._stopPropagation) {
			const origStop = event.stopPropagation.bind(event);
			event.stopPropagation = () => {
				(event as any)._stopPropagation = true;
				origStop();
			};
			const origStopImm = event.stopImmediatePropagation.bind(event);
			event.stopImmediatePropagation = () => {
				(event as any)._stopPropagation = true;
				(event as any)._stopImmediate = true;
				origStopImm();
			};
		}

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

		// Build ancestor chain: [parent, grandparent, ..., root]
		const ancestors: SafeEventTarget[] = [];
		let node: SafeEventTarget | null = this._parent;
		while (node) {
			ancestors.push(node);
			node = node._parent;
		}

		// Capture phase: root → ... → parent (top-down, capture listeners only)
		for (let i = ancestors.length - 1; i >= 0; i--) {
			const ancestor = ancestors[i];
			Object.defineProperty(event, "currentTarget", {
				value: ancestor,
				configurable: true,
			});
			SafeEventTarget.#fireListeners(ancestor, event, true);
			if ((event as any)._stopPropagation) {
				return !event.defaultPrevented;
			}
		}

		// Target phase: all listeners (both capture and non-capture)
		Object.defineProperty(event, "currentTarget", {
			value: this,
			configurable: true,
		});
		SafeEventTarget.#fireListeners(this, event, null);
		if ((event as any)._stopPropagation) {
			return !event.defaultPrevented;
		}

		// Bubble phase: parent → ... → root (bottom-up, non-capture listeners only)
		if (event.bubbles) {
			for (const ancestor of ancestors) {
				Object.defineProperty(event, "currentTarget", {
					value: ancestor,
					configurable: true,
				});
				SafeEventTarget.#fireListeners(ancestor, event, false);
				if ((event as any)._stopPropagation) {
					break;
				}
			}
		}

		return !event.defaultPrevented;
	}

	/**
	 * Fire listeners on a target.
	 * @param captureFilter true = capture only, false = non-capture only, null = all
	 */
	static #fireListeners(
		target: SafeEventTarget,
		event: Event,
		captureFilter: boolean | null,
	): void {
		const entries = target.#listeners.get(event.type);
		if (!entries) return;
		// Snapshot to handle removal during iteration
		for (const entry of [...entries]) {
			if ((event as any)._stopImmediate) break;
			if (captureFilter !== null && entry.capture !== captureFilter) continue;
			try {
				const fn = entry.listener;
				if (typeof fn === "function") {
					fn.call(target, event);
				} else {
					fn.handleEvent(event);
				}
			} catch (_error) {
				// Errors in event handlers are absorbed (browser behavior).
				// Track that an error occurred for fire-error/success-event spec behavior.
				(event as any)._dispatchHadError = true;
			}
		}
	}
}
