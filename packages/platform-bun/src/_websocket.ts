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
	cleanup: () => Promise<void>;
} {
	const liveSockets = new Map<string, any>();
	const pendingFrames = new Map<string, PendingFrame[]>();
	// Insert-time TTL sweep: frames can arrive BEFORE the adapter learns the
	// connection id (the worker sends inside the upgrade handler, and
	// postMessage ordering delivers ws:send ahead of the upgrade result), so
	// buffering must accept unknown ids. Entries for ids that never become
	// live sockets are evicted opportunistically instead of leaking forever.
	const pendingFrameBirth = new Map<string, number>();
	const PENDING_FRAME_TTL = 60_000;
	function sweepPendingFrames(now: number): void {
		for (const [id, born] of pendingFrameBirth) {
			if (now - born > PENDING_FRAME_TTL) {
				pendingFrameBirth.delete(id);
				pendingFrames.delete(id);
			}
		}
	}
	function bufferPendingFrame(id: string, frame: PendingFrame): void {
		const now = Date.now();
		sweepPendingFrames(now);
		let q = pendingFrames.get(id);
		if (!q) {
			q = [];
			pendingFrames.set(id, q);
			pendingFrameBirth.set(id, now);
		}
		q.push(frame);
	}

	pool.setWebSocketHandlers({
		sendFrame(connectionID, data) {
			const ws = liveSockets.get(connectionID);
			if (ws) {
				ws.send(data);
			} else {
				bufferPendingFrame(connectionID, {type: "send", data});
			}
		},
		closeConnection(connectionID, code, reason) {
			const ws = liveSockets.get(connectionID);
			if (ws) {
				ws.close(code ?? 1000, reason ?? "");
			} else {
				bufferPendingFrame(connectionID, {type: "close", code, reason});
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

		const upgradeHeaders = new Headers();
		if (result.setCookieHeaders?.length) {
			for (const sc of result.setCookieHeaders) {
				try {
					upgradeHeaders.append("Set-Cookie", sc);
				} catch (_err) {
					// A CR/LF-bearing value throws AFTER the worker registered
					// the connection; dropping the cookie beats leaking a
					// phantom connection with live subscriptions.
					logger.warn("Dropping invalid Set-Cookie on upgrade");
				}
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
			pendingFrames.delete(result.connectionID);
			pendingFrameBirth.delete(result.connectionID);
			return new Response("WebSocket upgrade failed", {status: 500});
		}
		return undefined;
	};

	const websocket = {
		open(ws: any) {
			const data = ws.data as BunWebSocketData;
			liveSockets.set(data.connectionId, ws);
			// Flush frames queued before the socket became live.
			const queued = pendingFrames.get(data.connectionId);
			if (queued) {
				pendingFrames.delete(data.connectionId);
				pendingFrameBirth.delete(data.connectionId);
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
			pendingFrames.delete(data.connectionId);
			pendingFrameBirth.delete(data.connectionId);
			pool.sendWebSocketClose(data.connectionId, code, reason, code !== 1006);
		},
	};

	return {
		fetch: handleFetch,
		websocket,
		/**
		 * Close every pooled socket and wait (bounded) for the close events to
		 * round-trip through sendWebSocketClose, so workers dispatch
		 * websocketclose before the server force-stops. Without this, Bun
		 * multi-worker shutdown killed sockets under the pool and user close
		 * handlers never ran.
		 */
		async cleanup() {
			for (const ws of liveSockets.values()) {
				try {
					ws.close(1001, "Server shutting down");
				} catch (_err) {
					/* best-effort */
				}
			}
			const deadline = Date.now() + 2000;
			while (liveSockets.size > 0 && Date.now() < deadline) {
				await new Promise((r) => setTimeout(r, 20));
			}
		},
	};
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

		// Store the SAME object the relay closed over: a copy would leave the
		// relay's `entry.ws` permanently null (dead branch) and split state if
		// Bun ever accepts an upgrade whose open callback doesn't fire.
		entry.conn = conn;
		connections.set(
			conn.id,
			entry as typeof entry & {conn: ShovelWebSocketConnection},
		);

		// Carry any Set-Cookie values the handler added via cookieStore onto
		// the 101 handshake. Bun's `server.upgrade` accepts a `headers` option
		// whose values are attached to the upgrade response.
		const upgradeHeaders = new Headers();
		if (event!.cookieStore.hasChanges()) {
			for (const sc of event!.cookieStore.getSetCookieHeaders()) {
				try {
					upgradeHeaders.append("Set-Cookie", sc);
				} catch (_err) {
					// Headers.append throws on CR/LF-bearing values. Dropping the
					// cookie beats rejecting the upgrade: an uncaught throw here
					// would leave the just-registered connection (and its BC
					// subscriptions) leaking with an ever-growing pending buffer.
					logger.warn("Dropping invalid Set-Cookie on upgrade");
				}
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
			for (const [id, entry] of connections) {
				if (!entry.ws) {
					// Never-opened entry (accepted upgrade whose open callback
					// didn't fire): no close event will ever arrive — release it
					// directly instead of stalling the bounded wait below.
					entry.conn?._releaseSubscriptions();
					connections.delete(id);
					continue;
				}
				try {
					entry.ws.close(1001, "Server shutting down");
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
