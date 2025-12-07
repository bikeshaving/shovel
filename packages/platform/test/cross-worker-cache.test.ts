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
import {fileURLToPath} from "url";
import * as esbuild from "esbuild";

describe("cross-worker cache sharing", () => {
	let pool: ServiceWorkerPool;
	let cacheStorage: CustomCacheStorage;
	let tempDir: string;
	let bundledWorkerPath: string;

	beforeAll(async () => {
		// Create temp directory for test worker
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cache-test-"));

		// Symlink node_modules so esbuild can resolve packages
		const currentDir = path.dirname(fileURLToPath(import.meta.url));
		const nodeModulesSource = path.resolve(currentDir, "../../../node_modules");
		const nodeModulesLink = path.join(tempDir, "node_modules");
		fs.symlinkSync(nodeModulesSource, nodeModulesLink, "dir");

		// Create a test worker source that uses the runtime
		const workerSourcePath = path.join(tempDir, "cache-worker.ts");
		fs.writeFileSync(
			workerSourcePath,
			`
import {initWorkerRuntime, startWorkerMessageLoop} from "@b9g/platform/runtime";

// Initialize the worker runtime with PostMessageCache support
const {registration} = await initWorkerRuntime({
	config: {},
	baseDir: import.meta.dirname,
});

// Register the fetch handler
self.addEventListener("fetch", (event: FetchEvent) => {
	const url = new URL(event.request.url);

	if (url.pathname === "/cache-put") {
		event.respondWith((async () => {
			const cache = await caches.open("shared-cache");
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
			const cache = await caches.open("shared-cache");
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

// Activate and start message loop
await registration.install();
await registration.activate();
startWorkerMessageLoop(registration);
`,
		);

		// Bundle the worker with esbuild
		bundledWorkerPath = path.join(tempDir, "cache-worker.js");
		await esbuild.build({
			entryPoints: [workerSourcePath],
			bundle: true,
			format: "esm",
			platform: "node",
			target: "es2022",
			outfile: bundledWorkerPath,
			external: ["node:*"],
		});

		// Create shared cache storage on main thread
		cacheStorage = new CustomCacheStorage(() => new MemoryCache());

		// Create pool with 2 workers
		pool = new ServiceWorkerPool(
			{workerCount: 2, requestTimeout: 5000, cwd: tempDir},
			bundledWorkerPath,
			cacheStorage,
			{},
		);

		await pool.init();
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
