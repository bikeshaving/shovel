/**
 * BroadcastChannel - WHATWG standard for cross-context pub/sub
 * https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel
 *
 * In-memory implementation with cross-worker relay and pluggable backend support.
 * - Local fan-out: messages delivered to all same-name channels in this process
 * - Relay: messages forwarded to other workers via postMessage (set by startWorkerMessageLoop)
 * - Backend: messages published to external pub/sub (e.g. Redis) for cross-process delivery
 */

import type {BroadcastChannelBackend} from "./broadcast-channel-backend.js";

// Process-global channel registry
const channels = new Map<string, Set<ShovelBroadcastChannel>>();

// Module-level relay (set during worker init for cross-worker postMessage relay)
let relayFn: ((channelName: string, data: unknown) => void) | null = null;

// Pluggable backend for cross-process pub/sub
let backend: BroadcastChannelBackend | null = null;
// Track per-channel unsubscribe functions from the backend
const backendSubscriptions = new Map<string, () => void>();

/**
 * Set the relay function for cross-worker message forwarding.
 * Called by startWorkerMessageLoop or Bun worker template.
 */
export function setBroadcastChannelRelay(
	fn: (channelName: string, data: unknown) => void,
): void {
	relayFn = fn;
}

/**
 * Deliver a message from relay/backend to all local instances on a channel.
 * Does NOT re-relay — prevents infinite loops.
 */
export function deliverBroadcastMessage(
	channelName: string,
	data: unknown,
): void {
	const set = channels.get(channelName);
	if (!set) return;
	for (const ch of set) {
		queueMicrotask(() => {
			const cloned = structuredClone(data);
			const event = new MessageEvent("message", {data: cloned});
			ch.dispatchEvent(event);
			ch.onmessage?.call(ch, event);
		});
	}
}

/**
 * Set a pluggable backend for cross-process BroadcastChannel relay.
 * When set, publish goes through the backend instead of postMessage relay.
 */
export function setBroadcastChannelBackend(b: BroadcastChannelBackend): void {
	backend = b;
}

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

		// If backend is set, subscribe on first instance for this channel name
		if (backend && !backendSubscriptions.has(name)) {
			const unsub = backend.subscribe(name, (data) => {
				deliverBroadcastMessage(name, data);
			});
			backendSubscriptions.set(name, unsub);
		}
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

		// Fan out to all OTHER channels with same name (local)
		const set = channels.get(this.name);
		if (set) {
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

		// Relay to other workers/processes
		if (backend) {
			backend.publish(this.name, data);
		} else if (relayFn) {
			relayFn(this.name, data);
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
				// Unsubscribe from backend if last instance for this channel
				const unsub = backendSubscriptions.get(this.name);
				if (unsub) {
					unsub();
					backendSubscriptions.delete(this.name);
				}
			}
		}
	}
}
