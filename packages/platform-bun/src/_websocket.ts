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
	errorToResponse,
	toArrayBuffer,
	createOrderedDispatch,
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
 * Pool-mode Bun adapter. Same shape as {@link createBunWebSocketServer} but
 * for the supervisor-side in multi-worker deployments: the supervisor owns
 * the Bun.serve, workers own the runtime Connections, and WS frames cross
 * the worker boundary via pool IPC.
 */
export function createBunPoolWebSocketAdapter(pool: {
	handleUpgradeRequest: (
		request: Request,
	) => Promise<
		| Response
		| {upgrade: true; connectionID: string; setCookieHeaders?: string[]}
	>;
	setWebSocketHandlers: (h: {
		sendFrame: (id: string, data: string | ArrayBuffer) => void;
		closeConnection: (id: string, code?: number, reason?: string) => void;
	}) => void;
	sendWebSocketMessage: (id: string, data: string | ArrayBuffer) => void;
	sendWebSocketClose: (
		id: string,
		code: number,
		reason: string,
		wasClean: boolean,
	) => void;
	handleRequest: (request: Request) => Promise<Response>;
}): {
	fetch: (request: Request, server: any) => Promise<Response | undefined>;
	websocket: {
		open(ws: any): void;
		message(ws: any, message: string | Buffer): void;
		close(ws: any, code: number, reason: string): void;
	};
} {
	const liveSockets = new Map<string, any>();
	const pendingFrames = new Map<string, PendingFrame[]>();
	// Frames are buffered ONLY for connections whose upgrade is in flight
	// (worker accepted, socket not yet live). Frames for any other unknown id
	// (already-closed sockets included) are dropped — buffering them leaked
	// one array per closed connection forever.
	const pendingUpgradeIds = new Set<string>();

	pool.setWebSocketHandlers({
		sendFrame(connectionID, data) {
			const ws = liveSockets.get(connectionID);
			if (ws) {
				ws.send(data);
			} else {
				if (!pendingUpgradeIds.has(connectionID)) return;
				let q = pendingFrames.get(connectionID);
				if (!q) {
					q = [];
					pendingFrames.set(connectionID, q);
				}
				q.push({type: "send", data});
			}
		},
		closeConnection(connectionID, code, reason) {
			const ws = liveSockets.get(connectionID);
			if (ws) {
				ws.close(code ?? 1000, reason ?? "");
			} else {
				if (!pendingUpgradeIds.has(connectionID)) return;
				let q = pendingFrames.get(connectionID);
				if (!q) {
					q = [];
					pendingFrames.set(connectionID, q);
				}
				q.push({type: "close", code, reason});
			}
		},
	});

	const handleFetch = async (
		request: Request,
		server: any,
	): Promise<Response | undefined> => {
		const isUpgrade =
			request.headers.get("upgrade")?.toLowerCase() === "websocket";
		if (!isUpgrade) {
			try {
				return await pool.handleRequest(request);
			} catch (err) {
				return errorToResponse(err);
			}
		}

		let result:
			| Response
			| {upgrade: true; connectionID: string; setCookieHeaders?: string[]};
		try {
			result = await pool.handleUpgradeRequest(request);
		} catch (err) {
			return errorToResponse(err);
		}

		if (result instanceof Response) {
			return result;
		}

		// Buffering window opens: the worker holds a live connection, the
		// physical socket doesn't exist yet.
		pendingUpgradeIds.add(result.connectionID);
		const upgradeHeaders = new Headers();
		if (result.setCookieHeaders?.length) {
			for (const sc of result.setCookieHeaders) {
				upgradeHeaders.append("Set-Cookie", sc);
			}
		}
		const ok = server.upgrade(request, {
			data: {connectionId: result.connectionID} satisfies BunWebSocketData,
			headers: upgradeHeaders,
		});
		if (!ok) {
			pool.sendWebSocketClose(
				result.connectionID,
				1006,
				"Upgrade failed",
				false,
			);
			// The `open` callback that normally flushes+clears these never fires
			// on a failed upgrade, so drop any frames the handler buffered.
			pendingUpgradeIds.delete(result.connectionID);
			pendingFrames.delete(result.connectionID);
			return new Response("WebSocket upgrade failed", {status: 500});
		}
		return undefined;
	};

	const websocket = {
		open(ws: any) {
			const data = ws.data as BunWebSocketData;
			pendingUpgradeIds.delete(data.connectionId);
			liveSockets.set(data.connectionId, ws);
			// Flush frames queued before the socket became live.
			const queued = pendingFrames.get(data.connectionId);
			if (queued) {
				pendingFrames.delete(data.connectionId);
				for (const frame of queued) {
					if (frame.type === "send") ws.send(frame.data);
					else ws.close(frame.code ?? 1000, frame.reason ?? "");
				}
			}
		},
		message(ws: any, message: string | Buffer) {
			const data = ws.data as BunWebSocketData;
			let payload: string | ArrayBuffer;
			if (typeof message === "string") {
				payload = message;
			} else if (message instanceof ArrayBuffer) {
				payload = message;
			} else {
				const view = message as Uint8Array;
				payload = toArrayBuffer(view);
			}
			pool.sendWebSocketMessage(data.connectionId, payload);
		},
		close(ws: any, code: number, reason: string) {
			const data = ws.data as BunWebSocketData;
			liveSockets.delete(data.connectionId);
			pendingUpgradeIds.delete(data.connectionId);
			pendingFrames.delete(data.connectionId);
			pool.sendWebSocketClose(data.connectionId, code, reason, code !== 1006);
		},
	};

	return {fetch: handleFetch, websocket};
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
	const {
		enqueue: enqueueDispatch,
		release: releaseDispatch,
		drain: drainDispatch,
	} = createOrderedDispatch();

	const handleFetch = async (
		request: Request,
		server: any,
	): Promise<Response | undefined> => {
		const isUpgrade =
			request.headers.get("upgrade")?.toLowerCase() === "websocket";
		if (!isUpgrade) {
			try {
				return await dispatchRequest(registration, request);
			} catch (err) {
				return errorToResponse(err);
			}
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
			// Phantom-client cleanup. If the handler called upgradeWebSocket()
			// before throwing, the connection object holds live BC
			// subscriptions — release them so we don't leak channel listeners
			// pointing at a socket that will never exist.
			if (upgradedId) {
				connections.delete(upgradedId);
				entry.conn?._releaseSubscriptions();
			}
			// If the handler rejected the upgrade by throwing HTTPError
			// (e.g. UnauthorizedError) before calling upgradeWebSocket(),
			// translate the same way ordinary HTTP traffic does.
			return errorToResponse(err);
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

		// Carry any Set-Cookie values the handler added via cookieStore onto
		// the 101 handshake. Bun's `server.upgrade` accepts a `headers` option
		// whose values are attached to the upgrade response.
		const upgradeHeaders = new Headers();
		if (event!.cookieStore.hasChanges()) {
			for (const sc of event!.cookieStore.getSetCookieHeaders()) {
				upgradeHeaders.append("Set-Cookie", sc);
			}
		}
		// Bun.serve.upgrade returns a boolean; we also store a small attachment
		// that the websocket.open callback will read to find the runtime conn.
		const ok = server.upgrade(request, {
			data: {connectionId: conn.id} satisfies BunWebSocketData,
			headers: upgradeHeaders,
		});
		if (!ok) {
			// Bun rejected the handshake (e.g., client disconnected). Clear
			// runtime state including BC subscriptions to avoid a phantom.
			connections.delete(conn.id);
			releaseDispatch(conn.id);
			conn._releaseSubscriptions();
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
				logger.warn("websocket.open for unknown connection: {id}", {
					id: data.connectionId,
				});
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
				payload = toArrayBuffer(view);
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
					releaseDispatch(entry.conn.id);
				}
			});
		},
	};

	return {
		fetch: handleFetch,
		websocket,
		async cleanup() {
			for (const {ws} of connections.values()) {
				try {
					ws?.close(1001, "Server shutting down");
				} catch (_err) {
					/* best-effort */
				}
			}
			// websocketclose dispatches are enqueued from Bun's close callback,
			// which fires after the closing handshake — wait (bounded) for the
			// connections to unregister before draining, or user close handlers
			// race server/database shutdown (same fix as the Node adapter).
			const deadline = Date.now() + 2000;
			while (connections.size > 0 && Date.now() < deadline) {
				await new Promise((r) => setTimeout(r, 20));
			}
			await drainDispatch();
		},
	};
}
