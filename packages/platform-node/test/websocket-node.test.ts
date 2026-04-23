import {test, expect, afterEach} from "bun:test";
import * as HTTP from "node:http";
import WebSocket from "ws";
import {attachNodeWebSocketHandler} from "../src/websocket.js";
import {
	ShovelServiceWorkerRegistration,
	ServiceWorkerGlobals,
	ShovelBroadcastChannel,
	runLifecycle,
} from "@b9g/platform/runtime";

/**
 * End-to-end Node.js WebSocket tests. Spins up a real http.Server, installs
 * the Shovel upgrade handler, and drives it with the `ws` client.
 */

let server: HTTP.Server | null = null;
let cleanup: (() => Promise<void>) | null = null;
let port = 0;

afterEach(async () => {
	if (cleanup) await cleanup();
	cleanup = null;
	if (server) {
		const s = server;
		server = null;
		// Force-close any lingering connections so close() doesn't wait for
		// keep-alive timeouts.
		(s as any).closeAllConnections?.();
		await new Promise<void>((r) => s.close(() => r()));
	}
});

async function startServer(
	setupHandlers: (
		registration: ShovelServiceWorkerRegistration,
	) => void | Promise<void>,
): Promise<string> {
	// Reset globals between tests by removing any leftover listeners.
	for (const type of ["fetch", "websocketmessage", "websocketclose"]) {
		const existing = (globalThis as any)[`__wsNodeTest_${type}`] as
			| Array<EventListener>
			| undefined;
		if (existing) {
			for (const h of existing)
				(globalThis as any).removeEventListener(type, h);
		}
		(globalThis as any)[`__wsNodeTest_${type}`] = [];
	}

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
	await setupHandlers(registration);
	await runLifecycle(registration);

	server = HTTP.createServer((_req, res) => {
		// Handle non-upgrade requests with a default 404 (tests don't use these)
		res.statusCode = 404;
		res.end();
	});
	cleanup = attachNodeWebSocketHandler(server, registration);
	await new Promise<void>((r) => server!.listen(0, "127.0.0.1", () => r()));
	const addr = server!.address();
	port = typeof addr === "object" && addr ? addr.port : 0;
	return `ws://127.0.0.1:${port}`;
}

function addShovelListener(
	type: "fetch" | "websocketmessage" | "websocketclose",
	handler: EventListener,
): void {
	(globalThis as any).addEventListener(type, handler);
	((globalThis as any)[`__wsNodeTest_${type}`] as Array<EventListener>).push(
		handler,
	);
}

function connect(url: string): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(url);
		ws.once("open", () => resolve(ws));
		ws.once("error", reject);
	});
}

function waitForMessage(ws: WebSocket): Promise<string> {
	return new Promise((resolve) => {
		ws.once("message", (data) => resolve(data.toString("utf8")));
	});
}

function waitForClose(ws: WebSocket): Promise<{code: number; reason: string}> {
	return new Promise((resolve) => {
		ws.once("close", (code, reason) =>
			resolve({code, reason: reason.toString("utf8")}),
		);
	});
}

test("echo: handler sends data back to the sender", async () => {
	const url = await startServer((_registration) => {
		addShovelListener("fetch", (event: any) => {
			event.upgradeWebSocket();
		});
		addShovelListener("websocketmessage", (event: any) => {
			event.source.send(`echo: ${event.data}`);
		});
	});

	const ws = await connect(url);
	const messagePromise = waitForMessage(ws);
	ws.send("hello");
	expect(await messagePromise).toBe("echo: hello");
	ws.close();
	await waitForClose(ws);
}, 5000);

test("greeting: connection.send() during upgrade is delivered", async () => {
	const url = await startServer(() => {
		addShovelListener("fetch", (event: any) => {
			const ws = event.upgradeWebSocket();
			ws.send("welcome");
		});
	});

	const ws = await connect(url);
	expect(await waitForMessage(ws)).toBe("welcome");
	ws.close();
	await waitForClose(ws);
}, 5000);

test("close-during-upgrade: handler calls conn.close, client sees close frame", async () => {
	const url = await startServer(() => {
		addShovelListener("fetch", (event: any) => {
			const ws = event.upgradeWebSocket();
			ws.close(4001, "no access");
		});
	});

	const ws = await connect(url);
	const {code, reason} = await waitForClose(ws);
	expect(code).toBe(4001);
	expect(reason).toBe("no access");
}, 5000);

test("websocketclose fires with arrival code", async () => {
	const closeCodes: number[] = [];
	const url = await startServer(() => {
		addShovelListener("fetch", (event: any) => {
			event.upgradeWebSocket();
		});
		addShovelListener("websocketclose", (event: any) => {
			closeCodes.push(event.code);
		});
	});

	const ws = await connect(url);
	ws.close(1000, "client done");
	await waitForClose(ws);
	// Give the server a moment to process the close frame
	await new Promise((r) => setTimeout(r, 50));
	expect(closeCodes).toEqual([1000]);
}, 5000);

test("subscribe: BC publish routes to subscribed connection", async () => {
	const url = await startServer(() => {
		addShovelListener("fetch", (event: any) => {
			const ws = event.upgradeWebSocket();
			ws.subscribe("room:lobby");
		});
	});

	const ws = await connect(url);
	const messagePromise = waitForMessage(ws);

	// Give the connection a tick to fully establish
	await new Promise((r) => setTimeout(r, 20));

	const publisher = new ShovelBroadcastChannel("room:lobby");
	publisher.postMessage("broadcast");

	expect(await messagePromise).toBe("broadcast");
	ws.close();
	await waitForClose(ws);
}, 5000);

test("multiple clients: each gets its own id and receives its own messages", async () => {
	const url = await startServer(() => {
		addShovelListener("fetch", (event: any) => {
			event.upgradeWebSocket();
		});
		addShovelListener("websocketmessage", (event: any) => {
			event.source.send(`${event.source.id}:${event.data}`);
		});
	});

	const a = await connect(url);
	const b = await connect(url);

	const aMsg = waitForMessage(a);
	const bMsg = waitForMessage(b);
	a.send("hi");
	b.send("hello");
	const aReply = await aMsg;
	const bReply = await bMsg;

	// The id portion is a UUID, but we can assert structure
	expect(aReply).toMatch(/^[0-9a-f-]{36}:hi$/);
	expect(bReply).toMatch(/^[0-9a-f-]{36}:hello$/);
	// And different ids
	const aId = aReply.split(":")[0];
	const bId = bReply.split(":")[0];
	expect(aId).not.toBe(bId);

	a.close();
	b.close();
	await Promise.all([waitForClose(a), waitForClose(b)]);
}, 5000);

test("binary frame: ArrayBuffer round-trips", async () => {
	const url = await startServer(() => {
		addShovelListener("fetch", (event: any) => {
			event.upgradeWebSocket();
		});
		addShovelListener("websocketmessage", (event: any) => {
			// Echo the binary payload verbatim
			event.source.send(event.data);
		});
	});

	const ws = await connect(url);
	ws.binaryType = "arraybuffer";
	const received = new Promise<ArrayBuffer>((resolve) => {
		ws.once("message", (data) => {
			// ws gives Node Buffer or ArrayBuffer depending on binaryType
			if (data instanceof ArrayBuffer) resolve(data);
			else resolve(new Uint8Array(data as Buffer).buffer as ArrayBuffer);
		});
	});
	const payload = new Uint8Array([1, 2, 3, 4, 5]);
	ws.send(payload);
	const got = await received;
	expect(new Uint8Array(got)).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
	ws.close();
	await waitForClose(ws);
}, 5000);
