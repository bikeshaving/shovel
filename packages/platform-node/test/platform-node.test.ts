import {test, expect, describe, beforeEach, afterEach, mock} from "bun:test";
import {NodePlatform} from "../src/index.js";
import {tmpdir} from "os";
import {join} from "path";
import {mkdtempSync, rmSync} from "fs";

describe("NodePlatform", () => {
	let platform: NodePlatform;
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "node-platform-test-"));
		platform = new NodePlatform({
			cwd: tempDir,
		});
	});

	afterEach(async () => {
		await platform.dispose();
		try {
			rmSync(tempDir, {recursive: true, force: true});
		} catch {
			// Cleanup may fail in some environments
		}
	});

	test("should have correct name", () => {
		expect(platform.name).toBe("node");
	});

	test("should create platform with default options", () => {
		const defaultPlatform = new NodePlatform();
		expect(defaultPlatform.name).toBe("node");
		expect(defaultPlatform).toBeDefined();
	});

	test("should create HTTP server", async () => {
		const mockHandler = mock(() => Promise.resolve(new Response("OK")));
		const server = platform.createServer(mockHandler, {
			port: 8080,
			host: "127.0.0.1",
		});

		expect(server).toBeDefined();
		expect(server.address().port).toBe(8080);
		expect(server.address().host).toBe("127.0.0.1");
		expect(server.url).toBe("http://127.0.0.1:8080");
		expect(server.ready).toBe(false); // Not listening yet
	});

	test("should handle server listen and close", async () => {
		const handler = mock(() => Promise.resolve(new Response("OK")));
		const server = platform.createServer(handler, {
			port: 0, // Use random port
		});

		// Test listen
		await server.listen();
		expect(server.ready).toBe(true);

		// Test close
		await server.close();
		expect(server.ready).toBe(false);
	});

	test("should create custom cache storage", async () => {
		// Force main thread detection by ensuring self is undefined
		const originalSelf = (globalThis as any).self;
		delete (globalThis as any).self;

		const cacheStorage = await platform.createCaches();
		expect(cacheStorage).toBeDefined();

		// Test cache creation (should use MemoryCache in main thread)
		const cache = await cacheStorage.open("test");
		expect(cache).toBeDefined();

		// Restore original
		if (originalSelf !== undefined) {
			(globalThis as any).self = originalSelf;
		}
	});

	test("should create cache storage with MemoryCache", async () => {
		// Platform should create cache storage that uses MemoryCache
		const caches = await platform.createCaches();
		expect(caches).toBeDefined();

		const cache = await caches.open("test");
		expect(cache).toBeDefined();

		// Test basic cache operations
		const req = new Request("http://example.com/test");
		const res = new Response("test");
		await cache.put(req, res);

		const cached = await cache.match(req);
		expect(cached).toBeDefined();
		expect(await cached?.text()).toBe("test");
	});

	test("should reload workers", async () => {
		// Create a mock worker pool
		const mockWorkerPool = {
			reloadWorkers: mock(() => Promise.resolve()),
			terminate: mock(() => Promise.resolve()),
		};

		// Set the internal worker pool
		(platform as any).workerPool = mockWorkerPool;

		await platform.reloadWorkers("new-entrypoint.js");
		expect(mockWorkerPool.reloadWorkers).toHaveBeenCalledWith(
			"new-entrypoint.js",
		);
	});

	test("should dispose resources", async () => {
		// Create a mock worker pool
		const mockWorkerPool = {
			terminate: mock(() => Promise.resolve()),
		};

		// Set the internal worker pool
		(platform as any).workerPool = mockWorkerPool;

		await platform.dispose();
		expect(mockWorkerPool.terminate).toHaveBeenCalled();
		expect((platform as any).workerPool).toBeUndefined();
	});

	test("should convert Node.js request to Web API Request", async () => {
		const handler = mock((req: Request) => {
			expect(req).toBeInstanceOf(Request);
			expect(req.url).toContain("http://");
			return Promise.resolve(new Response("OK"));
		});

		const server = platform.createServer(handler, {port: 0, host: "127.0.0.1"});
		await server.listen();

		// Make a request to the server
		const port = server.address().port;
		const response = await fetch(`http://127.0.0.1:${port}/test`);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("OK");

		await server.close();
	});

	test("should handle POST requests with body", async () => {
		const handler = mock(async (req: Request) => {
			const body = await req.text();
			expect(body).toBe("test data");
			expect(req.method).toBe("POST");
			return new Response("Received");
		});

		const server = platform.createServer(handler, {port: 0, host: "127.0.0.1"});
		await server.listen();

		const port = server.address().port;
		const response = await fetch(`http://127.0.0.1:${port}/test`, {
			method: "POST",
			body: "test data",
		});
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("Received");

		await server.close();
	});

	test("should handle request errors gracefully", async () => {
		const handler = mock(() => {
			throw new Error("Handler error");
		});

		const server = platform.createServer(handler, {port: 0, host: "127.0.0.1"});
		await server.listen();

		const port = server.address().port;
		const response = await fetch(`http://127.0.0.1:${port}/test`);
		expect(response.status).toBe(500);
		expect(await response.text()).toBe("Internal Server Error");

		await server.close();
	});

	test("should stream response body", async () => {
		const handler = mock(() => {
			const stream = new ReadableStream({
				start(controller) {
					controller.enqueue(new TextEncoder().encode("chunk1"));
					controller.enqueue(new TextEncoder().encode("chunk2"));
					controller.close();
				},
			});
			return Promise.resolve(new Response(stream));
		});

		const server = platform.createServer(handler, {port: 0, host: "127.0.0.1"});
		await server.listen();

		const port = server.address().port;
		const response = await fetch(`http://127.0.0.1:${port}/test`);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("chunk1chunk2");

		await server.close();
	});

	test("should use custom port and host", () => {
		const customPlatform = new NodePlatform({
			port: 9090,
			host: "0.0.0.0",
		});

		expect((customPlatform as any).options.port).toBe(9090);
		expect((customPlatform as any).options.host).toBe("0.0.0.0");
	});

	test("should use custom cwd", () => {
		const customCwd = "/custom/path";
		const customPlatform = new NodePlatform({
			cwd: customCwd,
		});

		expect((customPlatform as any).options.cwd).toBe(customCwd);
	});

	describe("config integration", () => {
		test("createCaches should use config.caches settings", async () => {
			// BUG: createCaches() currently ignores config and always uses MemoryCache
			// It should respect shovel.json caches configuration

			// This test fails because NodePlatformOptions doesn't accept config
			// and createCaches() is hardcoded to always use MemoryCache
			const platformWithConfig = new NodePlatform({
				cwd: tempDir,
				// @ts-expect-error - config option doesn't exist yet
				config: {
					caches: {
						"test-cache": {provider: "memory", maxEntries: 100},
					},
				},
			});

			const caches = await platformWithConfig.createCaches();
			const cache = await caches.open("test-cache");

			// This will fail - config.caches settings are ignored
			// The cache exists but maxEntries from config was not applied
			expect((cache as any).maxEntries).toBe(100);
		});

		test("createDirectories should use config.directories settings", async () => {
			// BUG: createDirectories() currently ignores config and always uses NodeFSDirectory
			// It should respect shovel.json directories configuration

			// This test fails because NodePlatformOptions doesn't accept config
			// and createDirectories() is hardcoded to always use NodeFSDirectory
			const platformWithConfig = new NodePlatform({
				cwd: tempDir,
				// @ts-expect-error - config option doesn't exist yet
				config: {
					directories: {
						uploads: {provider: "memory"},
					},
				},
			});

			const directories = platformWithConfig.createDirectories(tempDir);
			const uploadsDir = await directories.open("uploads");

			// This will fail - config.directories settings are ignored
			// It creates NodeFSDirectory instead of MemoryDirectory
			expect(uploadsDir.constructor.name).toBe("MemoryDirectory");
		});
	});
});
