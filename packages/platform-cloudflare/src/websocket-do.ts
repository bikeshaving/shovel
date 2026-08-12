/**
 * WebSocket Durable Object with Hibernation API support.
 *
 * Separate file because `cloudflare:workers` can only be imported inside
 * workerd. The generated entry re-exports this class so wrangler can bind
 * it; it is never loaded outside Cloudflare.
 *
 * The DO is used as a single shared instance (`idFromName("shovel-ws")`)
 * so that all accepted connections live in the same isolate. This keeps
 * `WebSocketConnection.subscribe()` fan-out purely in-process for the
 * common case (cross-DO / cross-colo relay is handled by BroadcastChannel's
 * backend, independent of this DO).
 *
 * Hibernation model:
 * - `ctx.acceptWebSocket(ws)` registers the socket for hibernation-capable
 *   dispatch. The runtime can evict the DO between messages.
 * - `ws.serializeAttachment({id, url, subscribedChannels})` stashes enough
 *   state to reconstruct a `ShovelWebSocketConnection` after wake.
 * - On wake, module re-evaluation runs user code (so event handlers are
 *   re-registered) and then `#ensureRuntime()` rebuilds one connection
 *   object per `ctx.getWebSockets()` entry. Rebuilding re-registers BC
 *   listeners for each subscribed channel (re-wires fan-out forwarding).
 *
 * Hardening from prior PR:
 * - Per-connection ordered dispatch queue so handlers see messages in order.
 * - Connection removal deferred until AFTER `websocketclose` handlers run.
 * - Phantom cleanup if the handler throws after `onUpgrade`.
 * - Non-cloneable subscribed-channel set: `subscribedChannels` is a plain
 *   array of strings, always structured-cloneable.
 */

import {DurableObject} from "cloudflare:workers";
import {
	ShovelServiceWorkerRegistration,
	ShovelWebSocketConnection,
	WebSocketConnectionState,
	dispatchFetchEvent,
	dispatchWebSocketMessage,
	dispatchWebSocketClose,
	kBindRelay,
	kGetConnectionState,
	kGetUpgradeResult,
	runLifecycle,
	setBroadcastChannelBackend,
	type WebSocketRelay,
	errorToResponse,
} from "@b9g/platform/runtime";
import {CloudflareFetchEvent} from "./runtime.js";
import {envStorage} from "./variables.js";
import {getLogger} from "@logtape/logtape";

const logger = getLogger(["shovel", "platform", "cloudflare", "ws"]);

export class ShovelWebSocketDO extends DurableObject {
	#registration: ShovelServiceWorkerRegistration | null;
	#runtimePromise: Promise<ShovelServiceWorkerRegistration> | null;
	/** Map from connection id → live runtime handle. Rebuilt on wake. */
	#connections: Map<string, ShovelWebSocketConnection>;
	/** Per-connection ordered dispatch queues. */
	#dispatchQueues: Map<string, Promise<void>>;
	/**
	 * Connection ids whose `websocketclose` has already been dispatched. workerd
	 * can deliver `webSocketError` followed by `webSocketClose` for the same
	 * socket; this guards against dispatching the user close handler twice.
	 */
	#finalized: Set<string>;
	/**
	 * Connection id → last-persisted `subscribedChannels` signature, so we only
	 * re-serialize the hibernation attachment when subscription state actually
	 * changed (not on every inbound data frame).
	 */
	#persistedChannels: Map<string, string>;
	/** Captured `_dispatchPubSubMessage` so the hot publish route avoids a per-call dynamic import. */
	#dispatchPubSub: ((channel: string, data: unknown) => void) | null;
	/** Upgrades in flight (subscribe registered, socket not yet accepted). */
	#pendingUpgrades: number;
	/** ws -> connection id; survives attachment read failures and avoids
	 * a structured-clone deserialization per inbound frame. */
	#socketIds: WeakMap<WebSocket, string>;

	constructor(ctx: DurableObjectState, env: Record<string, unknown>) {
		super(ctx, env as any);
		this.#registration = null;
		this.#runtimePromise = null;
		this.#connections = new Map();
		this.#dispatchQueues = new Map();
		this.#finalized = new Set();
		this.#persistedChannels = new Map();
		this.#dispatchPubSub = null;
		this.#pendingUpgrades = 0;
		this.#socketIds = new WeakMap();
	}

	async #ensureRuntime(): Promise<ShovelServiceWorkerRegistration> {
		// Memoize the in-flight promise, not the resolved registration: the
		// first await below yields, and a concurrent wake (two webSocketMessage
		// deliveries, or fetch + message in one tick) would otherwise run the
		// whole body twice — double lifecycle, double rehydration, and
		// duplicate connections whose dropped twins leak BC subscriptions.
		if (!this.#runtimePromise) {
			const p = this.#initializeRuntime();
			this.#runtimePromise = p;
			// A rejected init must not be memoized: it would brick the isolate
			// (every later fetch/message/close awaits this and rejects, and
			// existing sockets never dispatch websocketclose). Clear so the
			// next entry retries, preserving pre-memoization behavior.
			p.catch(() => {
				if (this.#runtimePromise === p) this.#runtimePromise = null;
			});
		}
		return this.#runtimePromise;
	}

	async #initializeRuntime(): Promise<ShovelServiceWorkerRegistration> {
		if (this.#registration) return this.#registration;

		// Module-level `initializeRuntime()` ran when workerd evaluated the
		// generated entry. Retrieve the registration singleton it produced.
		const {_getRegistration} = await import("./runtime.js");
		const reg = _getRegistration();
		if (!reg) {
			throw new Error(
				"Shovel runtime not initialized — generated entry must call initializeRuntime()",
			);
		}
		this.#registration = reg;

		// Run install/activate once per DO isolate. The main worker isolate
		// runs them in its own module instance; this isolate is separate, so
		// any per-isolate user setup (cache warming, DB opens, global seeding)
		// has to happen here too. `runLifecycle` is idempotent against `reg`
		// once `reg.ready === true`, so subsequent fetches/wakes don't re-run.
		if (!reg.ready) {
			await runLifecycle(reg, "activate");
		}

		// Configure the BroadcastChannel backend inside this DO isolate if
		// the SHOVEL_PUBSUB binding is present. This is a no-op if already
		// configured for this isolate. Pass our own DO ID so the pubsub
		// registry can address us directly for cross-isolate wakes and skip
		// self-fetches when this DO is the publisher.
		const env = (this.env ?? {}) as Record<string, unknown>;
		if (env.SHOVEL_PUBSUB) {
			const {CloudflarePubSubBackend, _dispatchPubSubMessage} =
				await import("./pubsub.js");
			this.#dispatchPubSub = _dispatchPubSubMessage;
			setBroadcastChannelBackend(
				new CloudflarePubSubBackend(
					env.SHOVEL_PUBSUB as DurableObjectNamespace,
					this.ctx.id.toString(),
				),
			);
		}

		// Rehydrate connections from stored attachments. After wake, any WS
		// accepted pre-hibernation is available via ctx.getWebSockets(); we
		// reconstruct a runtime Connection for each so subsequent messages
		// dispatch correctly.
		for (const ws of this.ctx.getWebSockets()) {
			const conn = this.#buildConnectionFromSocket(ws);
			if (conn) {
				this.#connections.set(conn.id, conn);
				this.#socketIds.set(ws, conn.id);
			}
		}

		return reg;
	}

	#buildConnectionFromSocket(ws: WebSocket): ShovelWebSocketConnection | null {
		let attachment: WebSocketConnectionState | null = null;
		try {
			attachment = (
				ws as any
			).deserializeAttachment() as WebSocketConnectionState;
		} catch (err) {
			logger.warn("Failed to deserialize WS attachment: {error}", {error: err});
		}
		if (!attachment) return null;
		const relay = this.#relayFor(ws);
		return new ShovelWebSocketConnection({
			id: attachment.id,
			url: attachment.url,
			relay,
			subscribedChannels: attachment.subscribedChannels ?? [],
		});
	}

	#relayFor(ws: WebSocket): WebSocketRelay {
		return {
			send(_id, data) {
				ws.send(data);
			},
			close(_id, code, reason) {
				ws.close(code ?? 1000, reason ?? "");
			},
		};
	}

	#persistAttachment(ws: WebSocket, conn: ShovelWebSocketConnection): void {
		const state = conn[kGetConnectionState]();
		// id and url are immutable for a connection; subscribedChannels is the
		// only field that changes, so skip re-serializing when it's unchanged
		// (the common case — every data frame would otherwise re-persist).
		const signature = state.subscribedChannels.join("\n");
		if (this.#persistedChannels.get(state.id) === signature) return;
		try {
			(ws as any).serializeAttachment({
				id: state.id,
				url: state.url,
				subscribedChannels: state.subscribedChannels,
			} satisfies WebSocketConnectionState);
			this.#persistedChannels.set(state.id, signature);
		} catch (err) {
			// subscribedChannels is always string[], so serialization should
			// never actually fail. Log and clear if it does.
			logger.error(
				"Failed to persist WS attachment (clearing to avoid stale state): {error}",
				{error: err},
			);
			try {
				(ws as any).serializeAttachment({
					id: state.id,
					url: state.url,
					subscribedChannels: [],
				} satisfies WebSocketConnectionState);
			} catch (fallbackErr) {
				// The API that just threw may throw again; never let it escape
				// into the upgrade response or the dispatch chain.
				logger.debug("attachment fallback failed: {error}", {
					error: fallbackErr,
				});
			}
			this.#persistedChannels.set(state.id, "");
		}
	}

	/**
	 * Push-on-publish (RPC): the pubsub DO wakes us so cross-isolate publishes
	 * reach this DO's local BC subscribers even after hibernation. An RPC
	 * method, not a fetch route — fetch is externally reachable through the
	 * worker's upgrade forwarding, so a fetch-based control plane would let
	 * outside clients inject messages into every subscribed socket.
	 */
	async _shovelPublish(
		channel: string,
		data: unknown,
	): Promise<{stale: boolean}> {
		await this.#ensureRuntime();
		// Captured during #ensureRuntime (above) to avoid a dynamic import
		// on every cross-isolate publish; fall back if pubsub wasn't wired.
		const dispatch =
			this.#dispatchPubSub ??
			(await import("./pubsub.js"))._dispatchPubSubMessage;
		dispatch(channel, data);
		// Prune signal: only when this DO holds NO live sockets at all — an
		// evicted/gone subscriber whose registry entry lingered. #ensureRuntime
		// has already rehydrated hibernated sockets, so a live-but-hibernated
		// subscriber reports length > 0 and is never pruned.
		// stale means "prune my registry entry" — report it only when this
		// isolate truly has no interest in the channel: no live sockets, no
		// upgrade mid-flight (a handler may subscribe before acceptWebSocket
		// runs), and no local BroadcastChannel subscriber (a module-scope
		// channel keeps localCallbacks populated with zero sockets, and a
		// wrongly-pruned entry is never re-asserted because later subscribes
		// see isFirstForChannel === false).
		const {_hasLocalSubscribers} = await import("./pubsub.js");
		return {
			stale:
				this.ctx.getWebSockets().length === 0 &&
				this.#pendingUpgrades === 0 &&
				!_hasLocalSubscribers(channel),
		};
	}

	async fetch(request: Request): Promise<Response> {
		// Count the upgrade BEFORE the first await: a cold wake's runtime init
		// spans many event-loop turns, and a publish landing in that window
		// must not see pendingUpgrades === 0 and prune us.
		this.#pendingUpgrades++;
		try {
			const registration = await this.#ensureRuntime();
			const env = (this.env ?? {}) as Record<string, unknown>;
			return await envStorage.run(env, async () => {
				// Buffer frames the handler produces BEFORE the real socket exists.
				const pending: Array<
					| {type: "send"; data: string | ArrayBuffer}
					| {type: "close"; code?: number; reason?: string}
				> = [];

				let upgradedId: string | null = null;
				let upgradedConn: ShovelWebSocketConnection | null = null;
				const event = new CloudflareFetchEvent(request, {
					env,
					platformWaitUntil: (p) => this.ctx.waitUntil(p),
					wsRelay: {
						send(_id, data) {
							pending.push({type: "send", data});
						},
						close(_id, code, reason) {
							pending.push({type: "close", code, reason});
						},
					},
					onUpgrade: (conn) => {
						upgradedId = conn.id;
						upgradedConn = conn;
						this.#connections.set(conn.id, conn);
					},
				});

				let response: Response | null | undefined;
				try {
					const result = await dispatchFetchEvent(registration, event);
					response = result.response;
				} catch (err) {
					if (upgradedId) {
						this.#connections.delete(upgradedId);
						this.#dispatchQueues.delete(upgradedId);
						// Drop any BC subscriptions the handler attached before
						// throwing — without this, BroadcastChannel fan-out keeps
						// targeting a connection whose handshake never completed.
						(
							upgradedConn as ShovelWebSocketConnection | null
						)?._releaseSubscriptions();
					}
					// Preserve HTTPError statuses (auth/validation rejections) the
					// way ordinary HTTP traffic does — a bare 500 here would mask
					// the 401/403/etc that the user code intentionally threw.
					return errorToResponse(err);
				}

				const conn = event[kGetUpgradeResult]();
				if (!conn) {
					return response ?? new Response("Upgrade Required", {status: 426});
				}

				// Complete the physical WebSocket handshake.
				const pair = new WebSocketPair();
				const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

				this.#persistAttachment(server, conn);
				this.ctx.acceptWebSocket(server);
				if (upgradedId) this.#socketIds.set(server, upgradedId);

				// Rebind the runtime relay directly to the live server socket.
				conn[kBindRelay](this.#relayFor(server));

				// Flush any frames the handler produced during fetch dispatch.
				for (const frame of pending) {
					if (frame.type === "send") server.send(frame.data);
					else server.close(frame.code ?? 1000, frame.reason ?? "");
				}

				// Carry any Set-Cookie values the handler added via cookieStore
				// onto the 101 handshake (auth/login flows that mutate cookies
				// during a WS upgrade rely on this — they otherwise vanish since
				// the upgrade has no Response object to decorate).
				const handshakeHeaders = new Headers();
				if (event.cookieStore.hasChanges()) {
					for (const sc of event.cookieStore.getSetCookieHeaders()) {
						handshakeHeaders.append("Set-Cookie", sc);
					}
				}
				return new Response(null, {
					status: 101,
					webSocket: client,
					headers: handshakeHeaders,
				} as any);
			});
		} finally {
			this.#pendingUpgrades--;
		}
	}

	async webSocketMessage(
		ws: WebSocket,
		message: string | ArrayBuffer,
	): Promise<void> {
		const registration = await this.#ensureRuntime();
		const env = (this.env ?? {}) as Record<string, unknown>;

		// Identify the connection from the attachment (source of truth after
		// hibernation). The rehydrated #connections map was populated in
		// #ensureRuntime() when we woke up.
		let id: string | null = null;
		try {
			const state = (
				ws as any
			).deserializeAttachment() as WebSocketConnectionState;
			id = state?.id ?? null;
		} catch (_err) {
			/* fall through */
		}
		if (!id) {
			logger.warn("webSocketMessage without attachment — ignoring");
			return;
		}
		let conn = this.#connections.get(id);
		if (!conn) {
			conn = this.#buildConnectionFromSocket(ws) ?? undefined;
			if (conn) this.#connections.set(id, conn);
		}
		if (!conn) return;

		const prev = this.#dispatchQueues.get(id) ?? Promise.resolve();
		const next = prev
			.then(() =>
				envStorage.run(env, () => {
					// Collect extension promises (waitUntil + auto-extended async
					// listener returns) so subscription changes made after an
					// `await` in the handler are persisted before hibernation —
					// while still forwarding them to ctx.waitUntil so the DO
					// isn't torn down under them.
					const extensions: Promise<unknown>[] = [];
					const dispatched = dispatchWebSocketMessage(
						registration,
						conn!,
						message,
						(p) => {
							extensions.push(p);
							this.ctx.waitUntil(p);
						},
					);
					if (extensions.length > 0) {
						this.ctx.waitUntil(
							Promise.allSettled(extensions).then(() => {
								this.#persistAttachment(ws, conn!);
							}),
						);
					}
					return dispatched;
				}),
			)
			.then(() => {
				// Persist updated subscription state (if the handler called
				// subscribe/unsubscribe synchronously).
				this.#persistAttachment(ws, conn!);
			})
			.catch((err) =>
				logger.error("webSocketMessage dispatch failed: {error}", {
					error: err,
				}),
			);
		this.#dispatchQueues.set(id, next);
		return next;
	}

	async webSocketClose(
		ws: WebSocket,
		code: number,
		reason: string,
		wasClean: boolean,
	): Promise<void> {
		const registration = await this.#ensureRuntime();
		const id = this.#connectionId(ws);
		if (!id) return;
		return this.#finalizeClose(registration, ws, id, code, reason, wasClean);
	}

	async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
		logger.error("WebSocket error: {error}", {error});
		const registration = await this.#ensureRuntime();
		const id = this.#connectionId(ws);
		if (!id) return;
		// workerd may report `webSocketError` without a follow-up
		// `webSocketClose` on protocol/transport failures, so run the close path
		// here too. The #finalized guard makes whichever event arrives second a
		// no-op, so the user's `websocketclose` handler fires exactly once and
		// BC subscriptions are always released (via dispatchWebSocketClose).
		return this.#finalizeClose(
			registration,
			ws,
			id,
			1006,
			String(error),
			false,
		);
	}

	/**
	 * Resolve a socket's connection id: the in-memory WeakMap first (set at
	 * accept and rehydration — no per-frame deserialization, and immune to a
	 * cleared/corrupt attachment), the hibernation attachment as fallback.
	 * An unreadable attachment must not orphan the connection: close/error
	 * paths depend on this id to release subscriptions.
	 */
	#connectionId(ws: WebSocket): string | null {
		const cached = this.#socketIds.get(ws);
		if (cached) return cached;
		try {
			const state = (
				ws as any
			).deserializeAttachment() as WebSocketConnectionState;
			const id = state?.id ?? null;
			if (id) this.#socketIds.set(ws, id);
			return id;
		} catch (_err) {
			return null;
		}
	}

	/**
	 * Dispatch `websocketclose` exactly once for a connection and tear down all
	 * per-connection state. Shared by webSocketClose and webSocketError so an
	 * error-then-close (or close-then-error) sequence only closes once.
	 */
	#finalizeClose(
		registration: ShovelServiceWorkerRegistration,
		ws: WebSocket,
		id: string,
		code: number,
		reason: string,
		wasClean: boolean,
	): Promise<void> | void {
		if (this.#finalized.has(id)) return;
		this.#finalized.add(id);
		// Bound the dedup set. An error/close pair for one socket arrives within
		// a single teardown, so ids far older than recent churn can never dedup
		// anything; evict oldest (insertion order) once the set grows large,
		// rather than leaking one entry per connection for the DO's lifetime.
		if (this.#finalized.size > 2048) {
			const oldest = this.#finalized.values().next().value as string;
			this.#finalized.delete(oldest);
		}
		const conn =
			this.#connections.get(id) ?? this.#buildConnectionFromSocket(ws);
		if (!conn) {
			this.#cleanupConnection(id);
			return;
		}
		const env = (this.env ?? {}) as Record<string, unknown>;
		const prev = this.#dispatchQueues.get(id) ?? Promise.resolve();
		const next = prev
			.then(() =>
				envStorage.run(env, () =>
					dispatchWebSocketClose(registration, conn, code, reason, wasClean),
				),
			)
			.catch((err) =>
				logger.error("webSocketClose dispatch failed: {error}", {error: err}),
			)
			.finally(() => this.#cleanupConnection(id));
		this.#dispatchQueues.set(id, next);
		return next;
	}

	#cleanupConnection(id: string): void {
		this.#connections.delete(id);
		this.#dispatchQueues.delete(id);
		this.#persistedChannels.delete(id);
	}
}
