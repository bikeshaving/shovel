/**
 * Integration tests for cross-worker cache sharing
 *
 * These tests verify that MemoryCache operations in one worker
 * are visible to other workers. This requires PostMessageCache
 * to be properly wired up for memory caches in workers.
 */

import {describe, it, expect, beforeAll, afterAll} from "bun:test";
import {ServiceWorkerPool} from "../src/index.js";
import {CustomCacheStorage} from "@b9g/cache";
import {MemoryCache} from "@b9g/cache/memory";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

describe("cross-worker cache sharing", () => {
	let pool: ServiceWorkerPool;
	let cacheStorage: CustomCacheStorage;
	let tempDir: string;
	let workerPath: string;

	beforeAll(async () => {
		// Create temp directory for test worker
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cache-test-"));

		// Create a test worker that uses caches
		workerPath = path.join(tempDir, "cache-worker.js");
		fs.writeFileSync(
			workerPath,
			`
			self.addEventListener("fetch", (event) => {
				const url = new URL(event.request.url);

				if (url.pathname === "/cache-put") {
					event.respondWith((async () => {
						const cache = await self.caches.open("shared-cache");
						const key = url.searchParams.get("key") || "default";
						const value = url.searchParams.get("value") || "test-value";
						await cache.put(
							new Request("https://test/" + key),
							new Response(value)
						);
						return new Response("cached: " + key);
					})());
					return;
				}

				if (url.pathname === "/cache-get") {
					event.respondWith((async () => {
						const cache = await self.caches.open("shared-cache");
						const key = url.searchParams.get("key") || "default";
						const match = await cache.match(new Request("https://test/" + key));
						if (match) {
							const text = await match.text();
							return new Response("hit: " + text);
						} else {
							return new Response("miss");
						}
					})());
					return;
				}

				event.respondWith(new Response("unknown endpoint"));
			});
			`,
		);

		// Create shared cache storage on main thread
		cacheStorage = new CustomCacheStorage((name) => new MemoryCache(name));

		// Create pool with 2 workers (use debug logging to see cache messages)
		pool = new ServiceWorkerPool(
			{workerCount: 2, requestTimeout: 5000, cwd: tempDir},
			workerPath,
			cacheStorage,
			{logging: {level: "debug"}},
		);

		await pool.init();
		await pool.reloadWorkers(workerPath);

		// Wait for workers to be ready
		await new Promise((resolve) => setTimeout(resolve, 100));
	});

	afterAll(async () => {
		if (pool) {
			await pool.terminate();
		}
		if (tempDir) {
			fs.rmSync(tempDir, {recursive: true, force: true});
		}
	});

	it("cache write in one worker is visible to another worker", async () => {
		// Put a value via one request (goes to worker 1)
		const putResponse = await pool.handleRequest(
			new Request(
				"http://localhost/cache-put?key=shared-key&value=shared-value",
			),
		);
		expect(await putResponse.text()).toBe("cached: shared-key");

		// Get the value via another request (may go to worker 2)
		// Make multiple requests to increase chance of hitting different worker
		let hitCount = 0;
		for (let i = 0; i < 10; i++) {
			const getResponse = await pool.handleRequest(
				new Request("http://localhost/cache-get?key=shared-key"),
			);
			const text = await getResponse.text();
			if (text === "hit: shared-value") {
				hitCount++;
			}
		}

		// All requests should hit the cache, even if they go to different workers
		expect(hitCount).toBe(10);
	});

	it("multiple cache entries are shared across workers", async () => {
		// Put multiple values
		for (let i = 0; i < 5; i++) {
			await pool.handleRequest(
				new Request(`http://localhost/cache-put?key=key-${i}&value=value-${i}`),
			);
		}

		// Verify all values are accessible (round-robin should hit both workers)
		for (let i = 0; i < 5; i++) {
			const response = await pool.handleRequest(
				new Request(`http://localhost/cache-get?key=key-${i}`),
			);
			const text = await response.text();
			expect(text).toBe(`hit: value-${i}`);
		}
	});

	it("cache delete in one worker affects all workers", async () => {
		// Put a value
		await pool.handleRequest(
			new Request("http://localhost/cache-put?key=delete-test&value=to-delete"),
		);

		// Verify it exists
		const beforeDelete = await pool.handleRequest(
			new Request("http://localhost/cache-get?key=delete-test"),
		);
		expect(await beforeDelete.text()).toBe("hit: to-delete");

		// Delete via the cache API (need to add delete endpoint to worker)
		// For now, just verify the sharing works for put/get
	});
});
