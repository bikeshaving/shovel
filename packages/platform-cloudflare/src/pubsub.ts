/**
 * Cloudflare Durable Object PubSub Backend
 *
 * Provides cross-isolate BroadcastChannel relay via a Durable Object.
 * - CloudflarePubSubBackend: BroadcastChannelBackend that publishes to a DO
 * - ShovelPubSubDO: Durable Object that broadcasts to connected WebSocket clients
 *
 * Opt-in: only active when env.SHOVEL_PUBSUB binding is present.
 *
 * Architecture:
 * - publish() sends a POST to the DO with {channel, data, sender}
 * - subscribe() opens a WebSocket to the DO to receive broadcasts
 * - The DO fans out POST payloads to all connected WebSocket clients
 * - Sender filtering happens client-side (same pattern as Redis backend)
 *
 * Note: Cloudflare Workers are ephemeral, so WebSocket subscriptions only
 * live as long as the Worker's execution context. For typical request/response
 * Workers this means subscriptions are short-lived. For Durable Object contexts
 * or Workers using waitUntil(), subscriptions can persist longer.
 */

import {DurableObject} from "cloudflare:workers";
import type {BroadcastChannelBackend} from "@b9g/platform/broadcast-channel-backend";
import {getLogger} from "@logtape/logtape";

const logger = getLogger(["shovel", "pubsub"]);

// ============================================================================
// BACKEND (used by the Worker)
// ============================================================================

/**
 * BroadcastChannel backend that routes messages through a Durable Object.
 *
 * Uses an instance ID to filter out own messages (prevents echo),
 * matching the pattern used by RedisPubSubBackend.
 */
export class CloudflarePubSubBackend implements BroadcastChannelBackend {
	#ns: DurableObjectNamespace;
	#instanceId: string;
	#ws: WebSocket | null;
	#wsReady: Promise<void> | null;
	#callbacks: Map<string, Set<(data: unknown) => void>>;

	constructor(ns: DurableObjectNamespace) {
		this.#ns = ns;
		this.#instanceId = crypto.randomUUID();
		this.#ws = null;
		this.#wsReady = null;
		this.#callbacks = new Map();
	}

	#ensureConnection(): void {
		if (this.#wsReady) return;
		this.#wsReady = this.#connect().catch(() => {
			// Connection failed — allow retry on next subscribe() call
			this.#wsReady = null;
		});
	}

	async #connect(): Promise<void> {
		const id = this.#ns.idFromName("pubsub");
		const stub = this.#ns.get(id);
		const response = await stub.fetch("http://internal/subscribe", {
			headers: {Upgrade: "websocket"},
		});
		const ws = (response as any).webSocket as WebSocket | undefined;
		if (!ws) {
			throw new Error("WebSocket upgrade to PubSub DO failed");
		}
		ws.accept();
		this.#ws = ws;
		ws.addEventListener("message", (ev: MessageEvent) => {
			try {
				const {channel, data, sender} = JSON.parse(ev.data as string);
				// Skip messages from this instance (prevents echo)
				if (sender === this.#instanceId) return;
				const cbs = this.#callbacks.get(channel);
				if (cbs) {
					for (const cb of cbs) cb(data);
				}
			} catch (err) {
				logger.debug("Failed to parse pubsub message: {error}", {
					error: err,
				});
			}
		});
	}

	publish(channelName: string, data: unknown): void {
		const id = this.#ns.idFromName("pubsub");
		const stub = this.#ns.get(id);
		// Fire-and-forget POST to the DO
		stub.fetch("http://internal/broadcast", {
			method: "POST",
			headers: {"Content-Type": "application/json"},
			body: JSON.stringify({
				channel: channelName,
				data,
				sender: this.#instanceId,
			}),
		});
	}

	subscribe(
		channelName: string,
		callback: (data: unknown) => void,
	): () => void {
		this.#ensureConnection();
		let cbs = this.#callbacks.get(channelName);
		if (!cbs) {
			cbs = new Set();
			this.#callbacks.set(channelName, cbs);
		}
		cbs.add(callback);
		return () => {
			cbs!.delete(callback);
			if (cbs!.size === 0) this.#callbacks.delete(channelName);
		};
	}

	async dispose(): Promise<void> {
		this.#ws?.close();
		this.#ws = null;
		this.#wsReady = null;
		this.#callbacks.clear();
	}
}

// ============================================================================
// DURABLE OBJECT (implementation detail)
// ============================================================================

/**
 * Durable Object that fans out BroadcastChannel messages to connected
 * WebSocket clients. Uses WebSocket Hibernation API for efficiency.
 */
export class ShovelPubSubDO extends DurableObject {
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		// WebSocket upgrade — clients connect to receive broadcasts
		if (request.headers.get("Upgrade") === "websocket") {
			const pair = new WebSocketPair();
			const [client, server] = Object.values(pair);
			this.ctx.acceptWebSocket(server);
			return new Response(null, {status: 101, webSocket: client});
		}

		// POST /broadcast — fan out to all connected sockets
		if (request.method === "POST" && url.pathname === "/broadcast") {
			const payload = await request.text();
			for (const ws of this.ctx.getWebSockets()) {
				ws.send(payload);
			}
			return new Response("OK");
		}

		return new Response("Not Found", {status: 404});
	}

	async webSocketMessage(
		ws: WebSocket,
		message: string | ArrayBuffer,
	): Promise<void> {
		// Fan out to all OTHER connected sockets
		const data = typeof message === "string" ? message : message;
		for (const peer of this.ctx.getWebSockets()) {
			if (peer !== ws) {
				peer.send(data);
			}
		}
	}

	async webSocketClose(
		_ws: WebSocket,
		_code: number,
		_reason: string,
		_wasClean: boolean,
	): Promise<void> {
		// Hibernation API handles cleanup automatically
	}

	async webSocketError(_ws: WebSocket, _error: unknown): Promise<void> {
		// Hibernation API handles cleanup automatically
	}
}
