import {test, expect} from "bun:test";
import {ServiceWorkerPool} from "../src/index.js";

/**
 * Pool-level WebSocket close-coordination contract:
 *
 * When the pool reloads or terminates with active pool-owned WebSocket
 * connections, it asks the platform to close each socket via
 * `WebSocketPoolHandlers.closeConnection`. The platform's actual close fires
 * back asynchronously via `pool.sendWebSocketClose`, which is what posts
 * `ws:close` to the owning worker. The pool MUST keep the
 * `wsConnectionOwners` map populated until that callback arrives — otherwise
 * `sendWebSocketClose` finds no owner and the worker never sees
 * `websocketclose`.
 */

interface Listener {
	(event: {data: any}): void;
}

class FakeWorker {
	received: any[];
	#listeners: Map<string, Set<Listener>>;
	#terminated: boolean;

	constructor() {
		this.received = [];
		this.#listeners = new Map();
		this.#terminated = false;
	}

	postMessage(msg: any, _transfer?: any[]): void {
		if (this.#terminated) return;
		this.received.push(msg);
	}

	addEventListener(type: string, listener: Listener): void {
		if (!this.#listeners.has(type)) this.#listeners.set(type, new Set());
		this.#listeners.get(type)!.add(listener);
	}

	removeEventListener(type: string, listener: Listener): void {
		this.#listeners.get(type)?.delete(listener);
	}

	terminate(): void {
		this.#terminated = true;
		this.received.push({type: "__terminated__"});
	}

	/** Simulate the worker posting a message back to the pool. */
	fireMessage(data: any): void {
		const ls = this.#listeners.get("message");
		if (!ls) return;
		for (const l of ls) l({data});
	}
}

async function buildPool(fakeWorker: FakeWorker) {
	const pool = new ServiceWorkerPool(
		{
			workerCount: 1,
			requestTimeout: 5000,
			createWorker: async () => {
				// Deliver "ready" on the next macrotask. queueMicrotask would
				// run before the pool's `addEventListener("message", …)` call
				// (those land in the createWorker continuation), so the ready
				// frame would be dropped and init() would hang.
				setTimeout(() => fakeWorker.fireMessage({type: "ready"}), 0);
				return fakeWorker as unknown as Worker;
			},
		},
		"<unused>",
	);
	await pool.init();
	return pool;
}

async function registerOwner(
	pool: ServiceWorkerPool,
	fakeWorker: FakeWorker,
	connectionID: string,
): Promise<void> {
	// Drive a real WS upgrade through the pool so it registers an owner via
	// the same code path production uses. The FakeWorker is told what
	// requestID to echo back by inspecting the request the pool posts.
	const upgradePromise = pool.handleUpgradeRequest(
		new Request("http://localhost/ws", {headers: {Upgrade: "websocket"}}),
	);
	// Wait one microtask cycle for the pool to post the request to the worker.
	await new Promise((r) => setTimeout(r, 0));
	const requestMsg = fakeWorker.received.find((m) => m.type === "request");
	if (!requestMsg) throw new Error("pool didn't dispatch request to worker");
	fakeWorker.fireMessage({
		type: "ws:upgrade",
		connectionID,
		requestID: requestMsg.requestID,
	});
	const result = await upgradePromise;
	if (!(result as any).upgrade) {
		throw new Error("expected upgrade result, got Response");
	}
}

test("terminate posts ws:close to the owning worker before tearing it down", async () => {
	const fakeWorker = new FakeWorker();
	const pool = await buildPool(fakeWorker);
	await registerOwner(pool, fakeWorker, "conn-1");

	// Mock platform WS handlers. closeConnection mimics the platform's real
	// behavior: it asks the underlying socket to close, and the socket's
	// (synchronously simulated) close fires back via pool.sendWebSocketClose.
	const closed: Array<{id: string; code: number; reason: string}> = [];
	pool.setWebSocketHandlers({
		sendFrame() {},
		closeConnection(id, code, reason) {
			const c = code ?? 1000;
			const r = reason ?? "";
			closed.push({id, code: c, reason: r});
			// Real platform adapters fire the close callback asynchronously
			// (the underlying socket's close event lands on a later tick).
			// The pool MUST NOT clear the owner map between closeConnection
			// and the async sendWebSocketClose, otherwise the close is
			// dropped and the worker never sees `websocketclose`.
			setTimeout(() => pool.sendWebSocketClose(id, c, r, true), 0);
		},
	});

	await pool.terminate();

	expect(closed).toEqual([
		{id: "conn-1", code: 1001, reason: "Server shutting down"},
	]);

	// Critical: the worker must have received ws:close before it was
	// terminated, so its websocketclose handler can run.
	const closeIdx = fakeWorker.received.findIndex(
		(m) => m.type === "ws:close" && m.connectionID === "conn-1",
	);
	const terminateIdx = fakeWorker.received.findIndex(
		(m) => m.type === "__terminated__",
	);
	expect(closeIdx).toBeGreaterThan(-1);
	expect(terminateIdx).toBeGreaterThan(-1);
	expect(closeIdx).toBeLessThan(terminateIdx);
	const closeMsg = fakeWorker.received[closeIdx];
	expect(closeMsg.code).toBe(1001);
	expect(closeMsg.reason).toBe("Server shutting down");
	expect(closeMsg.wasClean).toBe(true);
});

test("reload posts ws:close to active pool-owned connections", async () => {
	const fakeWorker = new FakeWorker();
	const pool = await buildPool(fakeWorker);
	await registerOwner(pool, fakeWorker, "conn-2");

	pool.setWebSocketHandlers({
		sendFrame() {},
		closeConnection(id, code, reason) {
			setTimeout(
				() => pool.sendWebSocketClose(id, code ?? 1000, reason ?? "", false),
				0,
			);
		},
	});

	// reloadWorkers calls #closePooledWebSockets first, then terminates and
	// recreates workers. The createWorker factory we registered on the pool
	// always returns the original fakeWorker, so the second creation will
	// succeed too — irrelevant to what this test asserts. We only care that
	// the close-pooled step delivers ws:close before workers are torn down.
	const reloadPromise = pool.reloadWorkers("<unused>").catch(() => {});

	// Give reload time to run the close-pooled step (synchronous) and the
	// async setTimeout that the mock platform uses to deliver the close.
	await new Promise((r) => setTimeout(r, 50));

	const closeMsg = fakeWorker.received.find(
		(m) => m.type === "ws:close" && m.connectionID === "conn-2",
	);
	expect(closeMsg).toBeDefined();
	expect(closeMsg.code).toBe(1012);
	expect(closeMsg.reason).toBe("Server reloading");

	await reloadPromise;
});
