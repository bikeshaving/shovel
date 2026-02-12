/**
 * WebSocketPair Tests
 */

import {describe, it, expect} from "bun:test";
import {ShovelWebSocket, WebSocketPair} from "../src/websocket.js";
import {ShovelFetchEvent} from "../src/runtime.js";

describe("WebSocketPair", () => {
	it("creates two linked sockets at indices 0 and 1", () => {
		const pair = new WebSocketPair();
		expect(pair[0]).toBeInstanceOf(ShovelWebSocket);
		expect(pair[1]).toBeInstanceOf(ShovelWebSocket);
		expect(pair[0]).not.toBe(pair[1]);
	});

	it("sockets start in CONNECTING state", () => {
		const pair = new WebSocketPair();
		expect(pair[0].readyState).toBe(ShovelWebSocket.CONNECTING);
		expect(pair[1].readyState).toBe(ShovelWebSocket.CONNECTING);
	});
});

describe("ShovelWebSocket", () => {
	it("has static readyState constants", () => {
		expect(ShovelWebSocket.CONNECTING).toBe(0);
		expect(ShovelWebSocket.OPEN).toBe(1);
		expect(ShovelWebSocket.CLOSING).toBe(2);
		expect(ShovelWebSocket.CLOSED).toBe(3);
	});

	it("has instance readyState constants", () => {
		const pair = new WebSocketPair();
		expect(pair[0].CONNECTING).toBe(0);
		expect(pair[0].OPEN).toBe(1);
		expect(pair[0].CLOSING).toBe(2);
		expect(pair[0].CLOSED).toBe(3);
	});

	it("accept() transitions to OPEN", () => {
		const pair = new WebSocketPair();
		const server = pair[1];

		expect(server.readyState).toBe(ShovelWebSocket.CONNECTING);
		server.accept();
		expect(server.readyState).toBe(ShovelWebSocket.OPEN);
	});

	it("accept() is idempotent", () => {
		const pair = new WebSocketPair();
		const server = pair[1];
		server.accept();
		server.accept(); // no error
		expect(server.readyState).toBe(ShovelWebSocket.OPEN);
	});

	it("send() throws before accept()", () => {
		const pair = new WebSocketPair();
		expect(() => pair[1].send("hello")).toThrow("accept()");
	});

	it("send() delivers message to peer", async () => {
		const pair = new WebSocketPair();
		const client = pair[0];
		const server = pair[1];

		client.accept();
		server.accept();

		const received = new Promise<MessageEvent>((resolve) => {
			client.addEventListener("message", (ev) => resolve(ev as MessageEvent));
		});

		server.send("hello from server");

		const event = await received;
		expect(event.data).toBe("hello from server");
	});

	it("bidirectional messaging works", async () => {
		const pair = new WebSocketPair();
		const client = pair[0];
		const server = pair[1];

		client.accept();
		server.accept();

		// Server -> Client
		const clientReceived = new Promise<string>((resolve) => {
			client.addEventListener("message", (ev) =>
				resolve((ev as MessageEvent).data),
			);
		});
		server.send("s2c");
		expect(await clientReceived).toBe("s2c");

		// Client -> Server
		const serverReceived = new Promise<string>((resolve) => {
			server.addEventListener("message", (ev) =>
				resolve((ev as MessageEvent).data),
			);
		});
		client.send("c2s");
		expect(await serverReceived).toBe("c2s");
	});

	it("send() throws when not OPEN", async () => {
		const pair = new WebSocketPair();
		const server = pair[1];
		server.accept();
		server.close();

		// Wait for close to complete
		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(() => server.send("fail")).toThrow("WebSocket is not open");
	});

	it("close() dispatches close event on both sides", async () => {
		const pair = new WebSocketPair();
		const client = pair[0];
		const server = pair[1];

		client.accept();
		server.accept();

		const events: CloseEvent[] = [];
		const allClosed = Promise.all([
			new Promise<void>((resolve) => {
				client.addEventListener("close", (ev) => {
					events.push(ev as CloseEvent);
					resolve();
				});
			}),
			new Promise<void>((resolve) => {
				server.addEventListener("close", (ev) => {
					events.push(ev as CloseEvent);
					resolve();
				});
			}),
		]);

		server.close(1000, "normal");
		await allClosed;

		expect(events.length).toBe(2);
		for (const ev of events) {
			expect(ev.code).toBe(1000);
			expect(ev.reason).toBe("normal");
			expect(ev.wasClean).toBe(true);
		}
	});

	it("close() transitions readyState through CLOSING to CLOSED", async () => {
		const pair = new WebSocketPair();
		const server = pair[1];
		server.accept();

		expect(server.readyState).toBe(ShovelWebSocket.OPEN);
		server.close();
		expect(server.readyState).toBe(ShovelWebSocket.CLOSING);

		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(server.readyState).toBe(ShovelWebSocket.CLOSED);
	});

	it("close() defaults to code 1000", async () => {
		const pair = new WebSocketPair();
		const server = pair[1];
		server.accept();

		const closeEvent = new Promise<CloseEvent>((resolve) => {
			server.addEventListener("close", (ev) => resolve(ev as CloseEvent));
		});

		server.close();
		const ev = await closeEvent;
		expect(ev.code).toBe(1000);
		expect(ev.reason).toBe("");
	});

	it("double close() is a no-op", () => {
		const pair = new WebSocketPair();
		const server = pair[1];
		server.accept();
		server.close();
		server.close(); // should not throw
	});

	it("onmessage handler works", async () => {
		const pair = new WebSocketPair();
		const client = pair[0];
		const server = pair[1];

		client.accept();
		server.accept();

		const received = new Promise<string>((resolve) => {
			client.onmessage = (ev) => resolve(ev.data);
		});

		server.send("via handler");
		expect(await received).toBe("via handler");
	});

	it("can send ArrayBuffer data", async () => {
		const pair = new WebSocketPair();
		const client = pair[0];
		const server = pair[1];

		client.accept();
		server.accept();

		const received = new Promise<ArrayBuffer>((resolve) => {
			client.addEventListener("message", (ev) =>
				resolve((ev as MessageEvent).data),
			);
		});

		const data = new Uint8Array([1, 2, 3, 4]).buffer;
		server.send(data);

		const result = await received;
		expect(new Uint8Array(result)).toEqual(new Uint8Array([1, 2, 3, 4]));
	});

	it("upgradeWebSocket stores socket on event", () => {
		const pair = new WebSocketPair();
		const request = new Request("http://localhost/ws", {
			headers: {Upgrade: "websocket"},
		});
		const event = new ShovelFetchEvent(request);
		event.upgradeWebSocket(pair[0]);
		expect(event.getUpgradeWebSocket()).toBe(pair[0]);
		expect(event.hasResponded()).toBe(true);
	});
});

describe("ShovelWebSocket relay", () => {
	it("_deliver dispatches message event", () => {
		const pair = new WebSocketPair();
		const socket = pair[0];
		socket.accept();

		const messages: string[] = [];
		socket.addEventListener("message", (ev) => {
			messages.push((ev as MessageEvent).data);
		});

		socket._deliver("relayed message");
		expect(messages).toEqual(["relayed message"]);
	});

	it("_deliverClose dispatches close event", () => {
		const pair = new WebSocketPair();
		const socket = pair[0];
		socket.accept();

		let closeEvent: CloseEvent | null = null;
		socket.addEventListener("close", (ev) => {
			closeEvent = ev as CloseEvent;
		});

		socket._deliverClose(1001, "going away");
		expect(closeEvent).not.toBeNull();
		expect(closeEvent!.code).toBe(1001);
		expect(closeEvent!.reason).toBe("going away");
		expect(socket.readyState).toBe(ShovelWebSocket.CLOSED);
	});

	it("_setRelay redirects send() through relay", async () => {
		const pair = new WebSocketPair();
		const socket = pair[0];
		socket.accept();

		const sent: string[] = [];
		socket._setRelay({
			send: (data) => sent.push(data as string),
			close: () => {},
		});

		socket.send("through relay");
		expect(sent).toEqual(["through relay"]);
	});
});
