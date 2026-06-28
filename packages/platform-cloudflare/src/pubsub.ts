/**
 * Cloudflare Durable Object PubSub Backend
 *
 * Provides cross-isolate BroadcastChannel relay via a Durable Object.
 * - CloudflarePubSubBackend: BroadcastChannelBackend that publishes to a DO
 * - ShovelPubSubDO: Durable Object that fans publishes out to subscribers
 *
 * Opt-in: only active when env.SHOVEL_PUBSUB binding is present.
 *
 * Two subscriber paths coexist:
 *
 * 1. Durable Object subscribers (the ShovelWebSocketDO, primarily) — register
 *    their own DO ID with the pubsub DO. On each publish the pubsub DO does
 *    `env.SHOVEL_WS.get(doId).fetch("/_shovel_publish", ...)`, which Cloudflare
 *    uses to wake hibernated subscriber DOs. The registry is persisted to
 *    `ctx.storage` so a pubsub-DO eviction doesn't drop subscriptions, and
 *    per-target deliveries are ordered via a per-doId promise chain.
 *
 * 2. Non-DO subscribers (regular workers, cron handlers using waitUntil) —
 *    open a held-open WebSocket to the pubsub DO and receive every publish on
 *    it. Each non-DO backend has a unique `instanceId` and tags its own
 *    publishes with it, so receive-side filtering avoids echo. The WS dies
 *    when the worker isolate goes away — fine because the subscription can't
 *    outlive the isolate either way. This path is best-effort: a pubsub-DO
 *    eviction interrupts it, same as the pre-PR design.
 *
 * Local in-isolate BC fan-out is unaffected; it happens in `ShovelBroadcastChannel`
 * before the backend is invoked.
 */

import {DurableObject} from "cloudflare:workers";
import type {BroadcastChannelBackend} from "@b9g/platform/runtime";
import {getLogger} from "@logtape/logtape";

const logger = getLogger(["shovel", "pubsub"]);

// Storage key prefix for persisted (channel, doId) pairs.
const SUB_PREFIX = "sub:";
const SUB_SEP = "\x00";

function subKey(channel: string, doId: string): string {
	return `${SUB_PREFIX}${channel}${SUB_SEP}${doId}`;
}

// ============================================================================
// LOCAL DELIVERY (used by both the WS DO `/_shovel_publish` route and the
// non-DO held-open WS receive path)
// ============================================================================

/** Per-isolate map: channel → set of subscribe-callbacks installed locally. */
const localCallbacks = new Map<string, Set<(data: unknown) => void>>();

/**
 * Invoked by ShovelWebSocketDO when its `/_shovel_publish` route receives a
 * payload. Fans out to all locally-registered BC subscribe callbacks for the
 * channel. Internal — re-exported via the package runtime entry but not part
 * of the public API surface.
 */
export function _dispatchPubSubMessage(channel: string, data: unknown): void {
	const cbs = localCallbacks.get(channel);
	if (!cbs) return;
	for (const cb of cbs) {
		try {
			cb(data);
		} catch (err) {
			logger.error("PubSub callback threw: {error}", {error: err});
		}
	}
}

// ============================================================================
// BACKEND (used by Worker / DO isolates)
// ============================================================================

export class CloudflarePubSubBackend implements BroadcastChannelBackend {
	#ns: DurableObjectNamespace;
	#subscriberId: string | null;
	#instanceId: string;
	#callbacks: Map<string, Set<(data: unknown) => void>>;

	// Non-DO mode only: held-open WS to pubsub DO for receive.
	#ws: WebSocket | null;
	#wsReady: Promise<void> | null;

	/**
	 * @param ns - The SHOVEL_PUBSUB DurableObjectNamespace binding.
	 * @param subscriberId - This isolate's addressable Durable Object ID
	 *   string when running inside a DO that the pubsub layer can wake via
	 *   `env.SHOVEL_WS.get(id).fetch(...)`. Pass `null` for non-DO worker
	 *   isolates; receive then runs over a held-open WebSocket to the
	 *   pubsub DO instead of fetch-based wake.
	 */
	constructor(ns: DurableObjectNamespace, subscriberId: string | null = null) {
		this.#ns = ns;
		this.#subscriberId = subscriberId;
		this.#instanceId = crypto.randomUUID();
		this.#callbacks = new Map();
		this.#ws = null;
		this.#wsReady = null;
	}

	#stub() {
		const id = this.#ns.idFromName("pubsub");
		return this.#ns.get(id);
	}

	/** Tag publishes so each receiver can skip its own messages. */
	#sender(): string {
		return this.#subscriberId ?? this.#instanceId;
	}

	publish(channelName: string, data: unknown): void {
		const stub = this.#stub();
		stub
			.fetch("http://internal/publish", {
				method: "POST",
				headers: {"Content-Type": "application/json"},
				body: JSON.stringify({
					channel: channelName,
					data,
					sender: this.#sender(),
				}),
			})
			.catch((err) => {
				logger.error("PubSub publish failed: {error}", {error: err});
			});
	}

	subscribe(
		channelName: string,
		callback: (data: unknown) => void,
	): () => void {
		let cbs = localCallbacks.get(channelName);
		const isFirstForChannel = !cbs || cbs.size === 0;
		if (!cbs) {
			cbs = new Set();
			localCallbacks.set(channelName, cbs);
		}
		cbs.add(callback);

		// Track in our own per-instance map so dispose() can clean up.
		let mine = this.#callbacks.get(channelName);
		if (!mine) {
			mine = new Set();
			this.#callbacks.set(channelName, mine);
		}
		mine.add(callback);

		if (isFirstForChannel) {
			if (this.#subscriberId) {
				// DO mode: register with pubsub DO so it can wake us via fetch.
				this.#postRegistration("/subscribe", channelName);
			} else {
				// Non-DO mode: open the held-open receive WebSocket on demand.
				this.#ensureWS();
			}
		}

		return () => {
			cbs!.delete(callback);
			mine!.delete(callback);
			if (mine!.size === 0) this.#callbacks.delete(channelName);
			if (cbs!.size === 0) {
				localCallbacks.delete(channelName);
				if (this.#subscriberId) {
					this.#postRegistration("/unsubscribe", channelName);
				}
			}
		};
	}

	#postRegistration(
		path: "/subscribe" | "/unsubscribe",
		channel: string,
	): void {
		const stub = this.#stub();
		stub
			.fetch(`http://internal${path}`, {
				method: "POST",
				headers: {"Content-Type": "application/json"},
				body: JSON.stringify({channel, doId: this.#subscriberId}),
			})
			.catch((err) => {
				logger.error("PubSub {path} failed: {error}", {path, error: err});
			});
	}

	#ensureWS(): void {
		if (this.#wsReady) return;
		this.#wsReady = this.#connectWS().catch((err) => {
			logger.error("PubSub receive-WS failed: {error}", {error: err});
			this.#wsReady = null;
		});
	}

	async #connectWS(): Promise<void> {
		const stub = this.#stub();
		const response = await stub.fetch("http://internal/subscribe", {
			headers: {Upgrade: "websocket"},
		});
		const ws = (response as any).webSocket as WebSocket | undefined;
		if (!ws) throw new Error("WebSocket upgrade to PubSub DO failed");
		ws.accept();
		this.#ws = ws;
		ws.addEventListener("message", (ev: MessageEvent) => {
			try {
				const {channel, data, sender} = JSON.parse(ev.data as string) as {
					channel: string;
					data: unknown;
					sender: string;
				};
				// Skip echo of our own publishes.
				if (sender === this.#instanceId) return;
				_dispatchPubSubMessage(channel, data);
			} catch (err) {
				logger.debug("Failed to parse pubsub WS message: {error}", {
					error: err,
				});
			}
		});
	}

	async dispose(): Promise<void> {
		// Best-effort unsubscribe per active channel before clearing local state.
		if (this.#subscriberId) {
			for (const channel of this.#callbacks.keys()) {
				this.#postRegistration("/unsubscribe", channel);
			}
		}
		// Drop our own callbacks from the shared localCallbacks map.
		for (const [channel, mine] of this.#callbacks) {
			const shared = localCallbacks.get(channel);
			if (!shared) continue;
			for (const cb of mine) shared.delete(cb);
			if (shared.size === 0) localCallbacks.delete(channel);
		}
		this.#callbacks.clear();
		// Close the receive WS if we opened one (non-DO mode).
		if (this.#ws) {
			try {
				this.#ws.close();
			} catch (_err) {
				/* best-effort */
			}
			this.#ws = null;
			this.#wsReady = null;
		}
	}
}

// ============================================================================
// DURABLE OBJECT (registry + push-on-publish + held-open receive WS)
// ============================================================================

interface PubSubEnv {
	SHOVEL_WS?: DurableObjectNamespace;
}

export class ShovelPubSubDO extends DurableObject {
	/** channel → set of subscriber DO ID strings. */
	#subscribers: Map<string, Set<string>>;
	/** Per-target promise chain so each subscriber sees publishes in order. */
	#pendingByDoId: Map<string, Promise<unknown>>;
	/** Hydration state: ensure we read from storage before serving traffic. */
	#hydrated: Promise<void> | null;

	constructor(ctx: DurableObjectState, env: PubSubEnv) {
		super(ctx, env as any);
		this.#subscribers = new Map();
		this.#pendingByDoId = new Map();
		this.#hydrated = null;
	}

	async #hydrate(): Promise<void> {
		if (this.#hydrated) return this.#hydrated;
		this.#hydrated = (async () => {
			const all = await this.ctx.storage.list<unknown>({prefix: SUB_PREFIX});
			for (const key of all.keys()) {
				const rest = key.slice(SUB_PREFIX.length);
				const sep = rest.indexOf(SUB_SEP);
				if (sep < 0) continue;
				const channel = rest.slice(0, sep);
				const doId = rest.slice(sep + 1);
				let set = this.#subscribers.get(channel);
				if (!set) {
					set = new Set();
					this.#subscribers.set(channel, set);
				}
				set.add(doId);
			}
		})();
		return this.#hydrated;
	}

	async fetch(request: Request): Promise<Response> {
		await this.#hydrate();
		const url = new URL(request.url);

		// WebSocket upgrade — held-open receive channel for non-DO subscribers.
		// They get every publish broadcast on this socket and filter by sender
		// on the client side. Hibernation-API accepted so the DO can sleep
		// between publishes without dropping the socket.
		if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
			const pair = new WebSocketPair();
			const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
			this.ctx.acceptWebSocket(server);
			return new Response(null, {status: 101, webSocket: client} as any);
		}

		if (request.method !== "POST") {
			return new Response("Method Not Allowed", {status: 405});
		}

		if (url.pathname === "/subscribe") {
			const {channel, doId} = (await request.json()) as {
				channel: string;
				doId: string;
			};
			let set = this.#subscribers.get(channel);
			if (!set) {
				set = new Set();
				this.#subscribers.set(channel, set);
			}
			if (!set.has(doId)) {
				set.add(doId);
				await this.ctx.storage.put(subKey(channel, doId), 1);
			}
			return new Response(null, {status: 204});
		}

		if (url.pathname === "/unsubscribe") {
			const {channel, doId} = (await request.json()) as {
				channel: string;
				doId: string;
			};
			const set = this.#subscribers.get(channel);
			if (set?.delete(doId)) {
				if (set.size === 0) this.#subscribers.delete(channel);
				await this.ctx.storage.delete(subKey(channel, doId));
			}
			return new Response(null, {status: 204});
		}

		if (url.pathname === "/publish") {
			const body = (await request.json()) as {
				channel: string;
				data: unknown;
				sender: string | null;
			};
			const {channel, data, sender} = body;
			const set = this.#subscribers.get(channel);
			if (set) {
				const wsNs = (this.env as PubSubEnv).SHOVEL_WS;
				if (!wsNs) {
					logger.error("Cannot push publish: SHOVEL_WS binding missing");
				} else {
					// Serialize the downstream payload once, not per subscriber.
					const downstreamBody = JSON.stringify({channel, data});
					for (const doId of set) {
						if (doId === sender) continue;
						this.#scheduleDelivery(wsNs, doId, downstreamBody);
					}
				}
			}
			// Broadcast to non-DO subscribers over their held-open WS. Receivers
			// filter by sender to skip their own publishes; we don't track who
			// opened which socket here, so the broadcast is unconditional.
			const payload = JSON.stringify({channel, data, sender});
			for (const ws of this.ctx.getWebSockets()) {
				try {
					ws.send(payload);
				} catch (_err) {
					// Closed sockets are cleaned up by the hibernation API; skip.
				}
			}
			return new Response(null, {status: 204});
		}

		return new Response("Not Found", {status: 404});
	}

	#scheduleDelivery(
		wsNs: DurableObjectNamespace,
		doId: string,
		body: string,
	): void {
		const prev = this.#pendingByDoId.get(doId) ?? Promise.resolve();
		const next = prev
			.then(async () => {
				try {
					const stub = wsNs.get(wsNs.idFromString(doId));
					await stub.fetch("http://internal/_shovel_publish", {
						method: "POST",
						headers: {"Content-Type": "application/json"},
						body,
					});
				} catch (err) {
					logger.error("PubSub downstream fetch to {doId} failed: {error}", {
						doId,
						error: err,
					});
				}
			})
			.finally(() => {
				// Drop the chain head when we're caught up to avoid unbounded
				// map growth; if more publishes arrive, a fresh entry is created.
				if (this.#pendingByDoId.get(doId) === next) {
					this.#pendingByDoId.delete(doId);
				}
			});
		this.#pendingByDoId.set(doId, next);
		this.ctx.waitUntil(next);
	}

	// Hibernation API hooks. We don't act on inbound frames or close events
	// from the receive sockets — they're a one-way push channel — but workerd
	// requires the DO class to implement these when sockets are accepted.
	async webSocketMessage(
		_ws: WebSocket,
		_message: string | ArrayBuffer,
	): Promise<void> {
		// no-op — backends don't send anything to us via WS.
	}

	async webSocketClose(): Promise<void> {
		// hibernation API handles cleanup
	}

	async webSocketError(): Promise<void> {
		// hibernation API handles cleanup
	}
}
