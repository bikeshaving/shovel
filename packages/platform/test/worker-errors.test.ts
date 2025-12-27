import {test, expect, describe, beforeEach, afterEach} from "bun:test";
import * as FS from "fs/promises";
import {tmpdir} from "os";
import {join} from "path";
import {ServiceWorkerPool} from "../src/index.js";
import {CustomCacheStorage} from "@b9g/cache";
import {MemoryCache} from "@b9g/cache/memory.js";
import {getLogger} from "@logtape/logtape";

const logger = getLogger(["test", "worker-errors"]);

/**
 * Worker Error Handling Tests
 *
 * These tests verify that various types of errors in ServiceWorker code
 * are properly propagated back to the caller instead of being swallowed.
 *
 * With the unified build model, workers are self-contained bundles.
 * We test error propagation by:
 * 1. Starting with a working worker
 * 2. Reloading with a broken worker file
 * 3. Verifying the error is properly propagated
 *
 * Error types tested:
 * 1. ReferenceError - undefined variables
 * 2. SyntaxError (at runtime) - invalid imports
 * 3. TypeError - wrong types
 * 4. Import errors - non-existent modules
 * 5. Import errors - non-existent exports from existing modules
 */

const TIMEOUT = 10000;

const GOOD_WORKER_CODE = `
self.addEventListener("fetch", (event) => {
	event.respondWith(new Response("Hello"));
});
postMessage({type: "ready"});
`;

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
		} catch (err) {
			logger.debug`Cleanup of ${path} failed: ${err}`;
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
			// Start with a working worker
			const goodEntrypoint = join(tempDir, "good.js");
			await FS.writeFile(goodEntrypoint, GOOD_WORKER_CODE);

			const cacheStorage = createCacheStorage();
			pool = new ServiceWorkerPool(
				{workerCount: 1, requestTimeout: 5000, cwd: tempDir},
				goodEntrypoint,
				cacheStorage,
			);
			await pool.init();

			// Create a broken worker file
			const badEntrypoint = join(tempDir, "bad.js");
			await FS.writeFile(
				badEntrypoint,
				`
// This will throw ReferenceError: undefinedVariable is not defined
const x = undefinedVariable;

self.addEventListener("fetch", (event) => {
	event.respondWith(new Response("Hello"));
});
`,
			);

			// reloadWorkers should throw with the ReferenceError
			await expect(pool.reloadWorkers(badEntrypoint)).rejects.toThrow(
				/ReferenceError|undefinedVariable|not defined/,
			);
		},
		TIMEOUT,
	);

	test(
		"propagates TypeError from invalid operation at module load",
		async () => {
			// Start with a working worker
			const goodEntrypoint = join(tempDir, "good.js");
			await FS.writeFile(goodEntrypoint, GOOD_WORKER_CODE);

			const cacheStorage = createCacheStorage();
			pool = new ServiceWorkerPool(
				{workerCount: 1, requestTimeout: 5000, cwd: tempDir},
				goodEntrypoint,
				cacheStorage,
			);
			await pool.init();

			// Create a broken worker file
			const badEntrypoint = join(tempDir, "bad.js");
			await FS.writeFile(
				badEntrypoint,
				`
// This will throw TypeError: null is not a function
const fn = null;
fn();

self.addEventListener("fetch", (event) => {
	event.respondWith(new Response("Hello"));
});
`,
			);

			// reloadWorkers should throw with the TypeError
			await expect(pool.reloadWorkers(badEntrypoint)).rejects.toThrow(
				/TypeError|not a function|null/,
			);
		},
		TIMEOUT,
	);

	test(
		"propagates error from importing non-existent local module",
		async () => {
			// Start with a working worker
			const goodEntrypoint = join(tempDir, "good.js");
			await FS.writeFile(goodEntrypoint, GOOD_WORKER_CODE);

			const cacheStorage = createCacheStorage();
			pool = new ServiceWorkerPool(
				{workerCount: 1, requestTimeout: 5000, cwd: tempDir},
				goodEntrypoint,
				cacheStorage,
			);
			await pool.init();

			// Create a broken worker file that imports non-existent module
			const badEntrypoint = join(tempDir, "bad.js");
			await FS.writeFile(
				badEntrypoint,
				`
import {foo} from "./does-not-exist.js";

self.addEventListener("fetch", (event) => {
	event.respondWith(new Response(foo()));
});
`,
			);

			// reloadWorkers should throw with module not found error
			await expect(pool.reloadWorkers(badEntrypoint)).rejects.toThrow(
				/does-not-exist|Cannot find|not found|resolve/i,
			);
		},
		TIMEOUT,
	);

	test(
		"propagates error from importing non-existent export from local module",
		async () => {
			// Start with a working worker
			const goodEntrypoint = join(tempDir, "good.js");
			await FS.writeFile(goodEntrypoint, GOOD_WORKER_CODE);

			const cacheStorage = createCacheStorage();
			pool = new ServiceWorkerPool(
				{workerCount: 1, requestTimeout: 5000, cwd: tempDir},
				goodEntrypoint,
				cacheStorage,
			);
			await pool.init();

			// Create a helper module with specific exports
			const helperPath = join(tempDir, "helper.js");
			await FS.writeFile(
				helperPath,
				`
export const validExport = "hello";
`,
			);

			// Create a broken worker file that imports non-existent export
			const badEntrypoint = join(tempDir, "bad.js");
			await FS.writeFile(
				badEntrypoint,
				`
// This export doesn't exist in helper.js
import {thisExportDoesNotExist} from "./helper.js";

self.addEventListener("fetch", (event) => {
	event.respondWith(new Response(thisExportDoesNotExist));
});
`,
			);

			// reloadWorkers should throw with export not found error
			await expect(pool.reloadWorkers(badEntrypoint)).rejects.toThrow(
				/thisExportDoesNotExist|not found|does not provide|export/i,
			);
		},
		TIMEOUT,
	);

	test(
		"propagates error from throw statement at module level",
		async () => {
			// Start with a working worker
			const goodEntrypoint = join(tempDir, "good.js");
			await FS.writeFile(goodEntrypoint, GOOD_WORKER_CODE);

			const cacheStorage = createCacheStorage();
			pool = new ServiceWorkerPool(
				{workerCount: 1, requestTimeout: 5000, cwd: tempDir},
				goodEntrypoint,
				cacheStorage,
			);
			await pool.init();

			// Create a broken worker file that throws at module load
			const badEntrypoint = join(tempDir, "bad.js");
			await FS.writeFile(
				badEntrypoint,
				`
throw new Error("Intentional error at module level");

self.addEventListener("fetch", (event) => {
	event.respondWith(new Response("Hello"));
});
`,
			);

			// reloadWorkers should throw with the intentional error
			await expect(pool.reloadWorkers(badEntrypoint)).rejects.toThrow(
				/Intentional error at module level/,
			);
		},
		TIMEOUT,
	);

	test(
		"propagates error from async throw at top level",
		async () => {
			// Start with a working worker
			const goodEntrypoint = join(tempDir, "good.js");
			await FS.writeFile(goodEntrypoint, GOOD_WORKER_CODE);

			const cacheStorage = createCacheStorage();
			pool = new ServiceWorkerPool(
				{workerCount: 1, requestTimeout: 5000, cwd: tempDir},
				goodEntrypoint,
				cacheStorage,
			);
			await pool.init();

			// Create a broken worker file with top-level await that throws
			const badEntrypoint = join(tempDir, "bad.js");
			await FS.writeFile(
				badEntrypoint,
				`
// Top-level await with rejection
await Promise.reject(new Error("Async initialization failed"));

self.addEventListener("fetch", (event) => {
	event.respondWith(new Response("Hello"));
});
`,
			);

			// reloadWorkers should throw with the async error
			await expect(pool.reloadWorkers(badEntrypoint)).rejects.toThrow(
				/Async initialization failed/,
			);
		},
		TIMEOUT,
	);

	test(
		"propagates error when accessing undefined property of undefined",
		async () => {
			// Start with a working worker
			const goodEntrypoint = join(tempDir, "good.js");
			await FS.writeFile(goodEntrypoint, GOOD_WORKER_CODE);

			const cacheStorage = createCacheStorage();
			pool = new ServiceWorkerPool(
				{workerCount: 1, requestTimeout: 5000, cwd: tempDir},
				goodEntrypoint,
				cacheStorage,
			);
			await pool.init();

			// Create a broken worker file that causes TypeError from property access
			const badEntrypoint = join(tempDir, "bad.js");
			await FS.writeFile(
				badEntrypoint,
				`
const obj = undefined;
const value = obj.property.nested; // TypeError: Cannot read properties of undefined

self.addEventListener("fetch", (event) => {
	event.respondWith(new Response(value));
});
`,
			);

			// reloadWorkers should throw with the TypeError
			await expect(pool.reloadWorkers(badEntrypoint)).rejects.toThrow(
				/TypeError|Cannot read|undefined/,
			);
		},
		TIMEOUT,
	);

	test(
		"successful load works after fixing errors",
		async () => {
			// Start with a working worker
			const goodEntrypoint = join(tempDir, "good.js");
			await FS.writeFile(goodEntrypoint, GOOD_WORKER_CODE);

			const cacheStorage = createCacheStorage();
			pool = new ServiceWorkerPool(
				{workerCount: 1, requestTimeout: 5000, cwd: tempDir},
				goodEntrypoint,
				cacheStorage,
			);
			await pool.init();

			// Create a broken worker file
			const badEntrypoint = join(tempDir, "bad.js");
			await FS.writeFile(
				badEntrypoint,
				`
throw new Error("Initial error");
`,
			);

			// First reload should fail
			await expect(pool.reloadWorkers(badEntrypoint)).rejects.toThrow(
				/Initial error/,
			);

			// Now create a fixed worker file
			const fixedEntrypoint = join(tempDir, "fixed.js");
			await FS.writeFile(
				fixedEntrypoint,
				`
self.addEventListener("fetch", (event) => {
	event.respondWith(new Response("Fixed!"));
});
postMessage({type: "ready"});
`,
			);

			// Second reload should succeed with new entrypoint
			await expect(
				pool.reloadWorkers(fixedEntrypoint),
			).resolves.toBeUndefined();

			// Pool should be ready
			expect(pool.ready).toBe(true);
		},
		TIMEOUT,
	);
});
