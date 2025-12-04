import {test, expect, describe, beforeEach, afterEach} from "bun:test";
import * as FS from "fs/promises";
import {tmpdir} from "os";
import {join} from "path";
import {ServiceWorkerPool} from "../src/index.js";
import {CustomCacheStorage} from "@b9g/cache";
import {MemoryCache} from "@b9g/cache/memory.js";

/**
 * Worker Error Handling Tests
 *
 * These tests verify that various types of errors in ServiceWorker code
 * are properly propagated back to the caller instead of being swallowed.
 *
 * Error types tested:
 * 1. ReferenceError - undefined variables
 * 2. SyntaxError (at runtime) - invalid imports
 * 3. TypeError - wrong types
 * 4. Import errors - non-existent modules
 * 5. Import errors - non-existent exports from existing modules
 */

const TIMEOUT = 10000;

async function createTempDir(prefix = "worker-error-test-") {
	const tempPath = join(
		tmpdir(),
		`${prefix}${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	await FS.mkdir(tempPath, {recursive: true});
	return tempPath;
}

async function cleanup(paths: string[]) {
	for (const path of paths) {
		try {
			await FS.rm(path, {recursive: true, force: true});
		} catch {
			// Already removed
		}
	}
}

function createCacheStorage(): CustomCacheStorage {
	return new CustomCacheStorage((name) => new MemoryCache(name));
}

describe("Worker Error Propagation", () => {
	let tempDir: string;
	let pool: ServiceWorkerPool | null = null;

	beforeEach(async () => {
		tempDir = await createTempDir();
	});

	afterEach(async () => {
		if (pool) {
			await pool.terminate();
			pool = null;
		}
		await cleanup([tempDir]);
	});

	test(
		"propagates ReferenceError from undefined variable at module load",
		async () => {
			// Create a ServiceWorker that references an undefined variable
			const entrypoint = join(tempDir, "app.js");
			await FS.writeFile(
				entrypoint,
				`
// This will throw ReferenceError: undefinedVariable is not defined
const x = undefinedVariable;

self.addEventListener("fetch", (event) => {
	event.respondWith(new Response("Hello"));
});
`,
			);

			const cacheStorage = createCacheStorage();
			pool = new ServiceWorkerPool(
				{workerCount: 1, requestTimeout: 5000, cwd: tempDir},
				entrypoint,
				cacheStorage,
				{},
			);

			await pool.init();

			// reloadWorkers should throw with the ReferenceError
			await expect(pool.reloadWorkers(entrypoint)).rejects.toThrow(
				/ReferenceError|undefinedVariable|not defined/,
			);
		},
		TIMEOUT,
	);

	test(
		"propagates TypeError from invalid operation at module load",
		async () => {
			// Create a ServiceWorker that causes a TypeError
			const entrypoint = join(tempDir, "app.js");
			await FS.writeFile(
				entrypoint,
				`
// This will throw TypeError: null is not a function
const fn = null;
fn();

self.addEventListener("fetch", (event) => {
	event.respondWith(new Response("Hello"));
});
`,
			);

			const cacheStorage = createCacheStorage();
			pool = new ServiceWorkerPool(
				{workerCount: 1, requestTimeout: 5000, cwd: tempDir},
				entrypoint,
				cacheStorage,
				{},
			);

			await pool.init();

			// reloadWorkers should throw with the TypeError
			await expect(pool.reloadWorkers(entrypoint)).rejects.toThrow(
				/TypeError|not a function|null/,
			);
		},
		TIMEOUT,
	);

	test(
		"propagates error from importing non-existent local module",
		async () => {
			// Create a ServiceWorker that imports a non-existent module
			const entrypoint = join(tempDir, "app.js");
			await FS.writeFile(
				entrypoint,
				`
import {foo} from "./does-not-exist.js";

self.addEventListener("fetch", (event) => {
	event.respondWith(new Response(foo()));
});
`,
			);

			const cacheStorage = createCacheStorage();
			pool = new ServiceWorkerPool(
				{workerCount: 1, requestTimeout: 5000, cwd: tempDir},
				entrypoint,
				cacheStorage,
				{},
			);

			await pool.init();

			// reloadWorkers should throw with module not found error
			await expect(pool.reloadWorkers(entrypoint)).rejects.toThrow(
				/does-not-exist|Cannot find|not found|resolve/i,
			);
		},
		TIMEOUT,
	);

	test(
		"propagates error from importing non-existent export from local module",
		async () => {
			// Create a helper module with specific exports
			const helperPath = join(tempDir, "helper.js");
			await FS.writeFile(
				helperPath,
				`
export const validExport = "hello";
`,
			);

			// Create a ServiceWorker that imports a non-existent export from it
			const entrypoint = join(tempDir, "app.js");
			await FS.writeFile(
				entrypoint,
				`
// This export doesn't exist in helper.js
import {thisExportDoesNotExist} from "./helper.js";

self.addEventListener("fetch", (event) => {
	event.respondWith(new Response(thisExportDoesNotExist));
});
`,
			);

			const cacheStorage = createCacheStorage();
			pool = new ServiceWorkerPool(
				{workerCount: 1, requestTimeout: 5000, cwd: tempDir},
				entrypoint,
				cacheStorage,
				{},
			);

			await pool.init();

			// reloadWorkers should throw with export not found error
			await expect(pool.reloadWorkers(entrypoint)).rejects.toThrow(
				/thisExportDoesNotExist|not found|does not provide|export/i,
			);
		},
		TIMEOUT,
	);

	test(
		"propagates error from throw statement at module level",
		async () => {
			// Create a ServiceWorker that throws at module load
			const entrypoint = join(tempDir, "app.js");
			await FS.writeFile(
				entrypoint,
				`
throw new Error("Intentional error at module level");

self.addEventListener("fetch", (event) => {
	event.respondWith(new Response("Hello"));
});
`,
			);

			const cacheStorage = createCacheStorage();
			pool = new ServiceWorkerPool(
				{workerCount: 1, requestTimeout: 5000, cwd: tempDir},
				entrypoint,
				cacheStorage,
				{},
			);

			await pool.init();

			// reloadWorkers should throw with the intentional error
			await expect(pool.reloadWorkers(entrypoint)).rejects.toThrow(
				/Intentional error at module level/,
			);
		},
		TIMEOUT,
	);

	test(
		"propagates error from async throw at top level",
		async () => {
			// Create a ServiceWorker with top-level await that throws
			const entrypoint = join(tempDir, "app.js");
			await FS.writeFile(
				entrypoint,
				`
// Top-level await with rejection
await Promise.reject(new Error("Async initialization failed"));

self.addEventListener("fetch", (event) => {
	event.respondWith(new Response("Hello"));
});
`,
			);

			const cacheStorage = createCacheStorage();
			pool = new ServiceWorkerPool(
				{workerCount: 1, requestTimeout: 5000, cwd: tempDir},
				entrypoint,
				cacheStorage,
				{},
			);

			await pool.init();

			// reloadWorkers should throw with the async error
			await expect(pool.reloadWorkers(entrypoint)).rejects.toThrow(
				/Async initialization failed/,
			);
		},
		TIMEOUT,
	);

	test(
		"propagates error when accessing undefined property of undefined",
		async () => {
			// Create a ServiceWorker that causes a TypeError from property access
			const entrypoint = join(tempDir, "app.js");
			await FS.writeFile(
				entrypoint,
				`
const obj = undefined;
const value = obj.property.nested; // TypeError: Cannot read properties of undefined

self.addEventListener("fetch", (event) => {
	event.respondWith(new Response(value));
});
`,
			);

			const cacheStorage = createCacheStorage();
			pool = new ServiceWorkerPool(
				{workerCount: 1, requestTimeout: 5000, cwd: tempDir},
				entrypoint,
				cacheStorage,
				{},
			);

			await pool.init();

			// reloadWorkers should throw with the TypeError
			await expect(pool.reloadWorkers(entrypoint)).rejects.toThrow(
				/TypeError|Cannot read|undefined/,
			);
		},
		TIMEOUT,
	);

	test(
		"successful load works after fixing errors",
		async () => {
			const entrypoint = join(tempDir, "app.js");

			// First, create a broken ServiceWorker
			await FS.writeFile(
				entrypoint,
				`
throw new Error("Initial error");
`,
			);

			const cacheStorage = createCacheStorage();
			pool = new ServiceWorkerPool(
				{workerCount: 1, requestTimeout: 5000, cwd: tempDir},
				entrypoint,
				cacheStorage,
				{},
			);

			await pool.init();

			// First load should fail
			await expect(pool.reloadWorkers(entrypoint)).rejects.toThrow(
				/Initial error/,
			);

			// Now fix the ServiceWorker - use a different filename for the fix
			const fixedEntrypoint = join(tempDir, "app-fixed.js");
			await FS.writeFile(
				fixedEntrypoint,
				`
self.addEventListener("fetch", (event) => {
	event.respondWith(new Response("Fixed!"));
});
`,
			);

			// Second load should succeed with new entrypoint
			await expect(
				pool.reloadWorkers(fixedEntrypoint),
			).resolves.toBeUndefined();

			// Pool should be ready
			expect(pool.ready).toBe(true);
		},
		TIMEOUT,
	);
});
