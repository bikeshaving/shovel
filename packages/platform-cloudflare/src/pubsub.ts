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

/**
 * RPC surfaces. Control-plane operations use Durable Object RPC methods, not
 * fetch routes: fetch on these DOs is externally reachable (the worker
 * forwards any websocket upgrade), so a fetch-based control plane would let
 * outside clients forge internal publishes. RPC methods are only callable
 * from code holding the binding.
 */
interface PubSubDORpc {
	subscribe(channel: string, doId: string): Promise<void>;
	unsubscribe(channel: string, doId: string): Promise<void>;
	publish(channel: string, data: unknown, sender: string | null): Promise<void>;
}
interface WebSocketDORpc {
	_shovelPublish(channel: string, data: unknown): Promise<{stale: boolean}>;
}

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
		this.#registrationOps = new Map();
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
		const stub = this.#stub() as unknown as PubSubDORpc;
		stub.publish(channelName, data, this.#sender()).catch((err) => {
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
				this.#postRegistration("subscribe", channelName);
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
					this.#postRegistration("unsubscribe", channelName);
				}
			}
		};
	}

	/** Per-channel registration chains: ops must apply in issue order. */
	#registrationOps: Map<string, Promise<void>>;

	#postRegistration(op: "subscribe" | "unsubscribe", channel: string): void {
		const doId = this.#subscriberId;
		if (!doId) return;
		// Chain per channel: an unsubscribe followed by a resubscribe (last
		// connection closes, new one opens) must reach the registry in that
		// order — two independent fire-and-forget stub calls can arrive
		// swapped and permanently deregister a live subscriber.
		const prev = this.#registrationOps.get(channel) ?? Promise.resolve();
		const next = prev.then(async () => {
			const stub = this.#stub() as unknown as PubSubDORpc;
			await (op === "subscribe"
				? stub.subscribe(channel, doId)
				: stub.unsubscribe(channel, doId));
		});
		this.#registrationOps.set(
			channel,
			next.catch((err) => {
				logger.error("PubSub {op} failed: {error}", {op, error: err});
			}),
		);
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
				this.#postRegistration("unsubscribe", channel);
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

		// The ONLY fetch surface: the held-open receive WebSocket for non-DO
		// subscribers. All control-plane operations (subscribe/unsubscribe/
		// publish) are RPC methods — fetch is externally reachable via the
		// worker's upgrade forwarding, RPC is not.
		if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
			const pair = new WebSocketPair();
			const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
			this.ctx.acceptWebSocket(server);
			return new Response(null, {status: 101, webSocket: client} as any);
		}

		return new Response("Not Found", {status: 404});
	}

	async subscribe(channel: string, doId: string): Promise<void> {
		await this.#hydrate();
		let set = this.#subscribers.get(channel);
		if (!set) {
			set = new Set();
			this.#subscribers.set(channel, set);
		}
		if (!set.has(doId)) {
			set.add(doId);
			await this.ctx.storage.put(subKey(channel, doId), 1);
		}
	}

	async unsubscribe(channel: string, doId: string): Promise<void> {
		await this.#hydrate();
		const set = this.#subscribers.get(channel);
		if (set?.delete(doId)) {
			if (set.size === 0) this.#subscribers.delete(channel);
			await this.ctx.storage.delete(subKey(channel, doId));
		}
	}

	async publish(
		channel: string,
		data: unknown,
		sender: string | null,
	): Promise<void> {
		await this.#hydrate();
		const set = this.#subscribers.get(channel);
		if (set) {
			const wsNs = (this.env as PubSubEnv).SHOVEL_WS;
			if (!wsNs) {
				logger.error("Cannot push publish: SHOVEL_WS binding missing");
			} else {
				for (const doId of set) {
					if (doId === sender) continue;
					this.#scheduleDelivery(wsNs, doId, channel, data);
				}
			}
		}
		// Broadcast to non-DO subscribers over their held-open WS, but only
		// when any exist — skip the serialization otherwise. Receivers filter
		// by sender to skip their own publishes.
		const sockets = this.ctx.getWebSockets();
		if (sockets.length > 0) {
			const payload = JSON.stringify({channel, data, sender});
			for (const ws of sockets) {
				try {
					ws.send(payload);
				} catch (err) {
					// Closed sockets are cleaned up by the hibernation API; skip.
					logger.debug("receive-WS send skipped: {error}", {error: err});
				}
			}
		}
	}

	#scheduleDelivery(
		wsNs: DurableObjectNamespace,
		doId: string,
		channel: string,
		data: unknown,
	): void {
		const prev = this.#pendingByDoId.get(doId) ?? Promise.resolve();
		const next = prev
			.then(async () => {
				let stub;
				try {
					stub = wsNs.get(wsNs.idFromString(doId));
				} catch (err) {
					// Malformed id can never address a DO — drop it permanently.
					logger.warn("Pruning malformed pubsub subscriber {doId}: {error}", {
						doId,
						error: err,
					});
					await this.#pruneSubscriber(channel, doId);
					return;
				}
				try {
					const res = await (stub as unknown as WebSocketDORpc)._shovelPublish(
						channel,
						data,
					);
					// stale = the subscriber DO woke, rehydrated, and found it has
					// no live sockets at all — a stale entry left by a DO that was
					// evicted/crashed without a clean unsubscribe. Reap it.
					// Transport errors (caught below) are left intact, since those
					// are usually transient.
					if (res.stale) {
						await this.#pruneSubscriber(channel, doId);
					}
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

	/**
	 * Remove a stale (channel, doId) entry from the in-memory registry and
	 * persisted storage. Called when a subscriber DO is found to no longer hold
	 * a subscriber for the channel (or its id is unaddressable), so future
	 * publishes stop waking a dead DO.
	 */
	async #pruneSubscriber(channel: string, doId: string): Promise<void> {
		const set = this.#subscribers.get(channel);
		if (set?.delete(doId)) {
			if (set.size === 0) this.#subscribers.delete(channel);
			await this.ctx.storage.delete(subKey(channel, doId));
			logger.info("Pruned stale pubsub subscriber {doId} from {channel}", {
				doId,
				channel,
			});
		}
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
