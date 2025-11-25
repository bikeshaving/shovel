import {test, expect, beforeEach, afterEach} from "bun:test";
import * as FS from "fs/promises";
import {tmpdir} from "os";
import {join} from "path";
import {SingleThreadedRuntime} from "../src/single-threaded.js";
import {CustomCacheStorage} from "@b9g/cache";
import {MemoryCache} from "@b9g/cache/memory.js";
import {CustomBucketStorage} from "@b9g/filesystem";
import {NodeBucket} from "@b9g/filesystem/node.js";

/**
 * SingleThreadedRuntime tests
 *
 * These tests verify that the SingleThreadedRuntime correctly sets up
 * buckets and caches for ServiceWorker code running in the main thread.
 *
 * Key invariants:
 * 1. self.buckets.open() must work (this was previously broken!)
 * 2. self.caches.open() must work with direct CacheStorage (no PostMessageCache)
 * 3. Both APIs must be available to fetch handlers
 */

const TIMEOUT = 5000;

// Helper functions
async function createTempDir(prefix = "single-threaded-test-") {
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

async function createBucketStorage(
	tempDir: string,
): Promise<CustomBucketStorage> {
	return new CustomBucketStorage(async (name: string) => {
		const targetPath = join(tempDir, name);
		await FS.mkdir(targetPath, {recursive: true});
		return new NodeBucket(targetPath);
	});
}

// Store original globalThis values to restore after tests
let originalSelf: typeof globalThis.self;
let originalCaches: typeof globalThis.caches;
let originalBuckets: typeof globalThis.buckets;
let originalAddEventListener: typeof globalThis.addEventListener;

beforeEach(() => {
	// Save originals
	originalSelf = globalThis.self;
	originalCaches = globalThis.caches;
	originalBuckets = globalThis.buckets;
	originalAddEventListener = globalThis.addEventListener;
});

afterEach(() => {
	// Restore originals
	(globalThis as any).self = originalSelf;
	(globalThis as any).caches = originalCaches;
	(globalThis as any).buckets = originalBuckets;
	(globalThis as any).addEventListener = originalAddEventListener;
});

// ======================
// BUCKET TESTS
// ======================

test(
	"SingleThreadedRuntime provides self.buckets",
	async () => {
		const tempDir = await createTempDir();

		try {
			const cacheStorage = createCacheStorage();
			const bucketStorage = await createBucketStorage(tempDir);

			const runtime = new SingleThreadedRuntime({
				baseDir: tempDir,
				cacheStorage,
				bucketStorage,
			});

			await runtime.init();

			// After init, self.buckets should be available
			expect(globalThis.buckets).toBeDefined();
			expect(typeof globalThis.buckets.open).toBe("function");
		} finally {
			await cleanup([tempDir]);
		}
	},
	TIMEOUT,
);

test(
	"SingleThreadedRuntime self.buckets.open() works correctly",
	async () => {
		const tempDir = await createTempDir();

		try {
			const cacheStorage = createCacheStorage();
			const bucketStorage = await createBucketStorage(tempDir);

			const runtime = new SingleThreadedRuntime({
				baseDir: tempDir,
				cacheStorage,
				bucketStorage,
			});

			await runtime.init();

			// This is the exact call that was failing before the fix!
			const staticBucket = await globalThis.buckets.open("static");

			expect(staticBucket).toBeDefined();
			expect(staticBucket.kind).toBe("directory");
			expect(staticBucket.name).toBe("static");

			// Verify directory was created
			const dirExists = await FS.access(join(tempDir, "static"))
				.then(() => true)
				.catch(() => false);
			expect(dirExists).toBe(true);
		} finally {
			await cleanup([tempDir]);
		}
	},
	TIMEOUT,
);

test(
	"SingleThreadedRuntime buckets can read/write files",
	async () => {
		const tempDir = await createTempDir();

		try {
			// Pre-create a test file
			const staticDir = join(tempDir, "static");
			await FS.mkdir(staticDir, {recursive: true});
			await FS.writeFile(join(staticDir, "test.txt"), "Hello from bucket!");

			const cacheStorage = createCacheStorage();
			const bucketStorage = await createBucketStorage(tempDir);

			const runtime = new SingleThreadedRuntime({
				baseDir: tempDir,
				cacheStorage,
				bucketStorage,
			});

			await runtime.init();

			// Open bucket and read file
			const staticBucket = await globalThis.buckets.open("static");
			const fileHandle = await staticBucket.getFileHandle("test.txt");
			const file = await fileHandle.getFile();
			const content = await file.text();

			expect(content).toBe("Hello from bucket!");
		} finally {
			await cleanup([tempDir]);
		}
	},
	TIMEOUT,
);

// ======================
// CACHE TESTS
// ======================

test(
	"SingleThreadedRuntime provides self.caches",
	async () => {
		const tempDir = await createTempDir();

		try {
			const cacheStorage = createCacheStorage();
			const bucketStorage = await createBucketStorage(tempDir);

			const runtime = new SingleThreadedRuntime({
				baseDir: tempDir,
				cacheStorage,
				bucketStorage,
			});

			await runtime.init();

			// After init, self.caches should be available
			expect(globalThis.caches).toBeDefined();
			expect(typeof globalThis.caches.open).toBe("function");
		} finally {
			await cleanup([tempDir]);
		}
	},
	TIMEOUT,
);

test(
	"SingleThreadedRuntime self.caches.open() works correctly",
	async () => {
		const tempDir = await createTempDir();

		try {
			const cacheStorage = createCacheStorage();
			const bucketStorage = await createBucketStorage(tempDir);

			const runtime = new SingleThreadedRuntime({
				baseDir: tempDir,
				cacheStorage,
				bucketStorage,
			});

			await runtime.init();

			// Open a cache
			const cache = await globalThis.caches.open("test-cache");

			expect(cache).toBeDefined();
			expect(typeof cache.put).toBe("function");
			expect(typeof cache.match).toBe("function");
		} finally {
			await cleanup([tempDir]);
		}
	},
	TIMEOUT,
);

test(
	"SingleThreadedRuntime caches can store and retrieve responses",
	async () => {
		const tempDir = await createTempDir();

		try {
			const cacheStorage = createCacheStorage();
			const bucketStorage = await createBucketStorage(tempDir);

			const runtime = new SingleThreadedRuntime({
				baseDir: tempDir,
				cacheStorage,
				bucketStorage,
			});

			await runtime.init();

			// Use cache
			const cache = await globalThis.caches.open("test-cache");
			const request = new Request("http://localhost/test");
			const response = new Response("cached content", {
				headers: {"Content-Type": "text/plain"},
			});

			await cache.put(request, response);

			// Retrieve from cache
			const cachedResponse = await cache.match(request);

			expect(cachedResponse).toBeDefined();
			expect(await cachedResponse!.text()).toBe("cached content");
		} finally {
			await cleanup([tempDir]);
		}
	},
	TIMEOUT,
);

test(
	"SingleThreadedRuntime uses direct CacheStorage (not PostMessageCache)",
	async () => {
		const tempDir = await createTempDir();

		try {
			const cacheStorage = createCacheStorage();
			const bucketStorage = await createBucketStorage(tempDir);

			const runtime = new SingleThreadedRuntime({
				baseDir: tempDir,
				cacheStorage,
				bucketStorage,
			});

			await runtime.init();

			// The caches object should be the CustomCacheStorage directly
			// Not a PostMessageCache wrapper (which would have different behavior)
			// We can verify this by checking that it's the same instance
			expect(globalThis.caches).toBe(cacheStorage);
		} finally {
			await cleanup([tempDir]);
		}
	},
	TIMEOUT,
);

// ======================
// INTEGRATION TESTS
// ======================

test(
	"SingleThreadedRuntime creates buckets from factory when not provided",
	async () => {
		const tempDir = await createTempDir();
		// Create the static directory for well-known bucket convention
		const staticDir = join(tempDir, "../static");
		await FS.mkdir(staticDir, {recursive: true});

		try {
			const cacheStorage = createCacheStorage();

			// Create runtime WITHOUT bucketStorage - it will use factory
			const runtime = new SingleThreadedRuntime({
				baseDir: tempDir,
				cacheStorage,
				// bucketStorage intentionally omitted - factory will create it
			});

			await runtime.init();

			// self.buckets should be defined with open() method
			expect(globalThis.buckets).toBeDefined();
			expect(typeof globalThis.buckets.open).toBe("function");

			// Opening the well-known "static" bucket should work
			const bucket = await globalThis.buckets.open("static");
			expect(bucket).toBeDefined();
			expect(bucket.kind).toBe("directory");
		} finally {
			await cleanup([tempDir, staticDir]);
		}
	},
	TIMEOUT,
);

test(
	"SingleThreadedRuntime allows ServiceWorker to use both buckets and caches",
	async () => {
		const tempDir = await createTempDir();

		try {
			// Set up test file
			const staticDir = join(tempDir, "static");
			await FS.mkdir(staticDir, {recursive: true});
			await FS.writeFile(join(staticDir, "asset.txt"), "Original asset");

			const cacheStorage = createCacheStorage();
			const bucketStorage = await createBucketStorage(tempDir);

			const runtime = new SingleThreadedRuntime({
				baseDir: tempDir,
				cacheStorage,
				bucketStorage,
			});

			await runtime.init();

			// Simulate what ServiceWorker code would do:
			// 1. Check cache first
			// 2. If not in cache, read from bucket
			// 3. Store in cache for next time

			const cache = await globalThis.caches.open("assets");
			const request = new Request("http://localhost/asset.txt");

			// First request - should miss cache, read from bucket
			let response = await cache.match(request);
			expect(response).toBeUndefined();

			// Read from bucket
			const bucket = await globalThis.buckets.open("static");
			const fileHandle = await bucket.getFileHandle("asset.txt");
			const file = await fileHandle.getFile();
			const content = await file.text();

			// Create response and cache it
			response = new Response(content, {
				headers: {"Content-Type": "text/plain"},
			});
			await cache.put(request, response.clone());

			// Second request - should hit cache
			const cachedResponse = await cache.match(request);
			expect(cachedResponse).toBeDefined();
			expect(await cachedResponse!.text()).toBe("Original asset");
		} finally {
			await cleanup([tempDir]);
		}
	},
	TIMEOUT,
);
