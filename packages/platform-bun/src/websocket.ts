/**
 * Bun WebSocket adapter for Shovel.
 *
 * Exposes `createBunWebSocketServer()` which returns the fetch/websocket
 * configuration to pass to `Bun.serve()`. The fetch callback handles regular
 * requests AND WebSocket upgrades; the websocket handlers bridge frames to
 * the Shovel runtime dispatch functions.
 *
 * Direct-mode only. Pool-mode forwarding lives in a separate module.
 *
 * Lessons baked in from prior PR:
 * - Connection registered synchronously via onUpgrade; phantom cleanup in
 *   the dispatch catch path drops state if the handler throws.
 * - Buffering relay collects conn.send()/conn.close() calls made during
 *   the fetch handler; flushed only inside `websocket.open` after the
 *   socket is live.
 * - Per-connection dispatch chain serializes messages in arrival order.
 * - Connection removal deferred until AFTER websocketclose handlers run.
 * - Binary frames preserve byteOffset/byteLength via buffer slicing.
 */

import {getLogger} from "@logtape/logtape";
import {
	ShovelFetchEvent,
	ShovelServiceWorkerRegistration,
	ShovelWebSocketConnection,
	dispatchFetchEvent,
	dispatchRequest,
	dispatchWebSocketMessage,
	dispatchWebSocketClose,
	kBindRelay,
	kGetUpgradeResult,
	type WebSocketRelay,
} from "@b9g/platform/runtime";

const logger = getLogger(["shovel", "platform", "bun", "websocket"]);

type PendingFrame =
	| {type: "send"; data: string | ArrayBuffer}
	| {type: "close"; code?: number; reason?: string};

/**
 * Per-WebSocket attachment data stored on `ServerWebSocket.data`.
 * Keeps the runtime Connection reachable from Bun's websocket callbacks.
 */
export interface BunWebSocketData {
	connectionId: string;
}

/**
 * Build the fetch+websocket config for Bun.serve. Returned value is a subset
 * of Bun.ServeOptions that you can spread into your `Bun.serve()` call:
 *
 * ```ts
 * const {fetch, websocket} = createBunWebSocketServer(registration);
 * Bun.serve({port: 3000, fetch, websocket});
 * ```
 */
export function createBunWebSocketServer(
	registration: ShovelServiceWorkerRegistration,
): {
	fetch: (request: Request, server: any) => Promise<Response | undefined>;
	websocket: {
		open(ws: any): void;
		message(ws: any, message: string | Buffer): void;
		close(ws: any, code: number, reason: string): void;
	};
	cleanup(): Promise<void>;
} {
	const connections = new Map<
		string,
		{
			conn: ShovelWebSocketConnection;
			ws: any | null;
			pending: PendingFrame[];
		}
	>();
	const dispatchChains = new Map<string, Promise<void>>();

	const handleFetch = async (
		request: Request,
		server: any,
	): Promise<Response | undefined> => {
		const isUpgrade =
			request.headers.get("upgrade")?.toLowerCase() === "websocket";
		if (!isUpgrade) {
			return dispatchRequest(registration, request);
		}

		// Buffering relay — holds frames until websocket.open fires.
		const entry: {
			conn: ShovelWebSocketConnection | null;
			ws: any | null;
			pending: PendingFrame[];
		} = {conn: null, ws: null, pending: []};

		const relay: WebSocketRelay = {
			send(_id, data) {
				if (entry.ws) entry.ws.send(data);
				else entry.pending.push({type: "send", data});
			},
			close(_id, code, reason) {
				if (entry.ws) entry.ws.close(code ?? 1000, reason ?? "");
				else entry.pending.push({type: "close", code, reason});
			},
		};

		let event: ShovelFetchEvent | undefined;
		let response: Response | null | undefined;
		let upgradedId: string | null = null;

		try {
			const result = await dispatchFetchEvent(registration, request, {
				wsRelay: relay,
				onUpgrade(conn) {
					upgradedId = conn.id;
					entry.conn = conn;
				},
			});
			event = result.event;
			response = result.response;
		} catch (err) {
			if (upgradedId) connections.delete(upgradedId);
			logger.error("Fetch dispatch threw during upgrade: {error}", {error: err});
			return new Response("Internal Server Error", {status: 500});
		}

		const conn = event![kGetUpgradeResult]();
		if (!conn) {
			return response ?? new Response("Upgrade Required", {status: 426});
		}

		connections.set(conn.id, {
			conn,
			ws: null,
			pending: entry.pending,
		});

		// Bun.serve.upgrade returns a boolean; we also store a small attachment
		// that the websocket.open callback will read to find the runtime conn.
		const ok = server.upgrade(request, {
			data: {connectionId: conn.id} satisfies BunWebSocketData,
		});
		if (!ok) {
			connections.delete(conn.id);
			dispatchChains.delete(conn.id);
			return new Response("WebSocket upgrade failed", {status: 500});
		}
		// Returning undefined tells Bun the request has been handed off.
		return undefined;
	};

	const websocket = {
		open(ws: any) {
			const data = ws.data as BunWebSocketData;
			const entry = connections.get(data.connectionId);
			if (!entry) {
				// Shouldn't happen — upgrade succeeded without a registered conn
				logger.warn(
					"websocket.open for unknown connection: {id}",
					{id: data.connectionId},
				);
				ws.close(1011, "Server state lost");
				return;
			}
			entry.ws = ws;
			// Rebind the runtime relay to go directly to the live socket,
			// bypassing the buffering closure we used during the fetch handler.
			entry.conn[kBindRelay]({
				send(_id, payload) {
					ws.send(payload);
				},
				close(_id, code, reason) {
					ws.close(code ?? 1000, reason ?? "");
				},
			});
			// Flush buffered frames.
			for (const frame of entry.pending) {
				if (frame.type === "send") ws.send(frame.data);
				else ws.close(frame.code ?? 1000, frame.reason ?? "");
			}
			entry.pending.length = 0;
		},
		message(ws: any, message: string | Buffer) {
			const data = ws.data as BunWebSocketData;
			const entry = connections.get(data.connectionId);
			if (!entry) return;
			let payload: string | ArrayBuffer;
			if (typeof message === "string") {
				payload = message;
			} else if (message instanceof ArrayBuffer) {
				payload = message;
			} else {
				// Uint8Array / Buffer — slice to preserve byteOffset/byteLength
				const view = message as Uint8Array;
				payload = view.buffer.slice(
					view.byteOffset,
					view.byteOffset + view.byteLength,
				) as ArrayBuffer;
			}
			enqueueDispatch(entry.conn.id, () =>
				dispatchWebSocketMessage(registration, entry.conn, payload),
			);
		},
		close(ws: any, code: number, reason: string) {
			const data = ws.data as BunWebSocketData;
			const entry = connections.get(data.connectionId);
			if (!entry) return;
			const wasClean = code !== 1006;
			enqueueDispatch(entry.conn.id, async () => {
				try {
					await dispatchWebSocketClose(
						registration,
						entry.conn,
						code,
						reason,
						wasClean,
					);
				} finally {
					connections.delete(entry.conn.id);
					dispatchChains.delete(entry.conn.id);
				}
			});
		},
	};

	function enqueueDispatch(id: string, task: () => Promise<void>): void {
		const prev = dispatchChains.get(id) ?? Promise.resolve();
		const next = prev
			.then(task)
			.catch((err) =>
				logger.error("WebSocket dispatch failed: {error}", {error: err}),
			);
		dispatchChains.set(id, next);
	}

	return {
		fetch: handleFetch,
		websocket,
		async cleanup() {
			for (const {ws} of connections.values()) {
				try {
					ws?.close(1001, "Server shutting down");
				} catch {
					/* best-effort */
				}
			}
			await Promise.allSettled([...dispatchChains.values()]);
		},
	};
}
