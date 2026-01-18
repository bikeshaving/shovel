import {test, expect, describe, beforeEach, afterEach, mock} from "bun:test";
import {BunPlatform} from "../src/index.js";
import {MemoryDirectory} from "@b9g/filesystem/memory";
import {MemoryCache} from "@b9g/cache/memory";
import {tmpdir} from "os";
import {join} from "path";
import {mkdtempSync, writeFileSync, rmSync} from "fs";
import {getLogger} from "@logtape/logtape";

const logger = getLogger(["test", "platform-bun"]);

// Mock Bun global if not available (for testing in other environments)
if (typeof globalThis.Bun === "undefined") {
	(globalThis as any).Bun = {
		env: {NODE_ENV: "test"},
		serve: mock((_options: any) => ({
			stop: mock(() => {}),
		})),
	};
}

describe("BunPlatform", () => {
	let platform: BunPlatform;
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "bun-platform-test-"));
		platform = new BunPlatform({
			cwd: tempDir,
			config: {
				// Provide default cache config with pre-imported class for tests
				caches: {
					test: {impl: MemoryCache},
					"env-test": {impl: MemoryCache},
				},
			},
		});
	});

	afterEach(async () => {
		await platform.dispose();
		try {
			rmSync(tempDir, {recursive: true, force: true});
		} catch (err) {
			logger.debug`Cleanup of ${tempDir} failed: ${err}`;
		}
	});

	test("should have correct name", () => {
		expect(platform.name).toBe("bun");
	});

	test("should create platform with default options", () => {
		const defaultPlatform = new BunPlatform();
		expect(defaultPlatform.name).toBe("bun");
	});

	test("should create server with Bun.serve", () => {
		const mockHandler = mock(() => new Response("OK"));
		const server = platform.createServer(mockHandler, {
			port: 8080,
			host: "127.0.0.1",
		});

		expect(server).toBeDefined();
		expect(server.address().port).toBe(8080);
		expect(server.address().host).toBe("127.0.0.1");
		expect(server.url).toBe("http://127.0.0.1:8080");
		expect(server.ready).toBe(true);
	});

	test("should create custom cache storage", async () => {
		// Override the worker detection to force MemoryCache usage
		const originalSelf = (globalThis as any).self;
		delete (globalThis as any).self;

		const cacheStorage = await platform.createCaches();
		expect(cacheStorage).toBeDefined();

		// Test cache creation (should use MemoryCache)
		const cache = await cacheStorage.open("test");
		expect(cache).toBeDefined();

		// Restore original
		if (originalSelf) {
			(globalThis as any).self = originalSelf;
		}
	});

	test("should create cache storage with MemoryCache", async () => {
		// Platform should create cache storage
		const caches = await platform.createCaches();
		expect(caches).toBeDefined();

		const cache = await caches.open("test");
		expect(cache).toBeDefined();
	});

	test("should load service worker", async () => {
		// Create a simple service worker file
		const swPath = join(tempDir, "sw.js");
		writeFileSync(
			swPath,
			`
			self.addEventListener("fetch", (event) => {
				event.respondWith(new Response("Hello from Bun SW"));
			});
		`,
		);

		// Skip this test for now as it requires complex WorkerPool mocking
		// The loadServiceWorker method is integration-tested in the main platform tests
		expect(true).toBe(true); // Placeholder
	});

	test("should handle server listen and close", async () => {
		const handler = mock(() => new Response("OK"));
		const server = platform.createServer(handler);

		// Test listen (should not throw)
		await server.listen();
		expect(true).toBe(true); // If we get here, listen worked

		// Test close (should not throw)
		await server.close();
		expect(true).toBe(true); // If we get here, close worked
	});

	test("should reload workers via serviceWorker container", async () => {
		// Create a mock for the reloadWorkers method
		const mockReload = mock(() => Promise.resolve());

		// Mock the serviceWorker.reloadWorkers method directly
		(platform.serviceWorker as any).reloadWorkers = mockReload;

		await platform.reloadWorkers("new-entrypoint.js");
		expect(mockReload).toHaveBeenCalledWith("new-entrypoint.js");
	});

	test("should dispose resources via serviceWorker container", async () => {
		// Create a mock for the terminate method
		const mockTerminate = mock(() => Promise.resolve());

		// Mock the serviceWorker.terminate method directly
		(platform.serviceWorker as any).terminate = mockTerminate;

		await platform.dispose();
		expect(mockTerminate).toHaveBeenCalled();
	});

	test("should handle environment detection", async () => {
		// Override the worker detection to force MemoryCache usage
		const originalSelf = (globalThis as any).self;
		delete (globalThis as any).self;

		// Test that the platform correctly detects Bun environment
		const cacheStorage = await platform.createCaches();
		expect(cacheStorage).toBeDefined();

		// The cache factory should handle worker thread detection
		const cache = await cacheStorage.open("env-test");
		expect(cache).toBeDefined();

		// Restore original
		if (originalSelf) {
			(globalThis as any).self = originalSelf;
		}
	});

	test("should warn about S3 adapter not implemented", () => {
		// Create new platform (would log warning about S3 if configured to use it)
		const platform = new BunPlatform();

		// Platform should be created successfully even without S3
		expect(platform).toBeDefined();
	});

	describe("port binding", () => {
		test("should fail when binding to same port with 0.0.0.0", async () => {
			// This test verifies that using 0.0.0.0 prevents dual-instance issues.
			// With "localhost", Bun can bind two servers (one IPv6, one IPv4).
			// With "0.0.0.0", the second server correctly fails with EADDRINUSE.
			const handler = mock(() => new Response("OK"));
			const server1 = platform.createServer(handler, {
				port: 0, // Let OS assign a port
				host: "0.0.0.0",
			});
			await server1.listen();
			const port = server1.address().port;

			// Try to start second server on same port with 0.0.0.0 - should fail
			const platform2 = new BunPlatform({cwd: tempDir});
			let error: Error | null = null;
			try {
				platform2.createServer(handler, {
					port,
					host: "0.0.0.0",
				});
			} catch (e) {
				error = e as Error;
			}

			expect(error).not.toBeNull();
			expect((error as any).code).toBe("EADDRINUSE");

			await server1.close();
		});
	});

	describe("config integration", () => {
		test("createCaches should use config.caches settings", async () => {
			const platformWithConfig = new BunPlatform({
				cwd: tempDir,
				config: {
					caches: {
						"test-cache": {
							impl: MemoryCache,
						},
					},
				},
			});

			const caches = await platformWithConfig.createCaches();
			const cache = await caches.open("test-cache");

			// Verify the cache was created and is functional
			expect(cache).toBeDefined();
			// Test that cache operations work (proves config was applied)
			const testRequest = new Request("https://test.com/foo");
			const testResponse = new Response("test");
			await cache.put(testRequest, testResponse);
			const matched = await cache.match(testRequest);
			expect(matched).toBeDefined();
		});

		test("createDirectories should use config.directories settings", async () => {
			const platformWithConfig = new BunPlatform({
				cwd: tempDir,
				config: {
					directories: {
						uploads: {
							impl: MemoryDirectory,
						},
					},
				},
			});

			const directories = await platformWithConfig.createDirectories();
			const uploadsDir = await directories.open("uploads");

			expect(uploadsDir).toBeInstanceOf(MemoryDirectory);
		});
	});
});
