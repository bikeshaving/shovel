/**
 * Unit and integration tests for WebSocket support
 *
 * Tests:
 * - upgradeWebSocket() on ShovelFetchEvent
 * - WebSocketMessageEvent / WebSocketCloseEvent construction and dispatch
 * - ShovelWebSocketClient send/close via relay
 * - ShovelClients WebSocket tracking
 * - Pool-level WebSocket upgrade flow
 */

import {describe, it, expect, beforeAll, afterAll} from "bun:test";
import {
	ShovelServiceWorkerRegistration,
	ShovelFetchEvent,
	ShovelWebSocketClient,
	WebSocketMessageEvent,
	WebSocketCloseEvent,
	ShovelClients,
	kGetUpgradeResult,
	dispatchRequest,
	dispatchFetchEvent,
	dispatchWebSocketMessage,
	dispatchWebSocketClose,
	runLifecycle,
	setWebSocketRelay,
	createDirectModePool,
} from "../src/runtime.js";
import {ServiceWorkerPool} from "../src/index.js";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import {fileURLToPath} from "url";
import * as esbuild from "esbuild";

// ============================================================================
// Unit Tests: ShovelFetchEvent.upgradeWebSocket()
// ============================================================================

describe("FetchEvent.upgradeWebSocket()", () => {
	it("returns a ShovelWebSocketClient", () => {
		const event = new ShovelFetchEvent(
			new Request("http://localhost/ws", {headers: {upgrade: "websocket"}}),
		);
		const client = event.upgradeWebSocket();
		expect(client).toBeInstanceOf(ShovelWebSocketClient);
	});

	it("sets responded to true", () => {
		const event = new ShovelFetchEvent(
			new Request("http://localhost/ws", {headers: {upgrade: "websocket"}}),
		);
		expect(event.hasResponded()).toBe(false);
		event.upgradeWebSocket();
		expect(event.hasResponded()).toBe(true);
	});

	it("sets upgrade result accessible via kGetUpgradeResult", () => {
		const event = new ShovelFetchEvent(
			new Request("http://localhost/ws", {headers: {upgrade: "websocket"}}),
		);
		expect(event[kGetUpgradeResult]()).toBeNull();

		const client = event.upgradeWebSocket();
		const result = event[kGetUpgradeResult]();
		expect(result).not.toBeNull();
		expect(result!.client).toBe(client);
		expect(result!.connectionID).toBe(client.id);
	});

	it("assigns a UUID as connectionID", () => {
		const event = new ShovelFetchEvent(
			new Request("http://localhost/ws", {headers: {upgrade: "websocket"}}),
		);
		const client = event.upgradeWebSocket();
		// UUID v4 format
		expect(client.id).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
		);
	});

	it("attaches user data to client", () => {
		const event = new ShovelFetchEvent(
			new Request("http://localhost/ws", {headers: {upgrade: "websocket"}}),
		);
		const client = event.upgradeWebSocket({data: {room: "lobby"}});
		expect(client.data).toEqual({room: "lobby"});
	});

	it("prevents respondWith after upgradeWebSocket", () => {
		const event = new ShovelFetchEvent(
			new Request("http://localhost/ws", {headers: {upgrade: "websocket"}}),
		);
		event.upgradeWebSocket();
		expect(() => event.respondWith(new Response("nope"))).toThrow(
			"respondWith() already called",
		);
	});

	it("prevents upgradeWebSocket after respondWith", () => {
		const event = new ShovelFetchEvent(
			new Request("http://localhost/ws", {headers: {upgrade: "websocket"}}),
		);
		event.respondWith(new Response("already responded"));
		expect(() => event.upgradeWebSocket()).toThrow(
			"Cannot upgradeWebSocket() after respondWith() or upgradeWebSocket() was already called",
		);
	});

	it("prevents double upgradeWebSocket", () => {
		const event = new ShovelFetchEvent(
			new Request("http://localhost/ws", {headers: {upgrade: "websocket"}}),
		);
		event.upgradeWebSocket();
		expect(() => event.upgradeWebSocket()).toThrow(
			"Cannot upgradeWebSocket() after respondWith() or upgradeWebSocket() was already called",
		);
	});

	it("getResponse returns null after upgrade", () => {
		const event = new ShovelFetchEvent(
			new Request("http://localhost/ws", {headers: {upgrade: "websocket"}}),
		);
		event.upgradeWebSocket();
		expect(event.getResponse()).toBeNull();
	});

	it("throws on non-WebSocket request", () => {
		const event = new ShovelFetchEvent(new Request("http://localhost/ws"));
		expect(() => event.upgradeWebSocket()).toThrow(
			"Cannot upgradeWebSocket() on a request without Upgrade: websocket header",
		);
	});
});

// ============================================================================
// Unit Tests: WebSocket Event Classes
// ============================================================================

describe("WebSocketMessageEvent", () => {
	it("has correct type, source, and data", () => {
		const client = new ShovelWebSocketClient({
			id: "test-id",
			url: "http://localhost/ws",
			data: null,
		});
		const event = new WebSocketMessageEvent(client, "hello");
		expect(event.type).toBe("wsmessage");
		expect(event.source).toBe(client);
		expect(event.data).toBe("hello");
	});

	it("supports ArrayBuffer data", () => {
		const client = new ShovelWebSocketClient({
			id: "test-id",
			url: "http://localhost/ws",
			data: null,
		});
		const buf = new ArrayBuffer(4);
		const event = new WebSocketMessageEvent(client, buf);
		expect(event.data).toBe(buf);
	});
});

describe("WebSocketCloseEvent", () => {
	it("has correct type and properties", () => {
		const client = new ShovelWebSocketClient({
			id: "test-id",
			url: "http://localhost/ws",
			data: null,
		});
		const event = new WebSocketCloseEvent(client, 1000, "Normal", true);
		expect(event.type).toBe("wsclose");
		expect(event.source).toBe(client);
		expect(event.code).toBe(1000);
		expect(event.reason).toBe("Normal");
		expect(event.wasClean).toBe(true);
	});
});

// ============================================================================
// Unit Tests: ShovelWebSocketClient
// ============================================================================

describe("ShovelWebSocketClient", () => {
	it("exposes id, url, and data", () => {
		const client = new ShovelWebSocketClient({
			id: "abc-123",
			url: "http://localhost/ws",
			data: {foo: "bar"},
		});
		expect(client.id).toBe("abc-123");
		expect(client.url).toBe("http://localhost/ws");
		expect(client.data).toEqual({foo: "bar"});
	});

	it("send() throws without relay", () => {
		const client = new ShovelWebSocketClient({
			id: "abc-123",
			url: "http://localhost/ws",
			data: null,
		});
		expect(() => client.send("test")).toThrow(
			"WebSocket relay not initialized",
		);
	});

	it("close() throws without relay", () => {
		const client = new ShovelWebSocketClient({
			id: "abc-123",
			url: "http://localhost/ws",
			data: null,
		});
		expect(() => client.close()).toThrow("WebSocket relay not initialized");
	});

	it("send() and close() work through relay", () => {
		const sent: Array<{id: string; data: string | ArrayBuffer}> = [];
		const closed: Array<{id: string; code?: number; reason?: string}> = [];

		setWebSocketRelay({
			send(id, data) {
				sent.push({id, data});
			},
			close(id, code, reason) {
				closed.push({id, code, reason});
			},
		});

		const client = new ShovelWebSocketClient({
			id: "relay-test",
			url: "http://localhost/ws",
			data: null,
		});

		client.send("hello");
		client.send("world");
		client.close(1000, "done");

		expect(sent).toEqual([
			{id: "relay-test", data: "hello"},
			{id: "relay-test", data: "world"},
		]);
		expect(closed).toEqual([{id: "relay-test", code: 1000, reason: "done"}]);

		// Clean up relay
		setWebSocketRelay({
			send() {},
			close() {},
		});
	});
});

// ============================================================================
// Unit Tests: ShovelClients WebSocket tracking
// ============================================================================

describe("ShovelClients WebSocket tracking", () => {
	it("registers and retrieves WebSocket clients", () => {
		const clients = new ShovelClients();
		const client = new ShovelWebSocketClient({
			id: "ws-1",
			url: "http://localhost/ws",
			data: null,
		});

		clients.registerWebSocketClient(client);
		expect(clients.getWebSocketClient("ws-1")).toBe(client);
	});

	it("removes WebSocket clients", () => {
		const clients = new ShovelClients();
		const client = new ShovelWebSocketClient({
			id: "ws-1",
			url: "http://localhost/ws",
			data: null,
		});

		clients.registerWebSocketClient(client);
		clients.removeWebSocketClient("ws-1");
		expect(clients.getWebSocketClient("ws-1")).toBeUndefined();
	});

	it("get() returns WebSocket clients", async () => {
		const clients = new ShovelClients();
		const client = new ShovelWebSocketClient({
			id: "ws-1",
			url: "http://localhost/ws",
			data: null,
		});

		clients.registerWebSocketClient(client);
		const result = await clients.get("ws-1");
		expect(result).toBe(client);
	});

	it("matchAll with type websocket returns WebSocket clients", async () => {
		const clients = new ShovelClients();
		const client1 = new ShovelWebSocketClient({
			id: "ws-1",
			url: "http://localhost/ws",
			data: null,
		});
		const client2 = new ShovelWebSocketClient({
			id: "ws-2",
			url: "http://localhost/ws",
			data: null,
		});

		clients.registerWebSocketClient(client1);
		clients.registerWebSocketClient(client2);

		const all = await clients.matchAll({type: "websocket"} as any);
		expect(all.length).toBe(2);
	});
});

// ============================================================================
// Integration: Dispatch WebSocket events through registration
// ============================================================================

describe("WebSocket event dispatch", () => {
	it("dispatches wsmessage to registration listeners", async () => {
		const registration = new ShovelServiceWorkerRegistration();
		const received: Array<{data: string | ArrayBuffer; clientId: string}> = [];

		registration.addEventListener("wsmessage", ((
			event: WebSocketMessageEvent,
		) => {
			received.push({data: event.data, clientId: event.source.id});
		}) as EventListener);

		const client = new ShovelWebSocketClient({
			id: "dispatch-test",
			url: "http://localhost/ws",
			data: null,
		});

		await dispatchWebSocketMessage(registration, client, "hello");
		await dispatchWebSocketMessage(registration, client, "world");

		expect(received).toEqual([
			{data: "hello", clientId: "dispatch-test"},
			{data: "world", clientId: "dispatch-test"},
		]);
	});

	it("dispatches wsclose to registration listeners", async () => {
		const registration = new ShovelServiceWorkerRegistration();
		const received: Array<{
			code: number;
			reason: string;
			wasClean: boolean;
		}> = [];

		registration.addEventListener("wsclose", ((event: WebSocketCloseEvent) => {
			received.push({
				code: event.code,
				reason: event.reason,
				wasClean: event.wasClean,
			});
		}) as EventListener);

		const client = new ShovelWebSocketClient({
			id: "close-test",
			url: "http://localhost/ws",
			data: null,
		});

		await dispatchWebSocketClose(
			registration,
			client,
			1000,
			"Normal closure",
			true,
		);

		expect(received).toEqual([
			{code: 1000, reason: "Normal closure", wasClean: true},
		]);
	});

	it("upgradeWebSocket in fetch handler returns null response via dispatchFetchEvent", async () => {
		const registration = new ShovelServiceWorkerRegistration();

		registration.addEventListener("fetch", ((event: FetchEvent) => {
			event.upgradeWebSocket({data: {test: true}});
		}) as EventListener);

		await runLifecycle(registration);

		const {response, event} = await dispatchFetchEvent(
			registration,
			new Request("http://localhost/ws", {headers: {upgrade: "websocket"}}),
		);

		expect(response).toBeNull();
		const upgrade = event[kGetUpgradeResult]();
		expect(upgrade).not.toBeNull();
		expect(upgrade!.client.data).toEqual({test: true});
	});

	it("non-upgrade fetch still returns Response via dispatchRequest", async () => {
		const registration = new ShovelServiceWorkerRegistration();

		registration.addEventListener("fetch", ((event: FetchEvent) => {
			event.respondWith(new Response("hello"));
		}) as EventListener);

		await runLifecycle(registration);

		const response = await dispatchRequest(
			registration,
			new Request("http://localhost/hello"),
		);
		expect(await response.text()).toBe("hello");
	});
});

// ============================================================================
// Integration: createDirectModePool
// ============================================================================

describe("createDirectModePool", () => {
	it("returns WebSocketUpgradeResult for upgrade requests", async () => {
		const registration = new ShovelServiceWorkerRegistration();
		const clients = new ShovelClients();

		registration.addEventListener("fetch", ((event: FetchEvent) => {
			const url = new URL(event.request.url);
			if (url.pathname === "/ws") {
				event.upgradeWebSocket({data: {room: "test"}});
			} else {
				event.respondWith(new Response("hello"));
			}
		}) as EventListener);

		await runLifecycle(registration);

		const pool = createDirectModePool(registration, clients);

		// Normal request returns Response
		const httpResult = await pool.handleRequest(
			new Request("http://localhost/hello"),
		);
		expect(httpResult).toBeInstanceOf(Response);
		expect(await (httpResult as Response).text()).toBe("hello");

		// Upgrade request returns WebSocketUpgradeResult
		const wsResult = await pool.handleRequest(
			new Request("http://localhost/ws", {headers: {upgrade: "websocket"}}),
		);
		expect("upgrade" in wsResult).toBe(true);
		expect((wsResult as any).upgrade).toBe(true);
		expect((wsResult as any).connectionID).toBeDefined();
	});

	it("relays send/close through WebSocket handlers", async () => {
		const registration = new ShovelServiceWorkerRegistration();
		const clients = new ShovelClients();
		const sent: Array<{id: string; data: string | ArrayBuffer}> = [];
		const closed: Array<{
			id: string;
			code?: number;
			reason?: string;
		}> = [];

		// Track what the user's wsmessage handler sends back
		registration.addEventListener("wsmessage", ((
			event: WebSocketMessageEvent,
		) => {
			event.source.send(`Echo: ${event.data}`);
		}) as EventListener);

		registration.addEventListener("fetch", ((event: FetchEvent) => {
			event.upgradeWebSocket();
		}) as EventListener);

		await runLifecycle(registration);

		const pool = createDirectModePool(registration, clients);

		// Wire up handlers (like the platform adapter would)
		pool.setWebSocketHandlers({
			send(id, data) {
				sent.push({id, data});
			},
			close(id, code, reason) {
				closed.push({id, code, reason});
			},
		});

		// Perform upgrade
		const result = await pool.handleRequest(
			new Request("http://localhost/ws", {headers: {upgrade: "websocket"}}),
		);
		const connectionID = (result as any).connectionID;

		// Simulate incoming WebSocket message → should trigger echo
		pool.sendWebSocketMessage(connectionID, "hello");

		// Give async dispatch time to complete
		await new Promise((r) => setTimeout(r, 10));

		expect(sent.length).toBe(1);
		expect(sent[0].data).toBe("Echo: hello");
		expect(sent[0].id).toBe(connectionID);

		// Simulate close
		pool.sendWebSocketClose(connectionID, 1000, "bye", true);
	});

	it("keeps direct-mode relays isolated per pool", async () => {
		const registrationOne = new ShovelServiceWorkerRegistration();
		const clientsOne = new ShovelClients();
		const sentOne: Array<{id: string; data: string | ArrayBuffer}> = [];

		registrationOne.addEventListener("wsmessage", ((
			event: WebSocketMessageEvent,
		) => {
			event.source.send(`one:${event.data}`);
		}) as EventListener);
		registrationOne.addEventListener("fetch", ((event: FetchEvent) => {
			event.upgradeWebSocket();
		}) as EventListener);

		const registrationTwo = new ShovelServiceWorkerRegistration();
		const clientsTwo = new ShovelClients();
		const sentTwo: Array<{id: string; data: string | ArrayBuffer}> = [];

		registrationTwo.addEventListener("wsmessage", ((
			event: WebSocketMessageEvent,
		) => {
			event.source.send(`two:${event.data}`);
		}) as EventListener);
		registrationTwo.addEventListener("fetch", ((event: FetchEvent) => {
			event.upgradeWebSocket();
		}) as EventListener);

		await runLifecycle(registrationOne);
		await runLifecycle(registrationTwo);

		const poolOne = createDirectModePool(registrationOne, clientsOne);
		poolOne.setWebSocketHandlers({
			send(id, data) {
				sentOne.push({id, data});
			},
			close() {},
		});

		const poolTwo = createDirectModePool(registrationTwo, clientsTwo);
		poolTwo.setWebSocketHandlers({
			send(id, data) {
				sentTwo.push({id, data});
			},
			close() {},
		});

		const resultOne = await poolOne.handleRequest(
			new Request("http://localhost/ws", {headers: {upgrade: "websocket"}}),
		);
		const resultTwo = await poolTwo.handleRequest(
			new Request("http://localhost/ws", {headers: {upgrade: "websocket"}}),
		);

		const connectionOne = (resultOne as any).connectionID;
		const connectionTwo = (resultTwo as any).connectionID;

		poolOne.sendWebSocketMessage(connectionOne, "alpha");
		poolTwo.sendWebSocketMessage(connectionTwo, "beta");

		await new Promise((r) => setTimeout(r, 10));

		expect(sentOne).toEqual([{id: connectionOne, data: "one:alpha"}]);
		expect(sentTwo).toEqual([{id: connectionTwo, data: "two:beta"}]);
	});
});

// ============================================================================
// Regression: non-cloneable client.data must not break pool upgrade
// ============================================================================

describe("non-cloneable client.data in pool mode", () => {
	let pool: ServiceWorkerPool;
	let tempDir: string;

	beforeAll(async () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ws-clone-test-"));

		const currentDir = path.dirname(fileURLToPath(import.meta.url));
		const nodeModulesSource = path.resolve(currentDir, "../../../node_modules");
		fs.symlinkSync(
			nodeModulesSource,
			path.join(tempDir, "node_modules"),
			"dir",
		);

		const workerSourcePath = path.join(tempDir, "ws-nonclone-worker.ts");
		fs.writeFileSync(
			workerSourcePath,
			`
import {initWorkerRuntime, runLifecycle, startWorkerMessageLoop} from "@b9g/platform/runtime";

const {registration} = await initWorkerRuntime({config: {}});

self.addEventListener("fetch", (event) => {
	// Store a function in client.data — not structured-cloneable
	event.upgradeWebSocket({data: {handler: () => "not cloneable", symbol: Symbol("x")}});
});

self.addEventListener("wsmessage", (event) => {
	// Verify the non-cloneable data survived in-worker
	const hasHandler = typeof event.source.data?.handler === "function";
	event.source.send(hasHandler ? "ok" : "missing");
});

await runLifecycle(registration);
startWorkerMessageLoop({registration});
`,
		);

		const bundledPath = path.join(tempDir, "ws-nonclone-worker.js");
		await esbuild.build({
			entryPoints: [workerSourcePath],
			bundle: true,
			outfile: bundledPath,
			format: "esm",
			platform: "node",
			target: "esnext",
			external: ["node:*", "bun:*"],
		});

		pool = new ServiceWorkerPool(
			{workerCount: 1, requestTimeout: 5000},
			bundledPath,
		);
		await pool.init();
	});

	afterAll(async () => {
		if (pool) await pool.terminate();
		if (tempDir) fs.rmSync(tempDir, {recursive: true, force: true});
	});

	it("upgrade succeeds with non-cloneable client.data", async () => {
		const sent: Array<{id: string; data: string | ArrayBuffer}> = [];

		pool.setWebSocketHandlers({
			send(id, data) {
				sent.push({id, data});
			},
			close() {},
		});

		// This would throw DataCloneError if client.data was passed through postMessage
		const result = await pool.handleRequest(
			new Request("http://localhost/ws", {headers: {upgrade: "websocket"}}),
		);
		expect("upgrade" in result).toBe(true);

		// Verify the worker kept the non-cloneable data locally
		pool.sendWebSocketMessage((result as any).connectionID, "ping");
		await new Promise((r) => setTimeout(r, 100));

		expect(sent.length).toBe(1);
		expect(sent[0].data).toBe("ok");
	});
});

// Regression: close during upgrade handler must fire wsclose event
// ============================================================================

describe("close during upgrade in direct mode", () => {
	it("fires wsclose when handler closes socket immediately after upgrade", async () => {
		const registration = new ShovelServiceWorkerRegistration();
		const clients = new ShovelClients();
		const closedIds: string[] = [];

		registration.addEventListener("fetch", ((event: FetchEvent) => {
			const client = event.upgradeWebSocket();
			// Immediately close — simulates rejecting a connection after upgrade
			client.close(4000, "rejected");
		}) as EventListener);

		registration.addEventListener("wsclose", ((event: WebSocketCloseEvent) => {
			closedIds.push(event.source.id);
		}) as EventListener);

		await runLifecycle(registration);

		const pool = createDirectModePool(registration, clients);
		const closed: Array<{id: string; code: number; reason: string}> = [];

		pool.setWebSocketHandlers({
			send() {},
			close(id, code, reason) {
				closed.push({id, code: code ?? 1000, reason: reason ?? ""});
				// Simulate the platform adapter calling sendWebSocketClose
				pool.sendWebSocketClose(id, code ?? 1000, reason ?? "", true);
			},
		});

		const result = await pool.handleRequest(
			new Request("http://localhost/ws", {headers: {upgrade: "websocket"}}),
		);
		expect("upgrade" in result).toBe(true);

		// Give dispatch queue time to process
		await new Promise((r) => setTimeout(r, 50));

		expect(closed.length).toBe(1);
		expect(closed[0].code).toBe(4000);
		expect(closed[0].reason).toBe("rejected");

		// wsclose event should have fired
		expect(closedIds.length).toBe(1);
	});
});

// ============================================================================
// Integration: ServiceWorkerPool WebSocket upgrade
// ============================================================================

describe("ServiceWorkerPool WebSocket upgrade", () => {
	let pool: ServiceWorkerPool;
	let tempDir: string;

	beforeAll(async () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ws-pool-test-"));

		const currentDir = path.dirname(fileURLToPath(import.meta.url));
		const nodeModulesSource = path.resolve(currentDir, "../../../node_modules");
		fs.symlinkSync(
			nodeModulesSource,
			path.join(tempDir, "node_modules"),
			"dir",
		);

		const workerSourcePath = path.join(tempDir, "ws-worker.ts");
		fs.writeFileSync(
			workerSourcePath,
			`
import {initWorkerRuntime, runLifecycle, startWorkerMessageLoop} from "@b9g/platform/runtime";

const {registration} = await initWorkerRuntime({config: {}});

self.addEventListener("fetch", (event) => {
	const url = new URL(event.request.url);
	if (url.pathname === "/ws") {
		const client = event.upgradeWebSocket({data: {echo: true}});
		return;
	}
	event.respondWith(new Response("not a websocket"));
});

self.addEventListener("wsmessage", (event) => {
	event.source.send("Echo: " + event.data);
});

self.addEventListener("wsclose", (event) => {
	// no-op
});

await runLifecycle(registration);
startWorkerMessageLoop({registration});
`,
		);

		const bundledPath = path.join(tempDir, "ws-worker.js");
		await esbuild.build({
			entryPoints: [workerSourcePath],
			bundle: true,
			outfile: bundledPath,
			format: "esm",
			platform: "node",
			target: "esnext",
			external: ["node:*", "bun:*"],
		});

		pool = new ServiceWorkerPool(
			{workerCount: 1, requestTimeout: 5000},
			bundledPath,
		);
		await pool.init();
	});

	afterAll(async () => {
		if (pool) await pool.terminate();
		if (tempDir) fs.rmSync(tempDir, {recursive: true, force: true});
	});

	it("returns Response for non-upgrade requests", async () => {
		const result = await pool.handleRequest(
			new Request("http://localhost/hello"),
		);
		expect(result).toBeInstanceOf(Response);
		expect(await (result as Response).text()).toBe("not a websocket");
	});

	it("returns WebSocketUpgradeResult for upgrade requests", async () => {
		const result = await pool.handleRequest(
			new Request("http://localhost/ws", {headers: {upgrade: "websocket"}}),
		);
		expect("upgrade" in result).toBe(true);
		expect((result as any).upgrade).toBe(true);
		expect((result as any).connectionID).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
		);
	});

	it("relays messages to worker and back", async () => {
		const sent: Array<{id: string; data: string | ArrayBuffer}> = [];

		pool.setWebSocketHandlers({
			send(id, data) {
				sent.push({id, data});
			},
			close() {},
		});

		// Upgrade
		const result = await pool.handleRequest(
			new Request("http://localhost/ws", {headers: {upgrade: "websocket"}}),
		);
		const connectionID = (result as any).connectionID;

		// Send message → worker echoes it back
		pool.sendWebSocketMessage(connectionID, "ping");

		// Wait for the echo
		await new Promise((r) => setTimeout(r, 100));

		expect(sent.length).toBe(1);
		expect(sent[0].id).toBe(connectionID);
		expect(sent[0].data).toBe("Echo: ping");
	});

	it("handles binary messages", async () => {
		const sent: Array<{id: string; data: string | ArrayBuffer}> = [];

		pool.setWebSocketHandlers({
			send(id, data) {
				sent.push({id, data});
			},
			close() {},
		});

		const result = await pool.handleRequest(
			new Request("http://localhost/ws", {headers: {upgrade: "websocket"}}),
		);
		const connectionID = (result as any).connectionID;

		// Send binary data
		const buf = new TextEncoder().encode("binary-test").buffer;
		pool.sendWebSocketMessage(connectionID, buf as ArrayBuffer);

		await new Promise((r) => setTimeout(r, 100));

		// Worker echo handler calls .send("Echo: " + event.data)
		// Since binary data gets toString'd, we expect something back
		expect(sent.length).toBe(1);
	});

	it("handles multiple concurrent connections", async () => {
		const sent: Array<{id: string; data: string | ArrayBuffer}> = [];

		pool.setWebSocketHandlers({
			send(id, data) {
				sent.push({id, data});
			},
			close() {},
		});

		// Open two connections
		const result1 = await pool.handleRequest(
			new Request("http://localhost/ws", {headers: {upgrade: "websocket"}}),
		);
		const result2 = await pool.handleRequest(
			new Request("http://localhost/ws", {headers: {upgrade: "websocket"}}),
		);
		const id1 = (result1 as any).connectionID;
		const id2 = (result2 as any).connectionID;

		expect(id1).not.toBe(id2);

		// Send messages on both
		pool.sendWebSocketMessage(id1, "from-1");
		pool.sendWebSocketMessage(id2, "from-2");

		await new Promise((r) => setTimeout(r, 100));

		// Both should get echoed back
		const msg1 = sent.find((s) => s.id === id1);
		const msg2 = sent.find((s) => s.id === id2);
		expect(msg1?.data).toBe("Echo: from-1");
		expect(msg2?.data).toBe("Echo: from-2");
	});
});
