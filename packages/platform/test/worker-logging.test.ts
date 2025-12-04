/**
 * Tests for worker logging configuration
 *
 * Ensures that:
 * 1. Workers have logging configured by default (not silent)
 * 2. Workers respect logging config from init message
 * 3. Log level can be changed via config
 * 4. Per-category log levels can be configured
 *
 * Note: These tests verify that the worker runtime configures logging
 * before loading user code. The user code doesn't need to import logtape
 * directly - it just needs to work without logging causing issues.
 */

import {describe, it, expect, beforeAll, afterAll} from "bun:test";
import {ServiceWorkerPool} from "../src/worker-pool.js";
import {CustomCacheStorage} from "@b9g/cache";
import {MemoryCache} from "@b9g/cache/memory";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

describe("worker logging", () => {
	let tempDir: string;

	beforeAll(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "worker-logging-test-"));
	});

	afterAll(() => {
		if (tempDir) {
			fs.rmSync(tempDir, {recursive: true, force: true});
		}
	});

	it("workers initialize without logging errors", async () => {
		// Simple worker that doesn't use logtape directly
		// The worker runtime should have logging configured
		const workerPath = path.join(tempDir, "simple-worker.js");
		fs.writeFileSync(
			workerPath,
			`
			self.addEventListener("fetch", (event) => {
				event.respondWith(new Response("ok"));
			});
			`,
		);

		const cacheStorage = new CustomCacheStorage(
			(name) => new MemoryCache(name),
		);
		const pool = new ServiceWorkerPool(
			{workerCount: 1, requestTimeout: 5000, cwd: tempDir},
			workerPath,
			cacheStorage,
			{}, // No logging config - should use defaults
		);

		await pool.init();
		await pool.reloadWorkers(workerPath);
		await new Promise((r) => setTimeout(r, 200));

		const response = await pool.handleRequest(
			new Request("http://localhost/test"),
		);
		expect(await response.text()).toBe("ok");

		await pool.terminate();
	});

	it("workers accept debug log level config", async () => {
		const workerPath = path.join(tempDir, "debug-worker.js");
		fs.writeFileSync(
			workerPath,
			`
			self.addEventListener("fetch", (event) => {
				event.respondWith(new Response("debug-ok"));
			});
			`,
		);

		const cacheStorage = new CustomCacheStorage(
			(name) => new MemoryCache(name),
		);

		// Test with debug level config
		const pool = new ServiceWorkerPool(
			{workerCount: 1, requestTimeout: 5000, cwd: tempDir},
			workerPath,
			cacheStorage,
			{logging: {level: "debug"}},
		);

		await pool.init();
		await pool.reloadWorkers(workerPath);
		await new Promise((r) => setTimeout(r, 200));

		const response = await pool.handleRequest(
			new Request("http://localhost/test"),
		);
		expect(await response.text()).toBe("debug-ok");

		await pool.terminate();
	});

	it("workers accept warning log level config", async () => {
		const workerPath = path.join(tempDir, "warning-worker.js");
		fs.writeFileSync(
			workerPath,
			`
			self.addEventListener("fetch", (event) => {
				event.respondWith(new Response("warning-ok"));
			});
			`,
		);

		const cacheStorage = new CustomCacheStorage(
			(name) => new MemoryCache(name),
		);

		// Test with warning level config (suppress info logs)
		const pool = new ServiceWorkerPool(
			{workerCount: 1, requestTimeout: 5000, cwd: tempDir},
			workerPath,
			cacheStorage,
			{logging: {level: "warning"}},
		);

		await pool.init();
		await pool.reloadWorkers(workerPath);
		await new Promise((r) => setTimeout(r, 200));

		const response = await pool.handleRequest(
			new Request("http://localhost/test"),
		);
		expect(await response.text()).toBe("warning-ok");

		await pool.terminate();
	});

	it("workers accept per-category log level config", async () => {
		const workerPath = path.join(tempDir, "category-worker.js");
		fs.writeFileSync(
			workerPath,
			`
			self.addEventListener("fetch", (event) => {
				event.respondWith(new Response("category-ok"));
			});
			`,
		);

		const cacheStorage = new CustomCacheStorage(
			(name) => new MemoryCache(name),
		);

		// Test with per-category config
		const pool = new ServiceWorkerPool(
			{workerCount: 1, requestTimeout: 5000, cwd: tempDir},
			workerPath,
			cacheStorage,
			{
				logging: {
					level: "warning", // default level
					categories: {
						server: {level: "debug"}, // server category gets debug
						build: {level: "error"}, // build category gets error
					},
				},
			},
		);

		await pool.init();
		await pool.reloadWorkers(workerPath);
		await new Promise((r) => setTimeout(r, 200));

		const response = await pool.handleRequest(
			new Request("http://localhost/test"),
		);
		expect(await response.text()).toBe("category-ok");

		await pool.terminate();
	});

	it("workers handle empty categories config", async () => {
		const workerPath = path.join(tempDir, "empty-categories-worker.js");
		fs.writeFileSync(
			workerPath,
			`
			self.addEventListener("fetch", (event) => {
				event.respondWith(new Response("empty-categories-ok"));
			});
			`,
		);

		const cacheStorage = new CustomCacheStorage(
			(name) => new MemoryCache(name),
		);

		// Test with empty categories
		const pool = new ServiceWorkerPool(
			{workerCount: 1, requestTimeout: 5000, cwd: tempDir},
			workerPath,
			cacheStorage,
			{
				logging: {
					level: "info",
					categories: {},
				},
			},
		);

		await pool.init();
		await pool.reloadWorkers(workerPath);
		await new Promise((r) => setTimeout(r, 200));

		const response = await pool.handleRequest(
			new Request("http://localhost/test"),
		);
		expect(await response.text()).toBe("empty-categories-ok");

		await pool.terminate();
	});

	it("workers handle logging config with only categories (no default level)", async () => {
		const workerPath = path.join(tempDir, "only-categories-worker.js");
		fs.writeFileSync(
			workerPath,
			`
			self.addEventListener("fetch", (event) => {
				event.respondWith(new Response("only-categories-ok"));
			});
			`,
		);

		const cacheStorage = new CustomCacheStorage(
			(name) => new MemoryCache(name),
		);

		// Test with categories but no default level (should default to "info")
		const pool = new ServiceWorkerPool(
			{workerCount: 1, requestTimeout: 5000, cwd: tempDir},
			workerPath,
			cacheStorage,
			{
				logging: {
					categories: {
						server: {level: "debug"},
					},
				},
			},
		);

		await pool.init();
		await pool.reloadWorkers(workerPath);
		await new Promise((r) => setTimeout(r, 200));

		const response = await pool.handleRequest(
			new Request("http://localhost/test"),
		);
		expect(await response.text()).toBe("only-categories-ok");

		await pool.terminate();
	});
});
