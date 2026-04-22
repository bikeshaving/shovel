import {test, expect, afterEach} from "bun:test";
import {createBunWebSocketServer} from "../src/websocket.js";
import {
	ShovelServiceWorkerRegistration,
	ServiceWorkerGlobals,
	ShovelBroadcastChannel,
	runLifecycle,
} from "@b9g/platform/runtime";

let server: any = null;
let cleanup: (() => Promise<void>) | null = null;

afterEach(async () => {
	if (cleanup) await cleanup();
	cleanup = null;
	if (server) {
		server.stop(true);
		server = null;
	}
});

async function startServer(
	setupHandlers: (
		registration: ShovelServiceWorkerRegistration,
	) => void | Promise<void>,
): Promise<string> {
	// Reset listeners between tests
	for (const type of ["fetch", "websocketmessage", "websocketclose"]) {
		const existing = (globalThis as any)[`__wsBunTest_${type}`] as
			| Array<EventListener>
			| undefined;
		if (existing) {
			for (const h of existing)
				(globalThis as any).removeEventListener(type, h);
		}
		(globalThis as any)[`__wsBunTest_${type}`] = [];
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

	const adapter = createBunWebSocketServer(registration);
	cleanup = adapter.cleanup;
	server = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		fetch: adapter.fetch,
		websocket: adapter.websocket,
	});
	return `ws://127.0.0.1:${server.port}`;
}

function addShovelListener(
	type: "fetch" | "websocketmessage" | "websocketclose",
	handler: EventListener,
): void {
	(globalThis as any).addEventListener(type, handler);
	(
		(globalThis as any)[`__wsBunTest_${type}`] as Array<EventListener>
	).push(handler);
}

function connect(url: string): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(url);
		ws.addEventListener("open", () => resolve(ws), {once: true});
		ws.addEventListener("error", (e) => reject(e), {once: true});
	});
}

function waitForMessage(ws: WebSocket): Promise<string | ArrayBuffer> {
	return new Promise((resolve) => {
		ws.addEventListener("message", (e) => resolve(e.data), {once: true});
	});
}

function waitForClose(
	ws: WebSocket,
): Promise<{code: number; reason: string}> {
	return new Promise((resolve) => {
		ws.addEventListener(
			"close",
			(e) => resolve({code: e.code, reason: e.reason}),
			{once: true},
		);
	});
}

test(
	"echo: handler sends data back to the sender",
	async () => {
		const url = await startServer(() => {
			addShovelListener("fetch", (event: any) => {
				event.upgradeWebSocket();
			});
			addShovelListener("websocketmessage", (event: any) => {
				event.source.send(`echo: ${event.data}`);
			});
		});

		const ws = await connect(url);
		const msg = waitForMessage(ws);
		ws.send("hello");
		expect(await msg).toBe("echo: hello");
		ws.close();
		await waitForClose(ws);
	},
	5000,
);

test(
	"greeting: connection.send() during upgrade is delivered",
	async () => {
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
	},
	5000,
);

test(
	"subscribe: BC publish routes to subscribed connection",
	async () => {
		const url = await startServer(() => {
			addShovelListener("fetch", (event: any) => {
				const ws = event.upgradeWebSocket();
				ws.subscribe("room:lobby");
			});
		});

		const ws = await connect(url);
		const msg = waitForMessage(ws);
		await new Promise((r) => setTimeout(r, 20));
		const publisher = new ShovelBroadcastChannel("room:lobby");
		publisher.postMessage("broadcast");
		expect(await msg).toBe("broadcast");
		ws.close();
		await waitForClose(ws);
	},
	5000,
);

test(
	"binary frame: ArrayBuffer round-trips",
	async () => {
		const url = await startServer(() => {
			addShovelListener("fetch", (event: any) => {
				event.upgradeWebSocket();
			});
			addShovelListener("websocketmessage", (event: any) => {
				event.source.send(event.data);
			});
		});

		const ws = await connect(url);
		ws.binaryType = "arraybuffer";
		const msg = waitForMessage(ws);
		ws.send(new Uint8Array([9, 8, 7, 6]));
		const got = await msg;
		expect(got).toBeInstanceOf(ArrayBuffer);
		expect(new Uint8Array(got as ArrayBuffer)).toEqual(
			new Uint8Array([9, 8, 7, 6]),
		);
		ws.close();
		await waitForClose(ws);
	},
	5000,
);

test(
	"websocketclose fires with arrival code",
	async () => {
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
		await new Promise((r) => setTimeout(r, 50));
		expect(closeCodes).toEqual([1000]);
	},
	5000,
);
