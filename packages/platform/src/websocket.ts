/**
 * WebSocketPair - Cloudflare Workers-compatible WebSocket API
 * https://developers.cloudflare.com/workers/runtime-apis/websockets/
 *
 * Provides in-process linked WebSocket pairs for the fetch handler model.
 * The worker creates a WebSocketPair, passes the client socket (index 0) via
 * event.upgradeWebSocket(), and keeps the server socket (index 1) for
 * bidirectional messaging.
 */

// CloseEvent polyfill for Node.js < 23
const _CloseEvent: typeof CloseEvent =
	typeof CloseEvent !== "undefined"
		? CloseEvent
		: (class CloseEvent extends Event {
				readonly code: number;
				readonly reason: string;
				readonly wasClean: boolean;
				constructor(type: string, init: CloseEventInit = {}) {
					super(type);
					this.code = init.code ?? 0;
					this.reason = init.reason ?? "";
					this.wasClean = init.wasClean ?? false;
				}
			} as typeof globalThis.CloseEvent);

export class ShovelWebSocket extends EventTarget {
	static readonly CONNECTING: number;
	static readonly OPEN: number;
	static readonly CLOSING: number;
	static readonly CLOSED: number;
	static {
		(this as any).CONNECTING = 0;
		(this as any).OPEN = 1;
		(this as any).CLOSING = 2;
		(this as any).CLOSED = 3;
	}

	readonly CONNECTING: number;
	readonly OPEN: number;
	readonly CLOSING: number;
	readonly CLOSED: number;

	#readyState: number;
	#peer: ShovelWebSocket | null;
	#accepted: boolean;
	#relay: {
		send: (data: string | ArrayBuffer | ArrayBufferView) => void;
		close: (code?: number, reason?: string) => void;
	} | null;

	// Event handler properties (Web API compat)
	onopen: ((ev: Event) => any) | null;
	onmessage: ((ev: MessageEvent) => any) | null;
	onclose: ((ev: CloseEvent) => any) | null;
	onerror: ((ev: Event) => any) | null;

	constructor() {
		super();
		this.CONNECTING = 0;
		this.OPEN = 1;
		this.CLOSING = 2;
		this.CLOSED = 3;
		this.#readyState = ShovelWebSocket.CONNECTING;
		this.#peer = null;
		this.#accepted = false;
		this.#relay = null;
		this.onopen = null;
		this.onmessage = null;
		this.onclose = null;
		this.onerror = null;
	}

	get readyState(): number {
		return this.#readyState;
	}

	get accepted(): boolean {
		return this.#accepted;
	}

	/**
	 * CF Workers API: must call accept() before send/addEventListener on server socket.
	 * Transitions from CONNECTING to OPEN.
	 */
	accept(): void {
		if (this.#accepted) return;
		this.#accepted = true;
		this.#readyState = ShovelWebSocket.OPEN;
	}

	/**
	 * Send data to the peer socket.
	 */
	send(data: string | ArrayBuffer | ArrayBufferView): void {
		if (!this.#accepted) {
			throw new Error(
				"You must call accept() on a WebSocket before sending messages",
			);
		}
		if (this.#readyState !== ShovelWebSocket.OPEN) {
			throw new DOMException("WebSocket is not open", "InvalidStateError");
		}

		// If relay is set, forward through relay (worker-thread mode)
		if (this.#relay) {
			this.#relay.send(data);
			return;
		}

		// In-process: deliver to peer
		const peer = this.#peer;
		if (peer && peer.#readyState === ShovelWebSocket.OPEN) {
			queueMicrotask(() => {
				const event = new MessageEvent("message", {data});
				peer.dispatchEvent(event);
				peer.onmessage?.call(peer, event);
			});
		}
	}

	/**
	 * Close the WebSocket connection.
	 */
	close(code?: number, reason?: string): void {
		if (this.#readyState >= ShovelWebSocket.CLOSING) return;
		this.#readyState = ShovelWebSocket.CLOSING;

		// If relay is set, forward through relay
		if (this.#relay) {
			this.#relay.close(code, reason);
		}

		const peer = this.#peer;
		queueMicrotask(() => {
			this.#readyState = ShovelWebSocket.CLOSED;
			const closeEvent = new _CloseEvent("close", {
				code: code ?? 1000,
				reason: reason ?? "",
				wasClean: true,
			});
			this.dispatchEvent(closeEvent);
			this.onclose?.call(this, closeEvent);

			if (peer && peer.#readyState < ShovelWebSocket.CLOSING) {
				peer.#readyState = ShovelWebSocket.CLOSED;
				const peerCloseEvent = new _CloseEvent("close", {
					code: code ?? 1000,
					reason: reason ?? "",
					wasClean: true,
				});
				peer.dispatchEvent(peerCloseEvent);
				peer.onclose?.call(peer, peerCloseEvent);
			}
		});
	}

	/**
	 * Internal: link two sockets together as peers.
	 */
	static _link(a: ShovelWebSocket, b: ShovelWebSocket): void {
		a.#peer = b;
		b.#peer = a;
	}

	/**
	 * Internal: set relay for worker-thread mode.
	 * When set, send() and close() forward through the relay instead of the peer.
	 */
	_setRelay(relay: {
		send: (data: string | ArrayBuffer | ArrayBufferView) => void;
		close: (code?: number, reason?: string) => void;
	}): void {
		this.#relay = relay;
	}

	/**
	 * Internal: deliver a message from the relay (network/main thread).
	 * Dispatches a message event as if the peer sent it.
	 */
	_deliver(data: string | ArrayBuffer): void {
		if (this.#readyState !== ShovelWebSocket.OPEN) return;
		const event = new MessageEvent("message", {data});
		this.dispatchEvent(event);
		this.onmessage?.call(this, event);
	}

	/**
	 * Internal: deliver a close event from the relay.
	 */
	_deliverClose(code?: number, reason?: string): void {
		if (this.#readyState >= ShovelWebSocket.CLOSING) return;
		this.#readyState = ShovelWebSocket.CLOSED;
		const closeEvent = new _CloseEvent("close", {
			code: code ?? 1000,
			reason: reason ?? "",
			wasClean: true,
		});
		this.dispatchEvent(closeEvent);
		this.onclose?.call(this, closeEvent);
	}
}

/**
 * WebSocketPair creates two linked WebSocket objects.
 * Index 0 is the "client" (passed to event.upgradeWebSocket()).
 * Index 1 is the "server" (kept by user code).
 */
export class WebSocketPair {
	0: ShovelWebSocket;
	1: ShovelWebSocket;

	constructor() {
		this[0] = new ShovelWebSocket();
		this[1] = new ShovelWebSocket();
		ShovelWebSocket._link(this[0], this[1]);
	}
}
