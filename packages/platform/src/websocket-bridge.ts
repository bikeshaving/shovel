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
 */
export function createWebSocketBridge(
	clientSocket: ShovelWebSocket,
): WebSocketBridge {
	return {
		connect(send, close) {
			clientSocket.accept();

			// Server.send() → client receives → forward to real socket
			clientSocket.addEventListener("message", ((ev: MessageEvent) => {
				send(ev.data);
			}) as EventListener);

			clientSocket.addEventListener("close", ((ev: CloseEvent) => {
				close(ev.code, ev.reason);
			}) as EventListener);
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
