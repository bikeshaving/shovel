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
import {InternalServerError, isHTTPError, HTTPError} from "@b9g/http-errors";
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

/**
 * Mirrors the error wrapping `BunPlatform.createServer` applies around any
 * handler it owns. Because our WS adapters replace `Bun.serve`'s `fetch`
 * outright, they need to apply the same wrapper themselves — otherwise
 * `HTTPError`s thrown by user code would bypass the framework's response
 * formatting and surface as Bun's default 500.
 */
async function toHttpErrorResponse(error: unknown): Promise<Response> {
	const err = error instanceof Error ? error : new Error(String(error));
	const httpError = isHTTPError(error)
		? (error as HTTPError)
		: new InternalServerError(err.message, {cause: err});
	if (httpError.status >= 500) {
		logger.error("Request error: {error}", {error: err});
	} else {
		logger.warn("Request error: {status} {error}", {
			status: httpError.status,
			error: err,
		});
	}
	const isDev = import.meta.env?.MODE !== "production";
	return httpError.toResponse(isDev);
}

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
	) => Promise<Response | {upgrade: true; connectionID: string}>;
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

	pool.setWebSocketHandlers({
		sendFrame(connectionID, data) {
			const ws = liveSockets.get(connectionID);
			if (ws) {
				ws.send(data);
			} else {
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
				return toHttpErrorResponse(err);
			}
		}

		let result: Response | {upgrade: true; connectionID: string};
		try {
			result = await pool.handleUpgradeRequest(request);
		} catch (err) {
			return toHttpErrorResponse(err);
		}

		if (result instanceof Response) {
			return result;
		}

		const ok = server.upgrade(request, {
			data: {connectionId: result.connectionID} satisfies BunWebSocketData,
		});
		if (!ok) {
			pool.sendWebSocketClose(
				result.connectionID,
				1006,
				"Upgrade failed",
				false,
			);
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
				payload = view.buffer.slice(
					view.byteOffset,
					view.byteOffset + view.byteLength,
				) as ArrayBuffer;
			}
			pool.sendWebSocketMessage(data.connectionId, payload);
		},
		close(ws: any, code: number, reason: string) {
			const data = ws.data as BunWebSocketData;
			liveSockets.delete(data.connectionId);
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
	const dispatchChains = new Map<string, Promise<void>>();

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
				return toHttpErrorResponse(err);
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
			if (upgradedId) connections.delete(upgradedId);
			logger.error("Fetch dispatch threw during upgrade: {error}", {
				error: err,
			});
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
				} catch (_err) {
					/* best-effort */
				}
			}
			await Promise.allSettled([...dispatchChains.values()]);
		},
	};
}
