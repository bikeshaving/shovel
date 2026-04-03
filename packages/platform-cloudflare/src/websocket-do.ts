/**
 * WebSocket Durable Object with Hibernation API support.
 *
 * Separate file because `cloudflare:workers` can only be imported inside workerd.
 * The generated entry code imports this directly — it's never loaded outside Cloudflare.
 */

import {DurableObject} from "cloudflare:workers";
import {
	ShovelServiceWorkerRegistration,
	ShovelWebSocketClient,
	ShovelClients,
	runLifecycle,
	dispatchFetchEvent,
	kGetUpgradeResult,
	dispatchWebSocketMessage,
	dispatchWebSocketClose,
	setBroadcastChannelBackend,
} from "@b9g/platform/runtime";
import {CloudflareFetchEvent} from "./runtime.js";
import {envStorage} from "./variables.js";
import {getLogger} from "@logtape/logtape";

const logger = getLogger(["shovel", "platform"]);

/**
 * Serialized attachment stored on each accepted WebSocket.
 * Survives hibernation via ws.serializeAttachment/deserializeAttachment.
 */
interface WSAttachment {
	connectionID: string;
	url: string;
	data: unknown;
}

/**
 * Durable Object that handles WebSocket connections using the Hibernation API.
 *
 * The Worker routes `Upgrade: websocket` requests to this DO. The DO:
 * 1. Initializes the Shovel runtime + user code (once, or after hibernation wake-up)
 * 2. Dispatches the fetch event — if upgradeWebSocket() is called, accepts with hibernation
 * 3. On webSocketMessage/webSocketClose, reconstructs the client and dispatches events
 *
 * Because hibernation discards JS state, the runtime and user code are re-initialized
 * on every wake-up. The ShovelWebSocketClient is reconstructed from the attachment.
 *
 * Usage in wrangler.toml:
 *   [[durable_objects.bindings]]
 *   name = "SHOVEL_WS"
 *   class_name = "ShovelWebSocketDO"
 */
export class ShovelWebSocketDO extends DurableObject {
	#registration: ShovelServiceWorkerRegistration | null;
	#shovelClients: ShovelClients | null;
	#dispatchQueues: Map<string, Promise<void>>;

	constructor(ctx: DurableObjectState, env: Record<string, unknown>) {
		super(ctx, env as any);
		this.#registration = null;
		this.#shovelClients = null;
		this.#dispatchQueues = new Map();
	}

	async #ensureRuntime(): Promise<ShovelServiceWorkerRegistration> {
		if (this.#registration) return this.#registration;

		// After hibernation, the module is re-evaluated. initializeRuntime()
		// runs at module level in the generated entry, so _registration exists.
		// We access it via the global ServiceWorkerRegistration that
		// ServiceWorkerGlobals installs.
		const {_getRegistration} = await import("./runtime.js");
		this.#registration = _getRegistration();
		if (!this.#registration) {
			throw new Error(
				"Shovel runtime not initialized. " +
					"Ensure initializeRuntime() is called at module level.",
			);
		}

		// Run lifecycle if needed. On the initial request, the Worker already
		// activated before forwarding to this DO. But after hibernation wake-up,
		// the module is re-evaluated with a fresh registration that hasn't been
		// activated in this isolate.
		if (!this.#registration.ready) {
			await runLifecycle(this.#registration, "activate");
		}

		// Configure BroadcastChannel backend in the DO isolate if available
		const env = (this.env ?? {}) as Record<string, unknown>;
		if (env.SHOVEL_PUBSUB) {
			const {CloudflarePubSubBackend} = await import("./pubsub.js");
			setBroadcastChannelBackend(
				new CloudflarePubSubBackend(
					env.SHOVEL_PUBSUB as DurableObjectNamespace,
				),
			);
		}

		this.#shovelClients =
			typeof self !== "undefined" &&
			(self as any).clients instanceof ShovelClients
				? ((self as any).clients as ShovelClients)
				: null;

		// Rehydrate all existing WebSocket connections from hibernation storage.
		// After wake-up, ctx.getWebSockets() returns all accepted sockets but
		// self.clients is empty. Rebuild so matchAll/get see all connections.
		if (this.#shovelClients) {
			for (const ws of this.ctx.getWebSockets()) {
				const client = this.#clientFromSocket(ws);
				this.#shovelClients.registerWebSocketClient(client);
			}
		}

		return this.#registration;
	}

	#clientFromSocket(ws: WebSocket): ShovelWebSocketClient {
		const attachment = (ws as any).deserializeAttachment() as WSAttachment;
		return new ShovelWebSocketClient({
			id: attachment.connectionID,
			url: attachment.url,
			data: attachment.data,
			relay: {
				send(_id: string, data: string | ArrayBuffer) {
					ws.send(data);
				},
				close(_id: string, code?: number, reason?: string) {
					ws.close(code ?? 1000, reason ?? "");
				},
			},
		});
	}

	async fetch(request: Request): Promise<Response> {
		const registration = await this.#ensureRuntime();
		const env = (this.env ?? {}) as Record<string, unknown>;

		return envStorage.run(env, async () => {
			// Buffer messages sent during the fetch handler (before the real socket exists)
			const pendingMessages: Array<
				| {type: "send"; data: string | ArrayBuffer}
				| {type: "close"; code?: number; reason?: string}
			> = [];

			const cfEvent = new CloudflareFetchEvent(request, {
				env,
				platformWaitUntil: (promise: Promise<unknown>) =>
					this.ctx.waitUntil(promise),
				wsRelay: {
					send(_id: string, data: string | ArrayBuffer) {
						pendingMessages.push({type: "send", data});
					},
					close(_id: string, code?: number, reason?: string) {
						pendingMessages.push({type: "close", code, reason});
					},
				},
			});

			const {response, event} = await dispatchFetchEvent(registration, cfEvent);

			const upgrade = event[kGetUpgradeResult]?.();
			if (upgrade) {
				const pair = new WebSocketPair();
				const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

				try {
					(server as any).serializeAttachment({
						connectionID: upgrade.client.id,
						url: request.url,
						data: upgrade.client.data,
					} satisfies WSAttachment);
				} catch {
					// data is not structured-cloneable — store without it
					(server as any).serializeAttachment({
						connectionID: upgrade.client.id,
						url: request.url,
						data: null,
					} satisfies WSAttachment);
					logger.warn(
						"client.data is not structured-cloneable and will not survive hibernation",
					);
				}

				this.ctx.acceptWebSocket(server);

				// Bind the live relay
				upgrade.client.setRelay({
					send(_id: string, data: string | ArrayBuffer) {
						server.send(data);
					},
					close(_id: string, code?: number, reason?: string) {
						server.close(code ?? 1000, reason ?? "");
					},
				});

				// Flush any messages buffered during the fetch handler
				for (const msg of pendingMessages) {
					if (msg.type === "send") {
						server.send(msg.data);
					} else if (msg.type === "close") {
						server.close(msg.code ?? 1000, msg.reason ?? "");
					}
				}

				this.#shovelClients?.registerWebSocketClient(upgrade.client);

				return new Response(null, {
					status: 101,
					webSocket: client,
				} as any);
			}

			return response!;
		});
	}

	async webSocketMessage(
		ws: WebSocket,
		message: string | ArrayBuffer,
	): Promise<void> {
		const registration = await this.#ensureRuntime();
		const env = (this.env ?? {}) as Record<string, unknown>;
		// Read connectionID from attachment for queue key, but defer full
		// client reconstruction until after previous dispatch completes
		// so we get the latest client.data after prior mutations.
		const attachment = (ws as any).deserializeAttachment() as WSAttachment;
		const connectionID = attachment.connectionID;

		const prev = this.#dispatchQueues.get(connectionID) ?? Promise.resolve();
		const next = prev
			.then(() => {
				// Reconstruct client AFTER previous dispatch to get latest data
				const client = this.#clientFromSocket(ws);
				this.#shovelClients?.registerWebSocketClient(client);
				return envStorage
					.run(env, () =>
						dispatchWebSocketMessage(registration, client, message),
					)
					.then(() => {
						// Persist client.data mutations for hibernation survival
						try {
							(ws as any).serializeAttachment({
								connectionID: client.id,
								url: client.url,
								data: client.data,
							} satisfies WSAttachment);
						} catch {
							// data not structured-cloneable — skip persistence
						}
					});
			})
			.catch((err) => {
				logger.error("WebSocket message dispatch failed: {error}", {
					error: err,
				});
			});
		this.#dispatchQueues.set(connectionID, next);
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
		const attachment = (ws as any).deserializeAttachment() as WSAttachment;
		const connectionID = attachment.connectionID;

		const prev = this.#dispatchQueues.get(connectionID) ?? Promise.resolve();
		const next = prev
			.then(() => {
				const client = this.#clientFromSocket(ws);
				return envStorage.run(env, () =>
					dispatchWebSocketClose(registration, client, code, reason, wasClean),
				);
			})
			.catch((err) => {
				logger.error("WebSocket close dispatch failed: {error}", {
					error: err,
				});
			})
			.finally(() => {
				this.#shovelClients?.removeWebSocketClient(connectionID);
				this.#dispatchQueues.delete(connectionID);
			});
		return next;
	}

	async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
		logger.error("WebSocket error: {error}", {error});
		const client = this.#clientFromSocket(ws);
		this.#shovelClients?.removeWebSocketClient(client.id);
		this.#dispatchQueues.delete(client.id);
	}
}
