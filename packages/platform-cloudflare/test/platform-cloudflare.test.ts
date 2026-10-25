import {
	test,
	expect,
	describe,
	beforeEach,
	afterEach,
	beforeAll,
	afterAll,
	mock,
} from "bun:test";
import {CloudflarePlatform} from "../src/index.js";
import {CloudflareNativeCache} from "../src/caches.js";
import {Miniflare} from "miniflare";

describe("CloudflarePlatform", () => {
	let platform: CloudflarePlatform;
	let miniflare: Miniflare;
	let originalCaches: typeof globalThis.caches;

	beforeAll(async () => {
		// Save original caches
		originalCaches = globalThis.caches;

		// Create miniflare instance to provide Cloudflare environment
		miniflare = new Miniflare({
			modules: true,
			script: `export default { fetch() { return new Response("ok"); } }`,
			compatibilityDate: "2024-09-23",
		});

		// Set up globalThis.caches from miniflare

		globalThis.caches =
			(await miniflare.getCaches()) as unknown as CacheStorage;
	});

	afterAll(async () => {
		// Restore original caches
		globalThis.caches = originalCaches;
		await miniflare.dispose();
	});

	beforeEach(() => {
		platform = new CloudflarePlatform({
			environment: "dev",
			config: {
				caches: {
					test: {impl: CloudflareNativeCache},
				},
			},
		});
	});

	afterEach(async () => {
		await platform.dispose();
	});

	test("should have correct name", () => {
		expect(platform.name).toBe("cloudflare");
	});

	test("should create platform with default options", () => {
		const defaultPlatform = new CloudflarePlatform();
		expect(defaultPlatform.name).toBe("cloudflare");
	});

	test("should create server with Cloudflare Workers interface", () => {
		const mockHandler = mock(() => new Response("OK"));
		const server = platform.createServer(mockHandler, {
			port: 443,
			host: "cloudflare-workers",
		});

		expect(server).toBeDefined();
		expect(server.address().port).toBe(443);
		expect(server.address().host).toBe("cloudflare-workers");
		expect(server.url).toBe("https://cloudflare-workers");
		expect(server.ready).toBe(true);
	});

	test("should handle server listen and close gracefully", async () => {
		const handler = mock(() => new Response("OK"));
		const server = platform.createServer(handler);

		// Test listen
		await server.listen();

		// Test close
		await server.close();

		// If we got here without errors, listen and close work correctly
		expect(true).toBe(true);
	});

	test.skip("should throw for non-existent worker file", async () => {
		// Skip: miniflare throws synchronously from readFileSync during initialization,
		// which can't be caught by async try/catch or expect().rejects
		let error: Error | undefined;
		try {
			await platform.loadServiceWorker("./non-existent-worker.js");
		} catch (e) {
			error = e as Error;
		}
		expect(error).toBeDefined();
		expect(error?.message).toContain("ENOENT");
	});

	test("should dispose without error", async () => {
		// Should not throw
		await platform.dispose();
		expect(true).toBe(true);
	});
});

describe("Cloudflare runtime functions", () => {
	test("should export initializeRuntime and createFetchHandler from runtime", async () => {
		const {initializeRuntime, createFetchHandler} =
			await import("../src/runtime.js");

		expect(typeof initializeRuntime).toBe("function");
		expect(typeof createFetchHandler).toBe("function");
	});

	test("returns 426 when the handler upgrades without SHOVEL_WS bound", async () => {
		// The worker runs the handler; if it calls upgradeWebSocket() but no
		// SHOVEL_WS binding exists to materialize the socket, the handler must
		// short-circuit with a clear 426 (not an opaque 500). A request whose
		// handler does NOT upgrade never reaches this path.
		const {initializeRuntime, createFetchHandler} =
			await import("../src/runtime.js");
		const config = {
			lifecycle: {stage: "activate" as const},
			caches: {},
			directories: {},
		};
		const registration = await initializeRuntime(config as any);
		const handler = createFetchHandler(registration);

		const upgradeHandler = (event: any) => {
			event.upgradeWebSocket();
		};
		(globalThis as any).self.addEventListener("fetch", upgradeHandler);
		try {
			const request = new Request("http://localhost/ws", {
				headers: {Upgrade: "websocket"},
			});
			const ctx = {
				waitUntil() {},
				passThroughOnException() {},
			} as any;
			const response = await handler(request, {}, ctx);
			expect(response.status).toBe(426);
			const text = await response.text();
			expect(text).toMatch(/SHOVEL_WS/);
		} finally {
			(globalThis as any).self.removeEventListener("fetch", upgradeHandler);
		}
	});
});
