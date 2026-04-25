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
	const scope = new ServiceWorkerGlobals({
		registration,
		directories: {open: async (name: string) => ({name}) as any} as any,
		loggers: {get: () => console as any},
		caches: {
			async open() {
				return {} as any;
			},
			async has() {
				return false;
			},
			async delete() {
				return false;
			},
			async keys() {
				return [];
			},
			async match() {
				return undefined;
			},
		} as any,
	});
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

test("retained connection is inert after dispatchWebSocketClose", async () => {
	// Codex P2: dispatchWebSocketClose calls _releaseSubscriptions which
	// must mark the connection closed too — otherwise a user-retained
	// reference from upgradeWebSocket() can still send / subscribe and
	// recreate phantom subscriptions on a dead connection.
	const registration = await setupScope();
	const {relay, sends} = createMockRelay();

	let retained: ShovelWebSocketConnection | null =
		null as unknown as ShovelWebSocketConnection | null;
	addShovelListener("fetch", (event: any) => {
		retained = event.upgradeWebSocket();
	});

	const request = new Request("http://localhost/ws", {
		headers: {Upgrade: "websocket"},
	});
	const {event} = await dispatchFetchEvent(registration, request, {
		wsRelay: relay,
	});
	const conn = event[kGetUpgradeResult]()!;

	await dispatchWebSocketClose(registration, conn, 1000, "done", true);

	// The retained reference is the same object; everything must be inert
	expect(retained).toBe(conn);
	retained!.send("phantom");
	retained!.subscribe("phantom-channel");

	const publisher = new ShovelBroadcastChannel("phantom-channel");
	publisher.postMessage("should-not-deliver");
	await new Promise((r) => setTimeout(r, 0));

	expect(sends).toEqual([]);
	expect(retained![kGetConnectionState]().subscribedChannels).toEqual([]);
});

// ─── Regression tests ─────────────────────────────────────────────────────

test("subscribe is idempotent — duplicate subscribe is a no-op", async () => {
	const {relay, sends} = createMockRelay();
	const conn = new ShovelWebSocketConnection({
		id: "cdup",
		url: "http://localhost/ws",
		relay,
	});
	conn.subscribe("room:lobby");
	conn.subscribe("room:lobby"); // no-op
	conn.subscribe("room:lobby"); // no-op

	const publisher = new ShovelBroadcastChannel("room:lobby");
	publisher.postMessage("hi");
	await new Promise((r) => setTimeout(r, 0));

	// Exactly ONE forwarded message, not three
	expect(sends).toEqual([{id: "cdup", data: "hi"}]);
	conn._releaseSubscriptions();
});

test("unsubscribe from non-subscribed channel is a no-op", async () => {
	const {relay} = createMockRelay();
	const conn = new ShovelWebSocketConnection({
		id: "cnone",
		url: "http://localhost/ws",
		relay,
	});
	// Should not throw
	conn.unsubscribe("nowhere");
	conn.unsubscribe("also-nowhere");
	expect(conn[kGetConnectionState]().subscribedChannels).toEqual([]);
});

test("multi-channel subscription: messages route to correct channels", async () => {
	const {relay, sends} = createMockRelay();
	const conn = new ShovelWebSocketConnection({
		id: "cmulti",
		url: "http://localhost/ws",
		relay,
	});
	conn.subscribe("room:lobby");
	conn.subscribe("user:alice");

	const lobbyPub = new ShovelBroadcastChannel("room:lobby");
	const alicePub = new ShovelBroadcastChannel("user:alice");
	const otherPub = new ShovelBroadcastChannel("unrelated");

	lobbyPub.postMessage("lobby-message");
	alicePub.postMessage("alice-message");
	otherPub.postMessage("should-not-arrive");
	await new Promise((r) => setTimeout(r, 0));

	// Order within BC dispatch is microtask-queued; sort to compare
	const received = sends.map((s) => s.data).sort();
	expect(received).toEqual(["alice-message", "lobby-message"]);
	conn._releaseSubscriptions();
});

test("unsubscribe stops delivery while other channels keep working", async () => {
	const {relay, sends} = createMockRelay();
	const conn = new ShovelWebSocketConnection({
		id: "c-partial",
		url: "http://localhost/ws",
		relay,
	});
	conn.subscribe("room:a");
	conn.subscribe("room:b");
	conn.unsubscribe("room:a");

	new ShovelBroadcastChannel("room:a").postMessage("dropped");
	new ShovelBroadcastChannel("room:b").postMessage("delivered");
	await new Promise((r) => setTimeout(r, 0));

	expect(sends).toEqual([{id: "c-partial", data: "delivered"}]);
	conn._releaseSubscriptions();
});

test("non-string/ArrayBuffer BC messages are silently dropped (wire safety)", async () => {
	const {relay, sends} = createMockRelay();
	const conn = new ShovelWebSocketConnection({
		id: "cwire",
		url: "http://localhost/ws",
		relay,
	});
	conn.subscribe("room:typed");
	const pub = new ShovelBroadcastChannel("room:typed");
	// Structured-cloneable but not wire-safe for WebSocket
	pub.postMessage({type: "object", nested: {value: 42}});
	pub.postMessage([1, 2, 3]);
	pub.postMessage(null);
	// A valid one should still arrive
	pub.postMessage("valid string");
	await new Promise((r) => setTimeout(r, 0));

	expect(sends).toEqual([{id: "cwire", data: "valid string"}]);
	conn._releaseSubscriptions();
});

test("ArrayBuffer BC messages forward as binary frames", async () => {
	const {relay, sends} = createMockRelay();
	const conn = new ShovelWebSocketConnection({
		id: "cbin",
		url: "http://localhost/ws",
		relay,
	});
	conn.subscribe("room:bin");
	const pub = new ShovelBroadcastChannel("room:bin");
	const payload = new Uint8Array([0xde, 0xad, 0xbe, 0xef]).buffer;
	pub.postMessage(payload);
	await new Promise((r) => setTimeout(r, 0));

	expect(sends.length).toBe(1);
	expect(sends[0].id).toBe("cbin");
	expect(sends[0].data).toBeInstanceOf(ArrayBuffer);
	expect(new Uint8Array(sends[0].data as ArrayBuffer)).toEqual(
		new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
	);
	conn._releaseSubscriptions();
});

test("hibernation rehydration preserves all subscribed channels", async () => {
	const channels = [
		"room:a",
		"room:b",
		"room:c",
		`user:${crypto.randomUUID()}`,
	];
	const {relay} = createMockRelay();
	const original = new ShovelWebSocketConnection({
		id: "chy",
		url: "http://localhost/ws",
		relay,
	});
	for (const c of channels) original.subscribe(c);

	// Simulate attachment serialization → deserialization
	const state = original[kGetConnectionState]();
	expect(state.subscribedChannels.sort()).toEqual([...channels].sort());

	// Release original so it doesn't double-receive
	original._releaseSubscriptions();

	// Construct the rehydrated peer with the same state
	const {relay: relay2, sends} = createMockRelay();
	const rehydrated = new ShovelWebSocketConnection({
		id: state.id,
		url: state.url,
		relay: relay2,
		subscribedChannels: state.subscribedChannels,
	});

	// All channels should still deliver
	for (const c of channels) {
		new ShovelBroadcastChannel(c).postMessage(`from-${c}`);
	}
	await new Promise((r) => setTimeout(r, 0));

	const delivered = sends.map((s) => s.data).sort();
	expect(delivered).toEqual(channels.map((c) => `from-${c}`).sort());

	rehydrated._releaseSubscriptions();
});

test("close event dispatches once even if close() called multiple times", async () => {
	const registration = await setupScope();
	const {relay} = createMockRelay();

	let closeCount = 0;
	addShovelListener("fetch", (event: any) => {
		event.upgradeWebSocket();
	});
	addShovelListener("websocketclose", () => {
		closeCount++;
	});

	const request = new Request("http://localhost/ws", {
		headers: {Upgrade: "websocket"},
	});
	const {event} = await dispatchFetchEvent(registration, request, {
		wsRelay: relay,
	});
	const conn = event[kGetUpgradeResult]()!;

	await dispatchWebSocketClose(registration, conn, 1000, "bye", true);
	// Redundant close dispatches wouldn't happen from an adapter, but verify
	// the runtime's guard-based state model handles it gracefully.
	conn.close(1001, "ignored"); // no-op after already-closed
	expect(closeCount).toBe(1);
});

test("concurrent connections each get independent subscription state", async () => {
	const {relay: relayA, sends: sendsA} = createMockRelay();
	const {relay: relayB, sends: sendsB} = createMockRelay();
	const connA = new ShovelWebSocketConnection({
		id: "a",
		url: "http://localhost/ws",
		relay: relayA,
	});
	const connB = new ShovelWebSocketConnection({
		id: "b",
		url: "http://localhost/ws",
		relay: relayB,
	});

	connA.subscribe("room:shared");
	connB.subscribe("room:shared");
	connA.subscribe("room:only-a");
	connB.subscribe("room:only-b");

	new ShovelBroadcastChannel("room:shared").postMessage("broadcast");
	new ShovelBroadcastChannel("room:only-a").postMessage("a-only");
	new ShovelBroadcastChannel("room:only-b").postMessage("b-only");
	await new Promise((r) => setTimeout(r, 0));

	expect(sendsA.map((s) => s.data).sort()).toEqual(["a-only", "broadcast"]);
	expect(sendsB.map((s) => s.data).sort()).toEqual(["b-only", "broadcast"]);

	connA._releaseSubscriptions();
	connB._releaseSubscriptions();
});

test("onUpgrade fires synchronously (adapter phantom-cleanup contract)", async () => {
	// Contract: onUpgrade is invoked *during* upgradeWebSocket(), before the
	// handler returns or throws. Platform adapters rely on this so they can
	// clean up the connection from their registry even if the handler blows
	// up later in dispatch. The actual cleanup lives in the adapter; this
	// test just nails the contract for the runtime side.
	const registration = await setupScope();
	const {relay} = createMockRelay();

	const seen: Array<"before" | "onUpgrade" | "after"> = [];
	addShovelListener("fetch", (event: any) => {
		seen.push("before");
		event.upgradeWebSocket();
		seen.push("after");
	});

	const request = new Request("http://localhost/ws", {
		headers: {Upgrade: "websocket"},
	});
	await dispatchFetchEvent(registration, request, {
		wsRelay: relay,
		onUpgrade() {
			seen.push("onUpgrade");
		},
	});

	// onUpgrade fires between 'before' and 'after' — synchronously during
	// the upgradeWebSocket() call, not after the handler completes.
	expect(seen).toEqual(["before", "onUpgrade", "after"]);
});

test("subscribe/unsubscribe after close is ignored", async () => {
	const {relay} = createMockRelay();
	const conn = new ShovelWebSocketConnection({
		id: "clate",
		url: "http://localhost/ws",
		relay,
	});
	conn.close();
	conn.subscribe("after-close"); // should no-op (not subscribe)
	conn.unsubscribe("after-close");
	expect(conn[kGetConnectionState]().subscribedChannels).toEqual([]);
});

test("URL is exposed via connection state for hibernation inspection", async () => {
	const {relay} = createMockRelay();
	const url = "http://api.example.com/ws?token=abc";
	const conn = new ShovelWebSocketConnection({
		id: "curl",
		url,
		relay,
	});
	expect(conn.url).toBe(url);
	expect(conn[kGetConnectionState]().url).toBe(url);
});
