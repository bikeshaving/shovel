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
	errorToResponse,
	toArrayBuffer,
	createOrderedDispatch,
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
	const connections = new Map<
		string,
		{conn: ShovelWebSocketConnection; ws: any}
	>();

	// Per-connection dispatch queues so messages are delivered in order.
	const {
		enqueue,
		release: releaseDispatch,
		drain: drainDispatch,
	} = createOrderedDispatch();

	const upgradeListener = async (
		req: HTTP.IncomingMessage,
		socket: Socket,
		head: Buffer,
	) => {
		// A hijacked socket has NO error listener until ws's handleUpgrade
		// attaches one — Node's HTTP server removes its own when upgrade
		// listeners exist. A client RST during the handler's awaits would
		// otherwise be an uncaughtException: remote, unauthenticated process
		// kill. Errors here are connection-fatal but never process-fatal.
		socket.on("error", (err: Error) => {
			logger.debug("Upgrade socket error: {error}", {error: err});
		});
		// Request construction can throw on hostile-but-parseable headers
		// (llhttp admits "Host: a b"; the WHATWG URL parser does not). The
		// listener is async and Node discards its promise, so an uncaught
		// throw here is an unhandled rejection (process-fatal by default)
		// AND a leaked hijacked socket.
		let request: Request;
		try {
			const url = `http://${req.headers.host}${req.url}`;
			const hasBody = req.method !== "GET" && req.method !== "HEAD";
			request = new Request(url, {
				method: req.method,
				headers: req.headers as HeadersInit,
				body: hasBody ? (req as any) : undefined,
				duplex: hasBody ? "half" : undefined,
			} as RequestInit);
		} catch (_err) {
			writeErrorAndDestroy(socket, 400, "Bad Request");
			return;
		}

		// Frames the user's fetch handler emits BEFORE the real ws exists
		// (e.g. conn.send("welcome") inside upgradeWebSocket handler).
		const pending: PendingFrame[] = [];
		let realWs: any = null;
		let upgradedConnectionId: string | null = null;
		// Track socket death from listener entry: a client that aborts during
		// a slow handler (before our later once("close") guard exists) must
		// not leave the accepted connection's subscriptions leaking with an
		// unbounded pending buffer.
		let socketClosed = false;
		socket.once("close", () => {
			socketClosed = true;
		});

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
		// Tracked separately from `connections` so we can call
		// `_releaseSubscriptions()` on a phantom upgrade. Typed as
		// `unknown` so TypeScript doesn't narrow it to `never` after the
		// always-null initializer.
		let upgradedConn: ShovelWebSocketConnection | null =
			null as unknown as ShovelWebSocketConnection | null;

		try {
			const result = await dispatchFetchEvent(registration, request, {
				wsRelay: relay,
				onUpgrade(conn) {
					upgradedConnectionId = conn.id;
					upgradedConn = conn;
				},
			});
			event = result.event;
			response = result.response;
		} catch (err) {
			// Phantom-client cleanup: if the handler called upgradeWebSocket()
			// and then threw, drop the connection AND release its BC
			// subscriptions so we don't leak channel listeners attached to a
			// socket that will never exist.
			if (upgradedConnectionId) {
				connections.delete(upgradedConnectionId);
				releaseDispatch(upgradedConnectionId);
				upgradedConn?._releaseSubscriptions();
			}
			// Preserve HTTPError statuses from auth/validation rejections —
			// matches the regular HTTP path. A bare 500 here would mask
			// 401/403/etc that the user code intentionally threw.
			writeResponseAndDestroy(socket, errorToResponse(err));
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
			releaseDispatch(conn.id);
			conn._releaseSubscriptions();
			return;
		}

		const wss = new wsModule.WebSocketServer({noServer: true});
		// Carry any Set-Cookie values the handler added via cookieStore onto
		// the 101 handshake. `ws` exposes a "headers" event for adding raw
		// HTTP header lines before it writes the response.
		if (event!.cookieStore.hasChanges()) {
			const setCookies = event!.cookieStore.getSetCookieHeaders();
			wss.on("headers", (headers: string[]) => {
				for (const sc of setCookies) {
					if (!isHeaderSafe(sc)) {
						logger.warn("Dropping Set-Cookie with CR/LF on upgrade");
						continue;
					}
					headers.push(`Set-Cookie: ${sc}`);
				}
			});
		}
		// handleUpgrade destroys the socket without invoking the callback when
		// the client aborts mid-handshake — release the connection's resources
		// on socket close if the callback never ran, or its BC subscriptions
		// (and buffered frames) leak forever.
		if (socketClosed || socket.destroyed) {
			// Client aborted during dispatch/module load: handleUpgrade would
			// destroy the socket without invoking its callback, and our close
			// guard below would never have been attached.
			conn._releaseSubscriptions();
			releaseDispatch(conn.id);
			return;
		}
		let upgraded = false;
		socket.once("close", () => {
			if (!upgraded) {
				conn._releaseSubscriptions();
				releaseDispatch(conn.id);
			}
		});
		wss.handleUpgrade(req, socket, head, (ws: any) => {
			upgraded = true;
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
				const payload = isBinary ? toArrayBuffer(data) : data.toString("utf8");
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
							// 1006 ("abnormal closure") is the only code RFC 6455
							// defines for a missing/incomplete close handshake;
							// every other code — including app-defined 4000-4999
							// — implies a close frame was exchanged cleanly.
							code !== 1006,
						);
					} finally {
						connections.delete(conn.id);
						releaseDispatch(conn.id);
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

	return async () => {
		httpServer.off("upgrade", upgradeListener);
		// Close any still-open connections gracefully, and WAIT (bounded) for
		// their close events: the websocketclose dispatch is enqueued from the
		// ws "close" callback, which fires after the closing handshake — an
		// immediate drain would run before those tasks exist, and user close
		// handlers (presence removal, DB writes) would race server/database
		// shutdown.
		const closePromises: Promise<void>[] = [];
		for (const {ws} of connections.values()) {
			try {
				closePromises.push(
					new Promise<void>((resolve) => {
						ws.once("close", resolve);
						setTimeout(resolve, 2000);
					}),
				);
				ws.close(1001, "Server shutting down");
			} catch (_err) {
				/* best-effort */
			}
		}
		await Promise.allSettled(closePromises);
		// Terminate anything still open: a client that never answers the
		// close frame would otherwise hold its hijacked socket (and
		// httpServer.close()) hostage for ws's internal 30s timeout.
		for (const {ws} of connections.values()) {
			try {
				ws.terminate();
			} catch (_err) {
				/* best-effort */
			}
		}
		// Now the close dispatches are enqueued; drain them.
		await drainDispatch();
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
		// Pool without upgrade support: refuse the upgrade and destroy the
		// socket. (Node with NO upgrade listener destroys hijacked sockets
		// itself; a listener that does nothing would hold every spurious
		// Upgrade request open forever — an unauthenticated FD-exhaustion
		// vector.)
		const refuse = (_req: HTTP.IncomingMessage, socket: Socket) => {
			writeErrorAndDestroy(socket, 426, "WebSocket upgrades not supported");
		};
		httpServer.on("upgrade", refuse);
		return async () => {
			httpServer.off("upgrade", refuse);
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

	pool.setWebSocketHandlers?.({
		sendFrame(connectionID, data) {
			const ws = liveSockets.get(connectionID);
			if (ws) {
				ws.send(data);
			} else {
				// Frames generated during the worker's fetch handler can arrive
				// before the supervisor completes the physical handshake —
				// buffer them until the socket is live.
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

	const upgradeListener = async (
		req: HTTP.IncomingMessage,
		socket: Socket,
		head: Buffer,
	) => {
		// A hijacked socket has NO error listener until ws's handleUpgrade
		// attaches one — Node's HTTP server removes its own when upgrade
		// listeners exist. A client RST during the handler's awaits would
		// otherwise be an uncaughtException: remote, unauthenticated process
		// kill. Errors here are connection-fatal but never process-fatal.
		socket.on("error", (err: Error) => {
			logger.debug("Upgrade socket error: {error}", {error: err});
		});
		// Request construction can throw on hostile-but-parseable headers
		// (llhttp admits "Host: a b"; the WHATWG URL parser does not). The
		// listener is async and Node discards its promise, so an uncaught
		// throw here is an unhandled rejection (process-fatal by default)
		// AND a leaked hijacked socket.
		let request: Request;
		try {
			const url = `http://${req.headers.host}${req.url}`;
			const hasBody = req.method !== "GET" && req.method !== "HEAD";
			request = new Request(url, {
				method: req.method,
				headers: req.headers as HeadersInit,
				body: hasBody ? (req as any) : undefined,
				duplex: hasBody ? "half" : undefined,
			} as RequestInit);
		} catch (_err) {
			writeErrorAndDestroy(socket, 400, "Bad Request");
			return;
		}

		// Track socket death from listener entry (see the direct-mode note).
		let socketClosed = false;
		socket.once("close", () => {
			socketClosed = true;
		});

		let result: any;
		try {
			result = await pool.handleUpgradeRequest!(request);
		} catch (err) {
			writeResponseAndDestroy(socket, errorToResponse(err));
			return;
		}

		if (result && typeof result === "object" && result.upgrade === true) {
			const connectionID = result.connectionID as string;
			const setCookieHeaders = result.setCookieHeaders as string[] | undefined;
			try {
				const wsModule = await loadWs();
				if (socketClosed || socket.destroyed) {
					// Client aborted while the worker was accepting: synthesize
					// the close now — the once("close") guard below would never
					// fire for an already-dead socket.
					pendingFrames.delete(connectionID);
					pendingFrameBirth.delete(connectionID);
					pool.sendWebSocketClose?.(
						connectionID,
						1006,
						"handshake aborted",
						false,
					);
					return;
				}
				const wss = new wsModule.WebSocketServer({noServer: true});
				if (setCookieHeaders?.length) {
					wss.on("headers", (headers: string[]) => {
						for (const sc of setCookieHeaders) {
							if (!isHeaderSafe(sc)) {
								logger.warn("Dropping Set-Cookie with CR/LF on upgrade");
								continue;
							}
							headers.push(`Set-Cookie: ${sc}`);
						}
					});
				}
				// Mirror the direct-mode guard: handleUpgrade destroys the socket
				// without invoking the callback on a client abort or malformed
				// handshake. The worker already registered the connection —
				// synthesize a close so it releases subscriptions, and drop any
				// buffered frames.
				let upgraded = false;
				socket.once("close", () => {
					if (!upgraded) {
						pendingFrames.delete(connectionID);
						pendingFrameBirth.delete(connectionID);
						pool.sendWebSocketClose?.(
							connectionID,
							1006,
							"handshake aborted",
							false,
						);
					}
				});
				wss.handleUpgrade(req, socket, head, (ws: any) => {
					upgraded = true;
					liveSockets.set(connectionID, ws);
					// Attach inbound listeners BEFORE flushing buffered frames.
					ws.on("message", (data: Buffer, isBinary: boolean) => {
						const payload = isBinary
							? toArrayBuffer(data)
							: data.toString("utf8");
						pool.sendWebSocketMessage?.(connectionID, payload);
					});
					ws.on("close", (code: number, reason: Buffer) => {
						liveSockets.delete(connectionID);
						pendingFrames.delete(connectionID);
						pendingFrameBirth.delete(connectionID);
						pool.sendWebSocketClose?.(
							connectionID,
							code,
							reason.toString("utf8"),
							// `code !== 1006` — see direct-mode close handler
							// above for rationale.
							code !== 1006,
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
						pendingFrameBirth.delete(connectionID);
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
				// The worker has already accepted the upgrade and may hold BC
				// subscriptions on its ShovelWebSocketConnection. Synthesize a
				// close back through the pool so the worker drops the connection
				// — otherwise it leaks as a phantom holding live subscriptions.
				pool.sendWebSocketClose?.(
					connectionID,
					1011,
					"WebSocket handshake failed",
					false,
				);
				// The handshake callback that flushes+clears these never ran, so
				// drop any frames the worker buffered before the socket went live.
				pendingFrames.delete(connectionID);
				pendingFrameBirth.delete(connectionID);
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
		const closePromises: Promise<void>[] = [];
		for (const ws of liveSockets.values()) {
			try {
				closePromises.push(
					new Promise<void>((resolve) => {
						ws.once("close", resolve);
						setTimeout(resolve, 2000);
					}),
				);
				ws.close(1001, "Server shutting down");
			} catch (_err) {
				/* best-effort */
			}
		}
		// Bounded wait so sendWebSocketClose round-trips reach the workers,
		// then terminate stragglers — a client that never answers the close
		// frame would hold httpServer.close() hostage for ws's 30s timeout.
		await Promise.allSettled(closePromises);
		for (const ws of liveSockets.values()) {
			try {
				ws.terminate();
			} catch (_err) {
				/* best-effort */
			}
		}
	};
}

/**
 * Raw 101-handshake headers bypass Headers validation, so header values must
 * be screened for CR/LF ourselves — an untrusted cookie path/domain reaching
 * serializeCookie verbatim would otherwise inject arbitrary response headers.
 */
function isHeaderSafe(value: string): boolean {
	return !/[\r\n]/.test(value);
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
				// We computed our own framing from the decoded text() body: a
				// proxied response's original content-length/encoding would
				// conflict with it (two Content-Length headers, or an encoding
				// header for a body that is no longer encoded). Set-Cookie is
				// handled below: Headers.forEach comma-joins repeated values,
				// which corrupts cookies (including any Expires date).
				const lower = key.toLowerCase();
				if (
					lower === "content-length" ||
					lower === "content-encoding" ||
					lower === "transfer-encoding" ||
					lower === "connection" ||
					lower === "set-cookie"
				) {
					return;
				}
				headerLines.push(`${key}: ${value}`);
			});
			for (const sc of response.headers.getSetCookie()) {
				if (!isHeaderSafe(sc)) continue;
				headerLines.push(`Set-Cookie: ${sc}`);
			}
			// Use `socket.end(...)` rather than write+destroy so the bytes
			// are flushed to the client before the FIN; an immediate
			// `destroy()` after `write()` can race the kernel buffer and
			// surface as ECONNRESET on fast clients.
			socket.end(headerLines.join("\r\n") + "\r\n\r\n" + body);
		})
		.catch(() => socket.destroy());
}

function writeErrorAndDestroy(
	socket: Socket,
	status: number,
	message: string,
): void {
	// One HTTP/1.1 formatter: delegate so the framing (and its
	// flush-before-FIN behavior) has a single implementation.
	writeResponseAndDestroy(
		socket,
		new Response(message, {
			status,
			statusText: httpStatusText(status),
		}),
	);
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
