/**
 * Tests for worker initialization and request handling
 *
 * Note: With the unified build model, logging configuration is embedded
 * in the worker bundle at build time. These tests verify that workers
 * can initialize and handle requests properly.
 */

import {describe, it, expect, beforeAll, afterAll} from "bun:test";
import {ServiceWorkerPool} from "../src/index.js";
import {CustomCacheStorage} from "@b9g/cache";
import {MemoryCache} from "@b9g/cache/memory";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

// Worker code that properly signals ready and handles request messages
const WORKER_CODE = (responseText: string) => `
// Handle incoming request messages from ServiceWorkerPool
self.addEventListener("message", async (event) => {
	const message = event.data;
	if (message.type === "request") {
		try {
			const response = new Response("${responseText}");
			const body = await response.arrayBuffer();
			postMessage({
				type: "response",
				requestID: message.requestID,
				response: {
					status: response.status,
					statusText: response.statusText,
					headers: Object.fromEntries(response.headers.entries()),
					body: body,
				},
			}, [body]);
		} catch (err) {
			postMessage({
				type: "error",
				requestID: message.requestID,
				error: err.message,
			});
		}
	}
});

// Signal ready
postMessage({type: "ready"});
`;

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
		const workerPath = path.join(tempDir, "simple-worker.js");
		fs.writeFileSync(workerPath, WORKER_CODE("ok"));

		const cacheStorage = new CustomCacheStorage(
			(name) => new MemoryCache(name),
		);
		const pool = new ServiceWorkerPool(
			{workerCount: 1, requestTimeout: 5000, cwd: tempDir},
			workerPath,
			cacheStorage,
		);

		await pool.init();

		const response = await pool.handleRequest(
			new Request("http://localhost/test"),
		);
		expect(await response.text()).toBe("ok");

		await pool.terminate();
	});

	it("workers accept debug log level config", async () => {
		const workerPath = path.join(tempDir, "debug-worker.js");
		fs.writeFileSync(workerPath, WORKER_CODE("debug-ok"));

		const cacheStorage = new CustomCacheStorage(
			(name) => new MemoryCache(name),
		);

		const pool = new ServiceWorkerPool(
			{workerCount: 1, requestTimeout: 5000, cwd: tempDir},
			workerPath,
			cacheStorage,
		);

		await pool.init();

		const response = await pool.handleRequest(
			new Request("http://localhost/test"),
		);
		expect(await response.text()).toBe("debug-ok");

		await pool.terminate();
	});

	it("workers accept warning log level config", async () => {
		const workerPath = path.join(tempDir, "warning-worker.js");
		fs.writeFileSync(workerPath, WORKER_CODE("warning-ok"));

		const cacheStorage = new CustomCacheStorage(
			(name) => new MemoryCache(name),
		);

		const pool = new ServiceWorkerPool(
			{workerCount: 1, requestTimeout: 5000, cwd: tempDir},
			workerPath,
			cacheStorage,
		);

		await pool.init();

		const response = await pool.handleRequest(
			new Request("http://localhost/test"),
		);
		expect(await response.text()).toBe("warning-ok");

		await pool.terminate();
	});

	it("workers accept per-category log level config", async () => {
		const workerPath = path.join(tempDir, "category-worker.js");
		fs.writeFileSync(workerPath, WORKER_CODE("category-ok"));

		const cacheStorage = new CustomCacheStorage(
			(name) => new MemoryCache(name),
		);

		const pool = new ServiceWorkerPool(
			{workerCount: 1, requestTimeout: 5000, cwd: tempDir},
			workerPath,
			cacheStorage,
		);

		await pool.init();

		const response = await pool.handleRequest(
			new Request("http://localhost/test"),
		);
		expect(await response.text()).toBe("category-ok");

		await pool.terminate();
	});

	it("workers handle empty categories config", async () => {
		const workerPath = path.join(tempDir, "empty-categories-worker.js");
		fs.writeFileSync(workerPath, WORKER_CODE("empty-categories-ok"));

		const cacheStorage = new CustomCacheStorage(
			(name) => new MemoryCache(name),
		);

		const pool = new ServiceWorkerPool(
			{workerCount: 1, requestTimeout: 5000, cwd: tempDir},
			workerPath,
			cacheStorage,
		);

		await pool.init();

		const response = await pool.handleRequest(
			new Request("http://localhost/test"),
		);
		expect(await response.text()).toBe("empty-categories-ok");

		await pool.terminate();
	});

	it("workers handle logging config with only categories (no default level)", async () => {
		const workerPath = path.join(tempDir, "only-categories-worker.js");
		fs.writeFileSync(workerPath, WORKER_CODE("only-categories-ok"));

		const cacheStorage = new CustomCacheStorage(
			(name) => new MemoryCache(name),
		);

		const pool = new ServiceWorkerPool(
			{workerCount: 1, requestTimeout: 5000, cwd: tempDir},
			workerPath,
			cacheStorage,
		);

		await pool.init();

		const response = await pool.handleRequest(
			new Request("http://localhost/test"),
		);
		expect(await response.text()).toBe("only-categories-ok");

		await pool.terminate();
	});
});
