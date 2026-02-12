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
 * The bridge socket is the one passed to event.upgradeWebSocket(). Its peer
 * stays in user code. Messages sent by the peer are delivered to the bridge
 * socket, which forwards them to the real network connection via callbacks.
 *
 * Accepts and attaches listeners immediately so that early messages
 * (e.g. a "welcome" send before the platform adapter calls connect()) are
 * buffered and flushed once the real socket callbacks are available.
 */
export function createWebSocketBridge(
	socket: ShovelWebSocket,
): WebSocketBridge {
	let sendFn: ((data: string | ArrayBuffer) => void) | null = null;
	let closeFn: ((code?: number, reason?: string) => void) | null = null;
	const pending: Array<
		| {type: "message"; data: string | ArrayBuffer}
		| {type: "close"; code: number; reason: string}
	> = [];

	// Accept immediately so peer delivery works before connect()
	socket.accept();

	// Buffer messages until connect() provides real callbacks
	socket.addEventListener("message", ((ev: MessageEvent) => {
		if (sendFn) {
			sendFn(ev.data);
		} else {
			pending.push({type: "message", data: ev.data});
		}
	}) as EventListener);

	socket.addEventListener("close", ((ev: CloseEvent) => {
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
			// Real socket received data → forward to peer via bridge socket
			socket.send(data);
		},
		deliverClose(code, reason) {
			socket.close(code, reason);
		},
	};
}
