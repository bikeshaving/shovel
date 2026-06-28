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
import {InternalServerError, isHTTPError, HTTPError} from "@b9g/http-errors";
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
} from "@b9g/platform/runtime";
import {CloudflareFetchEvent} from "./runtime.js";
import {envStorage} from "./variables.js";
import {getLogger} from "@logtape/logtape";

const logger = getLogger(["shovel", "platform", "cloudflare", "ws"]);

/**
 * Mirror the HTTPError handling normal HTTP requests get from the
 * Cloudflare runtime so a fetch handler that throws `UnauthorizedError`
 * (etc.) before `upgradeWebSocket()` returns the right 4xx instead of
 * collapsing to a bare 500.
 */
function toHttpErrorResponse(error: unknown): Response {
	const err = error instanceof Error ? error : new Error(String(error));
	const httpError = isHTTPError(error)
		? (error as HTTPError)
		: new InternalServerError(err.message, {cause: err});
	if (httpError.status >= 500) {
		logger.error("WS upgrade error: {error}", {error: err});
	} else {
		logger.warn("WS upgrade error: {status} {error}", {
			status: httpError.status,
			error: err,
		});
	}
	const isDev = (import.meta as any).env?.MODE !== "production";
	return httpError.toResponse(isDev);
}

export class ShovelWebSocketDO extends DurableObject {
	#registration: ShovelServiceWorkerRegistration | null;
	/** Map from connection id → live runtime handle. Rebuilt on wake. */
	#connections: Map<string, ShovelWebSocketConnection>;
	/** Per-connection ordered dispatch queues. */
	#dispatchQueues: Map<string, Promise<void>>;

	constructor(ctx: DurableObjectState, env: Record<string, unknown>) {
		super(ctx, env as any);
		this.#registration = null;
		this.#connections = new Map();
		this.#dispatchQueues = new Map();
	}

	async #ensureRuntime(): Promise<ShovelServiceWorkerRegistration> {
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
			const {CloudflarePubSubBackend} = await import("./pubsub.js");
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
			if (conn) this.#connections.set(conn.id, conn);
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
		try {
			(ws as any).serializeAttachment({
				id: state.id,
				url: state.url,
				subscribedChannels: state.subscribedChannels,
			} satisfies WebSocketConnectionState);
		} catch (err) {
			// subscribedChannels is always string[], so serialization should
			// never actually fail. Log and clear if it does.
			logger.error(
				"Failed to persist WS attachment (clearing to avoid stale state): {error}",
				{error: err},
			);
			(ws as any).serializeAttachment({
				id: state.id,
				url: state.url,
				subscribedChannels: [],
			} satisfies WebSocketConnectionState);
		}
	}

	async fetch(request: Request): Promise<Response> {
		const registration = await this.#ensureRuntime();
		const env = (this.env ?? {}) as Record<string, unknown>;

		// Push-on-publish: pubsub DO wakes us via this internal route so
		// cross-isolate publishes reach this DO's local BC subscribers even
		// after hibernation. Handled before the upgrade-path branch.
		if (request.method === "POST") {
			const url = new URL(request.url);
			if (url.pathname === "/_shovel_publish") {
				const {channel, data} = (await request.json()) as {
					channel: string;
					data: unknown;
				};
				const {_dispatchPubSubMessage} = await import("./pubsub.js");
				_dispatchPubSubMessage(channel, data);
				return new Response(null, {status: 204});
			}
		}

		return envStorage.run(env, async () => {
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
				return toHttpErrorResponse(err);
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
				envStorage.run(env, () =>
					dispatchWebSocketMessage(registration, conn!, message),
				),
			)
			.then(() => {
				// Persist updated subscription state (if the handler called
				// subscribe/unsubscribe).
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
		const env = (this.env ?? {}) as Record<string, unknown>;

		let id: string | null = null;
		try {
			const state = (
				ws as any
			).deserializeAttachment() as WebSocketConnectionState;
			id = state?.id ?? null;
		} catch (_err) {
			/* fall through */
		}
		if (!id) return;
		const conn =
			this.#connections.get(id) ?? this.#buildConnectionFromSocket(ws);
		if (!conn) return;

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
			.finally(() => {
				this.#connections.delete(id!);
				this.#dispatchQueues.delete(id!);
			});
		return next;
	}

	async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
		logger.error("WebSocket error: {error}", {error});
		let id: string | null = null;
		try {
			const state = (
				ws as any
			).deserializeAttachment() as WebSocketConnectionState;
			id = state?.id ?? null;
		} catch (_err) {
			/* ignore */
		}
		if (id) {
			// Drop BC subscriptions before forgetting the connection. workerd
			// may report `webSocketError` without a follow-up `webSocketClose`
			// on protocol/transport failures, so this is the only place we
			// can clean up — otherwise channel listeners leak until eviction.
			const conn =
				this.#connections.get(id) ?? this.#buildConnectionFromSocket(ws);
			conn?._releaseSubscriptions();
			this.#connections.delete(id);
			this.#dispatchQueues.delete(id);
		}
	}
}
