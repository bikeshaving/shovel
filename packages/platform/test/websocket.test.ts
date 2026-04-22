import {test, expect, beforeEach} from "bun:test";
import {
	ShovelServiceWorkerRegistration,
	ServiceWorkerGlobals,
	ShovelWebSocketConnection,
	ShovelBroadcastChannel,
	dispatchFetchEvent,
	dispatchWebSocketMessage,
	dispatchWebSocketClose,
	kGetUpgradeResult,
	kGetConnectionState,
	runLifecycle,
} from "../src/runtime.js";
import type {WebSocketRelay} from "../src/runtime.js";

/**
 * Mock relay that records send/close invocations. One relay instance per test
 * to keep things hermetic.
 */
function createMockRelay(): {
	relay: WebSocketRelay;
	sends: Array<{id: string; data: string | ArrayBuffer}>;
	closes: Array<{id: string; code?: number; reason?: string}>;
} {
	const sends: Array<{id: string; data: string | ArrayBuffer}> = [];
	const closes: Array<{id: string; code?: number; reason?: string}> = [];
	const relay: WebSocketRelay = {
		send(id, data) {
			sends.push({id, data});
		},
		close(id, code, reason) {
			closes.push({id, code, reason});
		},
	};
	return {relay, sends, closes};
}

// Reset global event listeners between tests — ServiceWorkerGlobals installs
// itself on globalThis and holds onto listeners across tests otherwise.
beforeEach(() => {
	// Remove any leftover fetch / websocket listeners
	for (const type of ["fetch", "websocketmessage", "websocketclose"] as const) {
		const handlers = (globalThis as any)[`__shovelTestHandlers_${type}`] as
			| Array<EventListener>
			| undefined;
		if (handlers) {
			for (const h of handlers)
				(globalThis as any).removeEventListener(type, h);
		}
		(globalThis as any)[`__shovelTestHandlers_${type}`] = [];
	}
});

function addShovelListener(
	type: "fetch" | "websocketmessage" | "websocketclose",
	handler: EventListener,
): void {
	(globalThis as any).addEventListener(type, handler);
	(
		(globalThis as any)[`__shovelTestHandlers_${type}`] as Array<EventListener>
	).push(handler);
}

async function setupScope(): Promise<ShovelServiceWorkerRegistration> {
	const registration = new ShovelServiceWorkerRegistration();
	const scope = new ServiceWorkerGlobals({registration});
	scope.install();
	await runLifecycle(registration);
	return registration;
}

test("upgradeWebSocket returns a WebSocketConnection with a UUID id", async () => {
	const registration = await setupScope();
	const {relay} = createMockRelay();

	addShovelListener("fetch", (event: any) => {
		const ws = event.upgradeWebSocket();
		expect(ws).toBeInstanceOf(ShovelWebSocketConnection);
		expect(typeof ws.id).toBe("string");
		expect(ws.id.length).toBeGreaterThan(0);
	});

	const request = new Request("http://localhost/ws", {
		headers: {Upgrade: "websocket", Connection: "Upgrade"},
	});
	const {event, response} = await dispatchFetchEvent(registration, request, {
		wsRelay: relay,
	});
	expect(response).toBeNull();
	const upgrade = event[kGetUpgradeResult]();
	expect(upgrade).not.toBeNull();
	expect(upgrade!.id).toMatch(/[0-9a-f-]{36}/);
});

test("upgradeWebSocket throws without Upgrade header", async () => {
	const registration = await setupScope();
	const {relay} = createMockRelay();

	let caught: Error | null = null;
	addShovelListener("fetch", (event: any) => {
		try {
			event.upgradeWebSocket();
		} catch (err) {
			caught = err as Error;
			event.respondWith(new Response("not ws", {status: 400}));
		}
	});

	const request = new Request("http://localhost/plain");
	await dispatchFetchEvent(registration, request, {wsRelay: relay});
	expect(caught).not.toBeNull();
	expect(caught!.message).toMatch(/Upgrade: websocket/);
});

test("onUpgrade fires synchronously during the fetch handler", async () => {
	const registration = await setupScope();
	const {relay} = createMockRelay();

	const seen: string[] = [];
	addShovelListener("fetch", (event: any) => {
		seen.push("before-upgrade");
		const ws = event.upgradeWebSocket();
		seen.push(`after-upgrade:${ws.id.slice(0, 4)}`);
	});

	const request = new Request("http://localhost/ws", {
		headers: {Upgrade: "websocket"},
	});
	let observedConnection: ShovelWebSocketConnection | null = null;
	await dispatchFetchEvent(registration, request, {
		wsRelay: relay,
		onUpgrade(conn) {
			observedConnection = conn;
			seen.push("onUpgrade");
		},
	});
	expect(seen).toEqual([
		"before-upgrade",
		"onUpgrade",
		expect.stringMatching(/^after-upgrade:/),
	]);
	expect(observedConnection).not.toBeNull();
});

test("websocketmessage event fires with source and data", async () => {
	const registration = await setupScope();
	const {relay, sends} = createMockRelay();

	addShovelListener("fetch", (event: any) => {
		event.upgradeWebSocket();
	});
	addShovelListener("websocketmessage", (event: any) => {
		event.source.send(`echo: ${event.data}`);
	});

	const request = new Request("http://localhost/ws", {
		headers: {Upgrade: "websocket"},
	});
	const {event} = await dispatchFetchEvent(registration, request, {
		wsRelay: relay,
	});
	const conn = event[kGetUpgradeResult]()!;

	await dispatchWebSocketMessage(registration, conn, "hello");
	expect(sends).toEqual([{id: conn.id, data: "echo: hello"}]);
});

test("websocketclose fires with id + close details and releases subscriptions", async () => {
	const registration = await setupScope();
	const {relay} = createMockRelay();

	addShovelListener("fetch", (event: any) => {
		const ws = event.upgradeWebSocket();
		ws.subscribe("room:lobby");
	});

	let closeSeen: {
		id: string;
		code: number;
		reason: string;
		wasClean: boolean;
	} | null = null;
	addShovelListener("websocketclose", (event: any) => {
		closeSeen = {
			id: event.id,
			code: event.code,
			reason: event.reason,
			wasClean: event.wasClean,
		};
	});

	const request = new Request("http://localhost/ws", {
		headers: {Upgrade: "websocket"},
	});
	const {event} = await dispatchFetchEvent(registration, request, {
		wsRelay: relay,
	});
	const conn = event[kGetUpgradeResult]()!;

	await dispatchWebSocketClose(registration, conn, 1000, "done", true);

	expect(closeSeen).not.toBeNull();
	expect(closeSeen!.id).toBe(conn.id);
	expect(closeSeen!.code).toBe(1000);
	expect(closeSeen!.wasClean).toBe(true);

	// After release, state should show no subscribed channels
	const state = conn[kGetConnectionState]();
	expect(state.subscribedChannels).toEqual([]);
});

test("subscribe routes BroadcastChannel messages to the connection", async () => {
	const registration = await setupScope();
	const {relay, sends} = createMockRelay();

	addShovelListener("fetch", (event: any) => {
		const ws = event.upgradeWebSocket();
		ws.subscribe("room:lobby");
	});

	const request = new Request("http://localhost/ws", {
		headers: {Upgrade: "websocket"},
	});
	const {event} = await dispatchFetchEvent(registration, request, {
		wsRelay: relay,
	});
	const conn = event[kGetUpgradeResult]()!;

	// Publish from a different BC instance (simulates cross-handler fanout)
	const publisher = new ShovelBroadcastChannel("room:lobby");
	publisher.postMessage("hello room");

	// BC delivery is queued via queueMicrotask; wait a tick
	await new Promise((r) => setTimeout(r, 0));

	expect(sends).toEqual([{id: conn.id, data: "hello room"}]);
});

test("unsubscribe stops BC forwarding", async () => {
	const registration = await setupScope();
	const {relay, sends} = createMockRelay();

	addShovelListener("fetch", (event: any) => {
		const ws = event.upgradeWebSocket();
		ws.subscribe("room:lobby");
		ws.unsubscribe("room:lobby");
	});

	const request = new Request("http://localhost/ws", {
		headers: {Upgrade: "websocket"},
	});
	await dispatchFetchEvent(registration, request, {wsRelay: relay});

	const publisher = new ShovelBroadcastChannel("room:lobby");
	publisher.postMessage("nobody should see this");
	await new Promise((r) => setTimeout(r, 0));

	expect(sends).toEqual([]);
});

test("connection state round-trips subscribed channels for hibernation", async () => {
	const {relay} = createMockRelay();
	const conn1 = new ShovelWebSocketConnection({
		id: "conn-1",
		url: "http://localhost/ws",
		relay,
	});
	conn1.subscribe("room:lobby");
	conn1.subscribe(`user:alice`);

	const state = conn1[kGetConnectionState]();
	expect(state.id).toBe("conn-1");
	expect(state.subscribedChannels.sort()).toEqual(["room:lobby", "user:alice"]);

	// Simulate rehydration: construct a fresh connection with the stored state
	const {relay: relay2, sends} = createMockRelay();
	const conn2 = new ShovelWebSocketConnection({
		id: state.id,
		url: state.url,
		relay: relay2,
		subscribedChannels: state.subscribedChannels,
	});

	// Publishing on a rehydrated channel should reach conn2
	const publisher = new ShovelBroadcastChannel("room:lobby");
	publisher.postMessage("still listening");
	await new Promise((r) => setTimeout(r, 0));
	expect(sends).toEqual([{id: "conn-1", data: "still listening"}]);

	// conn1 also still forwards (it was never torn down)
	conn1._releaseSubscriptions();
	conn2._releaseSubscriptions();
});

test("send/close become no-ops after close", async () => {
	const {relay, sends, closes} = createMockRelay();
	const conn = new ShovelWebSocketConnection({
		id: "c1",
		url: "http://localhost/ws",
		relay,
	});
	conn.close(1000, "bye");
	conn.close(1001, "ignored");
	conn.send("should not arrive");
	expect(sends).toEqual([]);
	expect(closes).toEqual([{id: "c1", code: 1000, reason: "bye"}]);
});
