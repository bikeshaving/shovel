/**
 * Platform contract tests
 *
 * Tests that all platform adapters provide the same interface and
 * ServiceWorkerGlobals features (caches, directories, cookieStore).
 */

import {join} from "path";
import * as fs from "fs/promises";
import {runPlatformTests} from "../src/runners/platform.js";
import {MemoryCache} from "@b9g/cache/memory";
import {MemoryDirectory} from "@b9g/filesystem/memory";

// Get fixture paths
const fixturesDir = join(import.meta.dir, "fixtures");

// Simple worker JS content (written dynamically for compatibility)
const simpleWorkerJS = `
self.addEventListener("fetch", (event) => {
	event.respondWith(new Response("Hello from ServiceWorker"));
});
`;

// Globals test worker JS content - tests REAL functionality, not just availability
const globalsWorkerJS = `
self.addEventListener("fetch", (event) => {
	const url = new URL(event.request.url);

	if (url.pathname === "/test-caches") {
		event.respondWith(testCaches());
	} else if (url.pathname === "/test-directories") {
		event.respondWith(testDirectories());
	} else if (url.pathname === "/test-cookiestore") {
		event.respondWith(testCookieStore(event.request));
	} else {
		event.respondWith(new Response("Unknown test route", {status: 404}));
	}
});

async function testCaches() {
	const result = {
		success: false,
		error: null,
		// Actual functionality tests
		canOpen: false,
		canPut: false,
		canMatch: false,
		canDelete: false,
		matchedValue: null,
	};

	try {
		// Test 1: Can we open a cache?
		const cache = await self.caches.open("contract-test-cache");
		result.canOpen = true;

		// Test 2: Can we put a request/response?
		const testUrl = "https://example.com/cached-item";
		const testBody = "cached-content-" + Date.now();
		await cache.put(testUrl, new Response(testBody));
		result.canPut = true;

		// Test 3: Can we match and get the content back?
		const matched = await cache.match(testUrl);
		if (matched) {
			result.matchedValue = await matched.text();
			result.canMatch = result.matchedValue === testBody;
		}

		// Test 4: Can we delete?
		const deleted = await cache.delete(testUrl);
		result.canDelete = deleted === true;

		// Cleanup
		await self.caches.delete("contract-test-cache");

		result.success = result.canOpen && result.canPut && result.canMatch && result.canDelete;
	} catch (error) {
		result.error = error.message;
	}

	return new Response(JSON.stringify(result), {
		headers: {"Content-Type": "application/json"},
	});
}

async function testDirectories() {
	const result = {
		success: false,
		error: null,
		// Actual functionality tests
		canOpen: false,
		canWrite: false,
		canRead: false,
		readValue: null,
	};

	try {
		// Test 1: Can we open a directory?
		const directory = await self.directories.open("tmp");
		result.canOpen = directory && directory.kind === "directory";

		// Test 2: Can we write a file?
		const testContent = "directory-test-content-" + Date.now();
		const writeHandle = await directory.getFileHandle("contract-test.txt", {create: true});
		const writable = await writeHandle.createWritable();
		await writable.write(testContent);
		await writable.close();
		result.canWrite = true;

		// Test 3: Can we read it back?
		const readHandle = await directory.getFileHandle("contract-test.txt");
		const file = await readHandle.getFile();
		result.readValue = await file.text();
		result.canRead = result.readValue === testContent;

		// Cleanup
		await directory.removeEntry("contract-test.txt");

		result.success = result.canOpen && result.canWrite && result.canRead;
	} catch (error) {
		result.error = error.message;
	}

	return new Response(JSON.stringify(result), {
		headers: {"Content-Type": "application/json"},
	});
}

async function testCookieStore(_request) {
	const result = {
		success: false,
		error: null,
		// Actual functionality tests
		canGet: false,
		canReadFromRequest: false,
		cookieValue: null,
	};

	try {
		// Test 1: Can we call get() without error?
		const cookie = await self.cookieStore.get("test");
		result.canGet = true;

		// Test 2: Did we read the cookie from the request?
		if (cookie) {
			result.cookieValue = cookie.value;
			result.canReadFromRequest = cookie.value === "value";
		}

		result.success = result.canGet && result.canReadFromRequest;
	} catch (error) {
		result.error = error.message;
	}

	return new Response(JSON.stringify(result), {
		headers: {"Content-Type": "application/json"},
	});
}
`;

// Write fixture files before tests run
await fs.mkdir(fixturesDir, {recursive: true});

// Each platform gets unique worker files to avoid module caching issues
let workerCounter = 0;
function getWorkerPaths() {
	const id = ++workerCounter;
	const simple = join(fixturesDir, `simple-worker-${id}.js`);
	const globals = join(fixturesDir, `globals-test-worker-${id}.js`);
	return {simple, globals};
}

async function writeWorkerFiles(simplePath: string, globalsPath: string) {
	await fs.writeFile(simplePath, simpleWorkerJS);
	await fs.writeFile(globalsPath, globalsWorkerJS);
}

// =============================================================================
// Node Platform Tests
// =============================================================================
const nodePaths = getWorkerPaths();
await writeWorkerFiles(nodePaths.simple, nodePaths.globals);

runPlatformTests("NodePlatform", {
	async createPlatform() {
		const {default: NodePlatform} = await import("@b9g/platform-node");
		return new NodePlatform({
			cwd: fixturesDir,
			config: {
				caches: {
					"test-cache": {CacheClass: MemoryCache},
					"functional-test": {CacheClass: MemoryCache},
					"cache-1": {CacheClass: MemoryCache},
					"cache-2": {CacheClass: MemoryCache},
					// For ServiceWorkerGlobals tests
					"contract-test-cache": {CacheClass: MemoryCache},
				},
				directories: {
					// For ServiceWorkerGlobals tests
					tmp: {DirectoryClass: MemoryDirectory},
				},
			},
		});
	},
	testEntrypoint: nodePaths.simple,
	testGlobalsEntrypoint: nodePaths.globals,
	skipServerTests: false,
});

// =============================================================================
// Bun Platform Tests
// =============================================================================
const bunPaths = getWorkerPaths();
await writeWorkerFiles(bunPaths.simple, bunPaths.globals);

runPlatformTests("BunPlatform", {
	async createPlatform() {
		const {default: BunPlatform} = await import("@b9g/platform-bun");
		return new BunPlatform({
			cwd: fixturesDir,
			config: {
				caches: {
					"test-cache": {CacheClass: MemoryCache},
					"functional-test": {CacheClass: MemoryCache},
					"cache-1": {CacheClass: MemoryCache},
					"cache-2": {CacheClass: MemoryCache},
					// For ServiceWorkerGlobals tests
					"contract-test-cache": {CacheClass: MemoryCache},
				},
				directories: {
					// For ServiceWorkerGlobals tests
					tmp: {DirectoryClass: MemoryDirectory},
				},
			},
		});
	},
	testEntrypoint: bunPaths.simple,
	testGlobalsEntrypoint: bunPaths.globals,
	skipServerTests: false,
});

// =============================================================================
// Cloudflare Platform Tests
// Note: Uses miniflare under the hood
// =============================================================================
// TODO: Cloudflare platform needs the entrypoint to be pre-built
// because miniflare doesn't support TypeScript directly.
// For now, skip the ServiceWorker tests for Cloudflare.
runPlatformTests("CloudflarePlatform", {
	async createPlatform() {
		const {default: CloudflarePlatform, CloudflareNativeCache} =
			await import("@b9g/platform-cloudflare");
		return new CloudflarePlatform({
			cwd: fixturesDir,
			config: {
				caches: {
					"test-cache": {CacheClass: CloudflareNativeCache},
					"functional-test": {CacheClass: CloudflareNativeCache},
					"cache-1": {CacheClass: CloudflareNativeCache},
					"cache-2": {CacheClass: CloudflareNativeCache},
				},
			},
		});
	},
	// Skip SW tests until we have a build step for the fixtures
	skipServiceWorkerTests: true,
	skipServerTests: true, // Cloudflare doesn't have a traditional server
});
