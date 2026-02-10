/**
 * WebSocket Bridge — connects ShovelWebSocket to platform-native WebSockets
 *
 * Platform adapters (Node, Bun, Cloudflare) use this to bridge the
 * ShovelWebSocket from dispatchRequest() to the real network socket.
 */

import type {ShovelWebSocket} from "./websocket.js";

/**
 * WebSocket bridge for worker-mode relay.
 * Platform adapters use this to bridge the real network socket to the worker.
 */
export interface WebSocketBridge {
	/** Connect the real socket. Provide send/close callbacks for outgoing data. */
	connect(
		send: (data: string | ArrayBuffer) => void,
		close: (code?: number, reason?: string) => void,
	): void;
	/** Deliver incoming data from the real socket to the worker. */
	deliver(data: string | ArrayBuffer): void;
	/** Deliver a close event from the real socket to the worker. */
	deliverClose(code: number, reason: string): void;
}

/**
 * Result of handling a request. Either an HTTP response or a WebSocket upgrade.
 */
export type HandleResult =
	| {response: Response; webSocket?: undefined}
	| {response?: undefined; webSocket: WebSocketBridge};

/**
 * Create a WebSocketBridge from a ShovelWebSocket (direct mode).
 *
 * In direct mode, the ShovelWebSocket's peer delivery handles the bridge:
 * - clientSocket.send(data) delivers to the server socket (peer)
 * - server.send(data) delivers to clientSocket, triggering our message listener
 *
 * Accepts and attaches listeners immediately so that early server messages
 * (e.g. a "welcome" send before the platform adapter calls connect()) are
 * buffered and flushed once the real socket callbacks are available.
 */
export function createWebSocketBridge(
	clientSocket: ShovelWebSocket,
): WebSocketBridge {
	let sendFn: ((data: string | ArrayBuffer) => void) | null = null;
	let closeFn: ((code?: number, reason?: string) => void) | null = null;
	const pending: Array<
		| {type: "message"; data: string | ArrayBuffer}
		| {type: "close"; code: number; reason: string}
	> = [];

	// Accept immediately so peer delivery works before connect()
	clientSocket.accept();

	// Buffer messages until connect() provides real callbacks
	clientSocket.addEventListener("message", ((ev: MessageEvent) => {
		if (sendFn) {
			sendFn(ev.data);
		} else {
			pending.push({type: "message", data: ev.data});
		}
	}) as EventListener);

	clientSocket.addEventListener("close", ((ev: CloseEvent) => {
		if (closeFn) {
			closeFn(ev.code, ev.reason);
		} else {
			pending.push({type: "close", code: ev.code, reason: ev.reason});
		}
	}) as EventListener);

	return {
		connect(send, close) {
			sendFn = send;
			closeFn = close;
			// Flush buffered messages
			for (const msg of pending) {
				if (msg.type === "message") {
					send(msg.data);
				} else {
					close(msg.code, msg.reason);
				}
			}
			pending.length = 0;
		},
		deliver(data) {
			// Real socket received data → forward to server via client.send()
			clientSocket.send(data);
		},
		deliverClose(code, reason) {
			clientSocket.close(code, reason);
		},
	};
}
