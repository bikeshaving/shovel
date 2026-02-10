/**
 * Cloudflare Durable Object PubSub Backend
 *
 * Provides cross-worker BroadcastChannel relay via a Durable Object.
 * - CloudflarePubSubBackend: BroadcastChannelBackend that publishes to a DO
 * - ShovelPubSubDO: Durable Object that broadcasts to connected WebSocket clients
 *
 * Opt-in: only active when env.SHOVEL_PUBSUB binding is present.
 */

import {DurableObject} from "cloudflare:workers";
import type {BroadcastChannelBackend} from "@b9g/platform/broadcast-channel-backend";

// ============================================================================
// BACKEND (used by the Worker)
// ============================================================================

/**
 * BroadcastChannel backend that routes publishes to a Durable Object.
 *
 * Workers are ephemeral and can't maintain persistent subscriptions,
 * so subscribe() is a no-op. Cross-instance delivery happens via
 * WebSocket clients connected to the DO.
 */
export class CloudflarePubSubBackend implements BroadcastChannelBackend {
	#ns: DurableObjectNamespace;

	constructor(ns: DurableObjectNamespace) {
		this.#ns = ns;
	}

	publish(channelName: string, data: unknown): void {
		const id = this.#ns.idFromName("pubsub");
		const stub = this.#ns.get(id);
		// Fire-and-forget POST to the DO
		stub.fetch("http://internal/broadcast", {
			method: "POST",
			headers: {"Content-Type": "application/json"},
			body: JSON.stringify({channel: channelName, data}),
		});
	}

	subscribe(
		_channelName: string,
		_callback: (data: unknown) => void,
	): () => void {
		// Workers are ephemeral — can't maintain persistent subscriptions.
		// Cross-instance delivery happens via WebSocket clients connected to the DO.
		return () => {};
	}

	async dispose(): Promise<void> {
		// Nothing to clean up
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

	async webSocketError(
		_ws: WebSocket,
		_error: unknown,
	): Promise<void> {
		// Hibernation API handles cleanup automatically
	}
}
