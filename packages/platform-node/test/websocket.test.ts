/**
 * WebSocket upgrade tests for Node.js platform adapter
 *
 * Tests createServer() WebSocket upgrade handling via WebSocketPair
 * and the createWebSocketBridge helper.
 */

import {test, expect, describe, afterEach} from "bun:test";
import {NodePlatform} from "../src/index.js";
import {WebSocketPair} from "../../platform/src/websocket.js";
import {createWebSocketBridge} from "../../platform/src/index.js";
import {WebSocketServer} from "ws";

const TIMEOUT = 10000;

describe("Node.js WebSocket upgrade", () => {
	let platform: NodePlatform;
	let server: ReturnType<NodePlatform["createServer"]>;

	afterEach(async () => {
		await server?.close();
		await platform?.dispose();
	});

	test(
		"WebSocket echo server via WebSocketPair",
		async () => {
			platform = new NodePlatform({WebSocketServer});
			server = platform.createServer(
				(request) => {
					const url = new URL(request.url);
					if (url.pathname === "/ws") {
						const pair = new WebSocketPair();
						const [client, ws] = [pair[0], pair[1]];

						ws.accept();
						ws.addEventListener("message", ((ev: MessageEvent) => {
							ws.send("echo: " + ev.data);
						}) as EventListener);

						return {webSocket: createWebSocketBridge(client)};
					}
					return {response: new Response("OK")};
				},
				{port: 0, host: "127.0.0.1"},
			);

			await server.listen();
			const port = server.address().port;

			// Connect with WebSocket client
			const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);

			const messages: string[] = [];
			const opened = new Promise<void>((resolve) => {
				ws.onopen = () => resolve();
			});
			const messageReceived = new Promise<void>((resolve) => {
				ws.onmessage = (ev) => {
					messages.push(ev.data);
					resolve();
				};
			});

			await opened;
			ws.send("hello");
			await messageReceived;

			expect(messages).toEqual(["echo: hello"]);
			ws.close();
		},
		TIMEOUT,
	);

	test(
		"WebSocket multiple messages",
		async () => {
			platform = new NodePlatform({WebSocketServer});
			server = platform.createServer(
				(request) => {
					const url = new URL(request.url);
					if (url.pathname === "/ws") {
						const pair = new WebSocketPair();
						const [client, ws] = [pair[0], pair[1]];

						ws.accept();
						ws.addEventListener("message", ((ev: MessageEvent) => {
							ws.send(ev.data.toUpperCase());
						}) as EventListener);

						return {webSocket: createWebSocketBridge(client)};
					}
					return {response: new Response("OK")};
				},
				{port: 0, host: "127.0.0.1"},
			);

			await server.listen();
			const port = server.address().port;

			const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);

			const messages: string[] = [];
			const allReceived = new Promise<void>((resolve) => {
				ws.onmessage = (ev) => {
					messages.push(ev.data);
					if (messages.length === 3) resolve();
				};
			});

			await new Promise<void>((resolve) => {
				ws.onopen = () => resolve();
			});

			ws.send("hello");
			ws.send("world");
			ws.send("test");
			await allReceived;

			expect(messages).toEqual(["HELLO", "WORLD", "TEST"]);
			ws.close();
		},
		TIMEOUT,
	);

	test(
		"WebSocket close from server",
		async () => {
			platform = new NodePlatform({WebSocketServer});
			server = platform.createServer(
				(request) => {
					const url = new URL(request.url);
					if (url.pathname === "/ws") {
						const pair = new WebSocketPair();
						const [client, ws] = [pair[0], pair[1]];

						ws.accept();
						ws.addEventListener("message", () => {
							// Close after receiving a message
							ws.close(1000, "done");
						});

						return {webSocket: createWebSocketBridge(client)};
					}
					return {response: new Response("OK")};
				},
				{port: 0, host: "127.0.0.1"},
			);

			await server.listen();
			const port = server.address().port;

			const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);

			const closed = new Promise<CloseEvent>((resolve) => {
				ws.onclose = (ev) => resolve(ev);
			});

			await new Promise<void>((resolve) => {
				ws.onopen = () => resolve();
			});

			ws.send("trigger close");
			const closeEvent = await closed;

			expect(closeEvent.code).toBe(1000);
			expect(closeEvent.reason).toBe("done");
		},
		TIMEOUT,
	);

	test(
		"regular HTTP still works alongside WebSocket",
		async () => {
			platform = new NodePlatform({WebSocketServer});
			server = platform.createServer(
				(request) => {
					const url = new URL(request.url);
					if (url.pathname === "/ws") {
						const pair = new WebSocketPair();
						pair[1].accept();
						return {webSocket: createWebSocketBridge(pair[0])};
					}
					return {response: new Response("Hello HTTP")};
				},
				{port: 0, host: "127.0.0.1"},
			);

			await server.listen();
			const port = server.address().port;

			// Regular HTTP request should still work
			const response = await fetch(`http://127.0.0.1:${port}/hello`);
			expect(response.status).toBe(200);
			expect(await response.text()).toBe("Hello HTTP");
		},
		TIMEOUT,
	);

	test(
		"WebSocket binary data",
		async () => {
			platform = new NodePlatform({WebSocketServer});
			server = platform.createServer(
				(request) => {
					const url = new URL(request.url);
					if (url.pathname === "/ws") {
						const pair = new WebSocketPair();
						const [client, ws] = [pair[0], pair[1]];

						ws.accept();
						ws.addEventListener("message", ((ev: MessageEvent) => {
							// Echo binary data back
							ws.send(ev.data);
						}) as EventListener);

						return {webSocket: createWebSocketBridge(client)};
					}
					return {response: new Response("OK")};
				},
				{port: 0, host: "127.0.0.1"},
			);

			await server.listen();
			const port = server.address().port;

			const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
			ws.binaryType = "arraybuffer";

			const received = new Promise<ArrayBuffer>((resolve) => {
				ws.onmessage = (ev) => resolve(ev.data);
			});

			await new Promise<void>((resolve) => {
				ws.onopen = () => resolve();
			});

			const data = new Uint8Array([1, 2, 3, 4, 5]);
			ws.send(data);
			const result = await received;

			expect(new Uint8Array(result)).toEqual(data);
			ws.close();
		},
		TIMEOUT,
	);
});
