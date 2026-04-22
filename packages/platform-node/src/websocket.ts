/**
 * Node.js WebSocket adapter for Shovel.
 *
 * Installs a listener on an existing `http.Server` that handles
 * `Upgrade: websocket` requests by dispatching a fetch event with a
 * Shovel-provided relay. If the event calls `upgradeWebSocket()`, the
 * handshake is completed via the `ws` package and subsequent frames are
 * forwarded to `dispatchWebSocketMessage` / `dispatchWebSocketClose`.
 *
 * Direct-mode use. Pool-mode WebSocket forwarding lives in a separate
 * module (worker→supervisor IPC).
 *
 * Lessons carried over from prior PR (#82 review cycles):
 * - Register connection synchronously on `onUpgrade` so in-handler close
 *   has something to target. Clean up if the handler throws afterward.
 * - Flush buffered frames AFTER `ws.on("message")` / `ws.on("close")` are
 *   attached — otherwise an immediate close frame gets dropped.
 * - Serialize per-connection dispatch so handlers observe messages in
 *   arrival order.
 * - Defer removing the connection from the local registry until AFTER
 *   `websocketclose` handlers run, so they can still reference it.
 */

import * as HTTP from "node:http";
import type {Socket} from "node:net";
import {getLogger} from "@logtape/logtape";
import {
	ShovelFetchEvent,
	ShovelServiceWorkerRegistration,
	ShovelWebSocketConnection,
	dispatchFetchEvent,
	dispatchWebSocketMessage,
	dispatchWebSocketClose,
	kBindRelay,
	kGetUpgradeResult,
	type WebSocketRelay,
} from "@b9g/platform/runtime";

const logger = getLogger(["shovel", "platform", "node", "websocket"]);

/** Frames buffered between `upgradeWebSocket()` and the real socket coming up. */
type PendingFrame =
	| {type: "send"; data: string | ArrayBuffer}
	| {type: "close"; code?: number; reason?: string};

/**
 * Install an upgrade listener. Returns a cleanup function that removes the
 * listener and closes any still-open connections.
 */
export function attachNodeWebSocketHandler(
	httpServer: HTTP.Server,
	registration: ShovelServiceWorkerRegistration,
): () => Promise<void> {
	// Lazy-load `ws` so environments without it don't fail to import this module.
	let wsServerPromise: Promise<{
		WebSocketServer: any;
	}> | null = null;
	const loadWs = () => {
		if (!wsServerPromise) wsServerPromise = import("ws");
		return wsServerPromise;
	};

	// Per-isolate registry of live connections. Allows cleanup on shutdown and
	// defense-in-depth lookup on close/message (we also receive the connection
	// object directly from dispatch, but storage makes shutdown clean).
	const connections = new Map<string, {conn: ShovelWebSocketConnection; ws: any}>();

	// Per-connection dispatch queues so messages are delivered in order.
	const dispatchChains = new Map<string, Promise<void>>();

	const upgradeListener = async (
		req: HTTP.IncomingMessage,
		socket: Socket,
		head: Buffer,
	) => {
		const url = `http://${req.headers.host}${req.url}`;
		const hasBody = req.method !== "GET" && req.method !== "HEAD";
		const request = new Request(url, {
			method: req.method,
			headers: req.headers as HeadersInit,
			body: hasBody ? (req as any) : undefined,
			duplex: hasBody ? "half" : undefined,
		} as RequestInit);

		// Frames the user's fetch handler emits BEFORE the real ws exists
		// (e.g. conn.send("welcome") inside upgradeWebSocket handler).
		const pending: PendingFrame[] = [];
		let realWs: any = null;
		let upgradedConnectionId: string | null = null;

		const flushPending = (ws: any) => {
			for (const frame of pending) {
				if (frame.type === "send") {
					ws.send(frame.data);
				} else {
					ws.close(frame.code ?? 1000, frame.reason ?? "");
				}
			}
			pending.length = 0;
		};

		// Buffering relay: forwards to `realWs` once set, otherwise queues.
		const relay: WebSocketRelay = {
			send(_id, data) {
				if (realWs) realWs.send(data);
				else pending.push({type: "send", data});
			},
			close(_id, code, reason) {
				if (realWs) realWs.close(code ?? 1000, reason ?? "");
				else pending.push({type: "close", code, reason});
			},
		};

		let event: ShovelFetchEvent | undefined;
		let response: Response | null | undefined;

		try {
			const result = await dispatchFetchEvent(registration, request, {
				wsRelay: relay,
				onUpgrade(conn) {
					upgradedConnectionId = conn.id;
				},
			});
			event = result.event;
			response = result.response;
		} catch (err) {
			// Phantom-client cleanup: if handler registered a connection and then
			// threw, drop it from our registry (none was stored yet — onUpgrade
			// only stores into the local variable — but if later we register on
			// upgrade, cleanup goes here).
			if (upgradedConnectionId) {
				connections.delete(upgradedConnectionId);
				dispatchChains.delete(upgradedConnectionId);
			}
			logger.error("Fetch dispatch threw during upgrade: {error}", {error: err});
			writeErrorAndDestroy(socket, 500, "Internal Server Error");
			return;
		}

		const conn = event![kGetUpgradeResult]();
		if (!conn) {
			// Handler did not upgrade — write whatever response was produced
			// (typically a 4xx from the handler) and close the socket.
			if (response) {
				writeResponseAndDestroy(socket, response);
			} else {
				writeErrorAndDestroy(socket, 426, "Upgrade Required");
			}
			return;
		}

		// Complete the handshake using `ws`.
		let wsModule;
		try {
			wsModule = await loadWs();
		} catch (err) {
			logger.error(
				"Failed to load `ws` package for WebSocket upgrade: {error}",
				{error: err},
			);
			writeErrorAndDestroy(socket, 500, "WebSocket support unavailable");
			connections.delete(conn.id);
			dispatchChains.delete(conn.id);
			return;
		}

		const wss = new wsModule.WebSocketServer({noServer: true});
		wss.handleUpgrade(req, socket, head, (ws: any) => {
			realWs = ws;
			connections.set(conn.id, {conn, ws});

			// Rebind the connection's relay directly to the live socket so that
			// subsequent `conn.send()` doesn't go through the buffer.
			conn[kBindRelay]({
				send(_id, data) {
					ws.send(data);
				},
				close(_id, code, reason) {
					ws.close(code ?? 1000, reason ?? "");
				},
			});

			// IMPORTANT: attach listeners BEFORE flushing buffered frames.
			// If the handler called conn.close() during upgrade, the buffered
			// close frame triggers ws.close() which triggers "close" — we
			// need the listener in place to see it.
			ws.on("message", (data: Buffer, isBinary: boolean) => {
				const payload = isBinary ? bufferToArrayBuffer(data) : data.toString("utf8");
				enqueue(conn.id, () =>
					dispatchWebSocketMessage(registration, conn, payload),
				);
			});

			ws.on("close", (code: number, reason: Buffer) => {
				enqueue(conn.id, async () => {
					try {
						await dispatchWebSocketClose(
							registration,
							conn,
							code,
							reason.toString("utf8"),
							code === 1000 || code === 1001,
						);
					} finally {
						connections.delete(conn.id);
						dispatchChains.delete(conn.id);
					}
				});
			});

			ws.on("error", (err: Error) => {
				logger.error("WebSocket error: {error}", {error: err});
			});

			// Now safe to flush any frames produced during the fetch handler.
			flushPending(ws);
		});
	};

	httpServer.on("upgrade", upgradeListener);

	/**
	 * Chain a dispatch after the last one for this connection so handlers
	 * observe messages (and the final close) in arrival order.
	 */
	function enqueue(id: string, task: () => Promise<void>): void {
		const prev = dispatchChains.get(id) ?? Promise.resolve();
		const next = prev
			.then(task)
			.catch((err) =>
				logger.error("WebSocket dispatch failed: {error}", {error: err}),
			);
		dispatchChains.set(id, next);
	}

	return async () => {
		httpServer.off("upgrade", upgradeListener);
		// Close any still-open connections gracefully.
		for (const {ws} of connections.values()) {
			try {
				ws.close(1001, "Server shutting down");
			} catch {
				/* best-effort */
			}
		}
		// Wait for pending dispatch chains to drain.
		await Promise.allSettled([...dispatchChains.values()]);
	};
}

/**
 * Pool-mode WS handler: supervisor owns the real socket; workers own the
 * runtime `ShovelWebSocketConnection`. Inbound frames are forwarded into
 * the pool, outbound frames arrive via the pool's `sendFrame` callback.
 */
export function attachNodePoolWebSocketHandler(
	httpServer: HTTP.Server,
	pool: {
		handleUpgradeRequest?: (
			request: Request,
		) => Promise<Response | {upgrade: true; connectionID: string}>;
		setWebSocketHandlers?: (h: {
			sendFrame: (id: string, data: string | ArrayBuffer) => void;
			closeConnection: (id: string, code?: number, reason?: string) => void;
		}) => void;
		sendWebSocketMessage?: (id: string, data: string | ArrayBuffer) => void;
		sendWebSocketClose?: (
			id: string,
			code: number,
			reason: string,
			wasClean: boolean,
		) => void;
	},
): () => Promise<void> {
	if (typeof pool.handleUpgradeRequest !== "function") {
		// Pool without upgrade support — install a no-op so we don't cause
		// uncaught errors on spurious upgrade requests.
		const noop = () => {};
		httpServer.on("upgrade", noop);
		return async () => {
			httpServer.off("upgrade", noop);
		};
	}
	let wsServerPromise: Promise<{WebSocketServer: any}> | null = null;
	const loadWs = () => {
		if (!wsServerPromise) wsServerPromise = import("ws");
		return wsServerPromise;
	};

	// connectionID → live ws socket
	const liveSockets = new Map<string, any>();
	// connectionID → frames queued before the physical socket is live
	const pendingFrames = new Map<string, PendingFrame[]>();

	pool.setWebSocketHandlers?.({
		sendFrame(connectionID, data) {
			const ws = liveSockets.get(connectionID);
			if (ws) {
				ws.send(data);
			} else {
				// Frames generated during the worker's fetch handler can arrive
				// before the supervisor completes the physical handshake —
				// buffer them until the socket is live.
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

	const upgradeListener = async (
		req: HTTP.IncomingMessage,
		socket: Socket,
		head: Buffer,
	) => {
		const url = `http://${req.headers.host}${req.url}`;
		const hasBody = req.method !== "GET" && req.method !== "HEAD";
		const request = new Request(url, {
			method: req.method,
			headers: req.headers as HeadersInit,
			body: hasBody ? (req as any) : undefined,
			duplex: hasBody ? "half" : undefined,
		} as RequestInit);

		let result: any;
		try {
			result = await pool.handleUpgradeRequest!(request);
		} catch (err) {
			logger.error("Pool.handleRequest threw during upgrade: {error}", {
				error: err,
			});
			writeErrorAndDestroy(socket, 500, "Internal Server Error");
			return;
		}

		if (result && typeof result === "object" && result.upgrade === true) {
			const connectionID = result.connectionID as string;
			try {
				const wsModule = await loadWs();
				const wss = new wsModule.WebSocketServer({noServer: true});
				wss.handleUpgrade(req, socket, head, (ws: any) => {
					liveSockets.set(connectionID, ws);
					// Attach inbound listeners BEFORE flushing buffered frames.
					ws.on("message", (data: Buffer, isBinary: boolean) => {
						const payload = isBinary
							? bufferToArrayBuffer(data)
							: data.toString("utf8");
						pool.sendWebSocketMessage?.(connectionID, payload);
					});
					ws.on("close", (code: number, reason: Buffer) => {
						liveSockets.delete(connectionID);
						pool.sendWebSocketClose?.(
							connectionID,
							code,
							reason.toString("utf8"),
							code === 1000 || code === 1001,
						);
					});
					ws.on("error", (err: Error) => {
						logger.error("Pool WebSocket error: {error}", {error: err});
					});
					// Flush any frames queued by the worker before the socket
					// became live (conn.send() during the fetch handler).
					const queued = pendingFrames.get(connectionID);
					if (queued) {
						pendingFrames.delete(connectionID);
						for (const frame of queued) {
							if (frame.type === "send") ws.send(frame.data);
							else ws.close(frame.code ?? 1000, frame.reason ?? "");
						}
					}
				});
			} catch (err) {
				logger.error("Failed to complete pool WS handshake: {error}", {
					error: err,
				});
				writeErrorAndDestroy(socket, 500, "WebSocket support unavailable");
			}
			return;
		}

		if (result instanceof Response) {
			writeResponseAndDestroy(socket, result);
		} else {
			writeErrorAndDestroy(socket, 426, "Upgrade Required");
		}
	};

	httpServer.on("upgrade", upgradeListener);

	return async () => {
		httpServer.off("upgrade", upgradeListener);
		for (const ws of liveSockets.values()) {
			try {
				ws.close(1001, "Server shutting down");
			} catch {
				/* best-effort */
			}
		}
	};
}

function bufferToArrayBuffer(buf: Buffer): ArrayBuffer {
	// Return a fresh ArrayBuffer view over the Buffer's bytes (Buffer shares
	// memory with its underlying Uint8Array, which we must not leak).
	return buf.buffer.slice(
		buf.byteOffset,
		buf.byteOffset + buf.byteLength,
	) as ArrayBuffer;
}

function writeResponseAndDestroy(socket: Socket, response: Response): void {
	// Cribbed from Node's internal HTTP response formatting. We can't use
	// http.ServerResponse here because the socket is already hijacked for
	// upgrade.
	response
		.text()
		.then((body) => {
			const status = response.status;
			const statusText = response.statusText || httpStatusText(status);
			const headerLines: string[] = [
				`HTTP/1.1 ${status} ${statusText}`,
				`Content-Length: ${Buffer.byteLength(body, "utf8")}`,
				"Connection: close",
			];
			response.headers.forEach((value, key) => {
				headerLines.push(`${key}: ${value}`);
			});
			socket.write(headerLines.join("\r\n") + "\r\n\r\n" + body);
			socket.destroy();
		})
		.catch(() => socket.destroy());
}

function writeErrorAndDestroy(
	socket: Socket,
	status: number,
	message: string,
): void {
	const statusText = httpStatusText(status);
	const body = message;
	socket.write(
		`HTTP/1.1 ${status} ${statusText}\r\nContent-Length: ${Buffer.byteLength(body, "utf8")}\r\nConnection: close\r\n\r\n${body}`,
	);
	socket.destroy();
}

function httpStatusText(status: number): string {
	switch (status) {
		case 200:
			return "OK";
		case 400:
			return "Bad Request";
		case 403:
			return "Forbidden";
		case 404:
			return "Not Found";
		case 426:
			return "Upgrade Required";
		case 500:
			return "Internal Server Error";
		default:
			return "";
	}
}
