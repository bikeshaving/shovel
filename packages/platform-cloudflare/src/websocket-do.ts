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
	setBroadcastChannelBackend,
	type WebSocketRelay,
} from "@b9g/platform/runtime";
import {CloudflareFetchEvent} from "./runtime.js";
import {envStorage} from "./variables.js";
import {getLogger} from "@logtape/logtape";

const logger = getLogger(["shovel", "platform", "cloudflare", "ws"]);

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

		// Skip re-running install/activate — the Worker ran them before
		// forwarding the upgrade to the DO, and re-running would duplicate
		// migrations/cache warming per wake.
		if (!reg.ready) {
			const {kServiceWorker} = await import("@b9g/platform/runtime");
			(reg as any)[kServiceWorker]._setState("activated");
		}

		// Configure the BroadcastChannel backend inside this DO isolate if
		// the SHOVEL_PUBSUB binding is present. This is a no-op if already
		// configured for this isolate.
		const env = (this.env ?? {}) as Record<string, unknown>;
		if (env.SHOVEL_PUBSUB) {
			const {CloudflarePubSubBackend} = await import("./pubsub.js");
			setBroadcastChannelBackend(
				new CloudflarePubSubBackend(
					env.SHOVEL_PUBSUB as DurableObjectNamespace,
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
			attachment = (ws as any).deserializeAttachment() as WebSocketConnectionState;
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

		return envStorage.run(env, async () => {
			// Buffer frames the handler produces BEFORE the real socket exists.
			const pending: Array<
				| {type: "send"; data: string | ArrayBuffer}
				| {type: "close"; code?: number; reason?: string}
			> = [];

			let upgradedId: string | null = null;
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
				}
				logger.error("Fetch dispatch threw during upgrade: {error}", {
					error: err,
				});
				return new Response("Internal Server Error", {status: 500});
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

			return new Response(null, {status: 101, webSocket: client} as any);
		});
	}

	async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
		const registration = await this.#ensureRuntime();
		const env = (this.env ?? {}) as Record<string, unknown>;

		// Identify the connection from the attachment (source of truth after
		// hibernation). The rehydrated #connections map was populated in
		// #ensureRuntime() when we woke up.
		let id: string | null = null;
		try {
			const state = (ws as any).deserializeAttachment() as WebSocketConnectionState;
			id = state?.id ?? null;
		} catch {
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
			const state = (ws as any).deserializeAttachment() as WebSocketConnectionState;
			id = state?.id ?? null;
		} catch {
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
					dispatchWebSocketClose(
						registration,
						conn,
						code,
						reason,
						wasClean,
					),
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
			const state = (ws as any).deserializeAttachment() as WebSocketConnectionState;
			id = state?.id ?? null;
		} catch {
			/* ignore */
		}
		if (id) {
			this.#connections.delete(id);
			this.#dispatchQueues.delete(id);
		}
	}
}
