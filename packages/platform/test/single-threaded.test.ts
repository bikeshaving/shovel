import {test, expect, beforeEach, afterEach} from "bun:test";
import * as FS from "fs/promises";
import {tmpdir} from "os";
import {join} from "path";
import {SingleThreadedRuntime, CustomLoggerStorage} from "../src/index.js";
import {CustomCacheStorage} from "@b9g/cache";
import {MemoryCache} from "@b9g/cache/memory.js";
import {CustomDirectoryStorage} from "@b9g/filesystem";
import {NodeFSDirectory} from "@b9g/filesystem/node-fs.js";
import {getLogger} from "@logtape/logtape";

const logger = getLogger(["test", "single-threaded"]);

/**
 * SingleThreadedRuntime tests
 *
 * These tests verify that the SingleThreadedRuntime correctly sets up
 * directories and caches for ServiceWorker code running in the main thread.
 *
 * Key invariants:
 * 1. self.directories.open() must work (this was previously broken!)
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
		} catch (err) {
			logger.debug`Cleanup of ${path} failed: ${err}`;
		}
	}
}

function createCacheStorage(): CustomCacheStorage {
	return new CustomCacheStorage((name) => new MemoryCache(name));
}

function createLoggerStorage(): CustomLoggerStorage {
	const mockLogger = {
		category: [] as string[],
		parent: null,
		getChild: () => mockLogger,
		with: () => mockLogger,
		debug: () => {},
		info: () => {},
		warn: () => {},
		error: () => {},
		fatal: () => {},
		trace: () => {},
	};
	return new CustomLoggerStorage(() => mockLogger as any);
}

async function createDirectoryStorage(
	tempDir: string,
): Promise<CustomDirectoryStorage> {
	return new CustomDirectoryStorage(async (name: string) => {
		const targetPath = join(tempDir, name);
		await FS.mkdir(targetPath, {recursive: true});
		return new NodeFSDirectory(targetPath);
	});
}

// Store original globalThis values to restore after tests
let originalSelf: typeof globalThis.self;
let originalCaches: typeof globalThis.caches;
let originalDirectories: typeof globalThis.directories;
let originalAddEventListener: typeof globalThis.addEventListener;

beforeEach(() => {
	// Save originals
	originalSelf = globalThis.self;
	originalCaches = globalThis.caches;
	originalDirectories = globalThis.directories;
	originalAddEventListener = globalThis.addEventListener;
});

afterEach(() => {
	// Restore originals
	(globalThis as any).self = originalSelf;
	(globalThis as any).caches = originalCaches;
	(globalThis as any).directories = originalDirectories;
	(globalThis as any).addEventListener = originalAddEventListener;
});

// ======================
// DIRECTORY TESTS
// ======================

test(
	"SingleThreadedRuntime provides self.directories",
	async () => {
		const tempDir = await createTempDir();

		try {
			const cacheStorage = createCacheStorage();
			const directoryStorage = await createDirectoryStorage(tempDir);

			const runtime = new SingleThreadedRuntime({
				caches: cacheStorage,
				directories: directoryStorage,
				loggers: createLoggerStorage(),
			});

			await runtime.init();

			// After init, self.directories should be available
			expect(globalThis.directories).toBeDefined();
			expect(typeof globalThis.directories.open).toBe("function");
		} finally {
			await cleanup([tempDir]);
		}
	},
	TIMEOUT,
);

test(
	"SingleThreadedRuntime self.directories.open() works correctly",
	async () => {
		const tempDir = await createTempDir();

		try {
			const cacheStorage = createCacheStorage();
			const directoryStorage = await createDirectoryStorage(tempDir);

			const runtime = new SingleThreadedRuntime({
				caches: cacheStorage,
				directories: directoryStorage,
				loggers: createLoggerStorage(),
			});

			await runtime.init();

			// This is the exact call that was failing before the fix!
			const publicDir = await globalThis.directories.open("public");

			expect(publicDir).toBeDefined();
			expect(publicDir.kind).toBe("directory");
			expect(publicDir.name).toBe("public");

			// Verify directory was created
			const dirExists = await FS.access(join(tempDir, "public"))
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
	"SingleThreadedRuntime directories can read/write files",
	async () => {
		const tempDir = await createTempDir();

		try {
			// Pre-create a test file
			const publicDir = join(tempDir, "public");
			await FS.mkdir(publicDir, {recursive: true});
			await FS.writeFile(join(publicDir, "test.txt"), "Hello from directory!");

			const cacheStorage = createCacheStorage();
			const directoryStorage = await createDirectoryStorage(tempDir);

			const runtime = new SingleThreadedRuntime({
				caches: cacheStorage,
				directories: directoryStorage,
				loggers: createLoggerStorage(),
			});

			await runtime.init();

			// Open directory and read file
			const publicDirectory = await globalThis.directories.open("public");
			const fileHandle = await publicDirectory.getFileHandle("test.txt");
			const file = await fileHandle.getFile();
			const content = await file.text();

			expect(content).toBe("Hello from directory!");
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
			const directoryStorage = await createDirectoryStorage(tempDir);

			const runtime = new SingleThreadedRuntime({
				caches: cacheStorage,
				directories: directoryStorage,
				loggers: createLoggerStorage(),
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
			const directoryStorage = await createDirectoryStorage(tempDir);

			const runtime = new SingleThreadedRuntime({
				caches: cacheStorage,
				directories: directoryStorage,
				loggers: createLoggerStorage(),
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
			const directoryStorage = await createDirectoryStorage(tempDir);

			const runtime = new SingleThreadedRuntime({
				caches: cacheStorage,
				directories: directoryStorage,
				loggers: createLoggerStorage(),
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
			const directoryStorage = await createDirectoryStorage(tempDir);

			const runtime = new SingleThreadedRuntime({
				caches: cacheStorage,
				directories: directoryStorage,
				loggers: createLoggerStorage(),
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
	"SingleThreadedRuntime correctly installs directories on globalThis",
	async () => {
		const tempDir = await createTempDir();
		// Create the static directory
		const publicDir = join(tempDir, "public");
		await FS.mkdir(publicDir, {recursive: true});

		try {
			const cacheStorage = createCacheStorage();
			const directoryStorage = await createDirectoryStorage(tempDir);

			const runtime = new SingleThreadedRuntime({
				caches: cacheStorage,
				directories: directoryStorage,
				loggers: createLoggerStorage(),
			});

			await runtime.init();

			// self.directories should be defined with open() method
			expect(globalThis.directories).toBeDefined();
			expect(typeof globalThis.directories.open).toBe("function");

			// Opening the "public" directory should work
			const directory = await globalThis.directories.open("public");
			expect(directory).toBeDefined();
			expect(directory.kind).toBe("directory");
		} finally {
			await cleanup([tempDir]);
		}
	},
	TIMEOUT,
);

test(
	"SingleThreadedRuntime allows ServiceWorker to use both directories and caches",
	async () => {
		const tempDir = await createTempDir();

		try {
			// Set up test file
			const publicDir = join(tempDir, "public");
			await FS.mkdir(publicDir, {recursive: true});
			await FS.writeFile(join(publicDir, "asset.txt"), "Original asset");

			const cacheStorage = createCacheStorage();
			const directoryStorage = await createDirectoryStorage(tempDir);

			const runtime = new SingleThreadedRuntime({
				caches: cacheStorage,
				directories: directoryStorage,
				loggers: createLoggerStorage(),
			});

			await runtime.init();

			// Simulate what ServiceWorker code would do:
			// 1. Check cache first
			// 2. If not in cache, read from directory
			// 3. Store in cache for next time

			const cache = await globalThis.caches.open("assets");
			const request = new Request("http://localhost/asset.txt");

			// First request - should miss cache, read from directory
			let response = await cache.match(request);
			expect(response).toBeUndefined();

			// Read from directory
			const directory = await globalThis.directories.open("public");
			const fileHandle = await directory.getFileHandle("asset.txt");
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
