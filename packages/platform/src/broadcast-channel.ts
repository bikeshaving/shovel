/**
 * BroadcastChannel - WHATWG standard for cross-context pub/sub
 * https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel
 *
 * In-memory implementation for single-process mode.
 * Cross-worker relay (via main thread) is Phase 2.
 */

// Process-global channel registry
const channels = new Map<string, Set<ShovelBroadcastChannel>>();

export class ShovelBroadcastChannel extends EventTarget {
	readonly name: string;
	#closed: boolean;

	// Event handler properties (Web API compat)
	onmessage: ((ev: MessageEvent) => any) | null;
	onmessageerror: ((ev: MessageEvent) => any) | null;

	constructor(name: string) {
		super();
		this.name = name;
		this.#closed = false;
		this.onmessage = null;
		this.onmessageerror = null;
		let set = channels.get(name);
		if (!set) {
			set = new Set();
			channels.set(name, set);
		}
		set.add(this);
	}

	postMessage(message: unknown): void {
		if (this.#closed) {
			throw new DOMException("BroadcastChannel is closed", "InvalidStateError");
		}

		// Structured clone the data
		let data: unknown;
		try {
			data = structuredClone(message);
		} catch (error) {
			// Clone failure — dispatch messageerror on recipients
			const set = channels.get(this.name);
			if (!set) return;
			for (const ch of set) {
				if (ch !== this && !ch.#closed) {
					queueMicrotask(() => {
						const event = new MessageEvent("messageerror");
						ch.dispatchEvent(event);
						ch.onmessageerror?.call(ch, event);
					});
				}
			}
			return;
		}

		// Fan out to all OTHER channels with same name
		const set = channels.get(this.name);
		if (!set) return;
		for (const ch of set) {
			if (ch !== this && !ch.#closed) {
				queueMicrotask(() => {
					const event = new MessageEvent("message", {data});
					ch.dispatchEvent(event);
					ch.onmessage?.call(ch, event);
				});
			}
		}
	}

	close(): void {
		if (this.#closed) return;
		this.#closed = true;
		const set = channels.get(this.name);
		if (set) {
			set.delete(this);
			if (set.size === 0) {
				channels.delete(this.name);
			}
		}
	}
}
