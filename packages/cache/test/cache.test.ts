import {test, expect, describe, beforeEach, afterEach, spyOn} from "bun:test";
import {CustomCacheStorage} from "../src/index.js";
import {MemoryCache} from "../src/memory.js";

describe("CustomCacheStorage", () => {
	let cacheStorage: CustomCacheStorage;

	beforeEach(() => {
		// Create CustomCacheStorage with MemoryCache instances
		cacheStorage = new CustomCacheStorage(
			(name: string) => new MemoryCache(name),
		);
	});

	test("can open caches", async () => {
		const cache = await cacheStorage.open("test-cache");
		expect(cache).toBeInstanceOf(MemoryCache);
	});

	test("returns same instance for same cache name", async () => {
		const cache1 = await cacheStorage.open("test-cache");
		const cache2 = await cacheStorage.open("test-cache");

		expect(cache1).toBe(cache2);
	});

	test("can check if cache exists", async () => {
		expect(await cacheStorage.has("test-cache")).toBe(false);

		await cacheStorage.open("test-cache"); // Creates and opens cache
		expect(await cacheStorage.has("test-cache")).toBe(true);
	});

	test("can delete caches", async () => {
		await cacheStorage.open("test-cache"); // Create instance

		expect(await cacheStorage.has("test-cache")).toBe(true);
		expect(await cacheStorage.delete("test-cache")).toBe(true);
		expect(await cacheStorage.has("test-cache")).toBe(false);
	});

	test("can list cache keys", async () => {
		await cacheStorage.open("cache1");
		await cacheStorage.open("cache2");

		const keys = await cacheStorage.keys();
		expect(keys).toEqual(["cache1", "cache2"]);
	});
});

describe("MemoryCache", () => {
	let cache: MemoryCache;
	let fetchSpy: ReturnType<typeof spyOn> | null = null;

	beforeEach(() => {
		cache = new MemoryCache("test");
	});

	afterEach(() => {
		// Restore fetch mock if it was set
		if (fetchSpy) {
			fetchSpy.mockRestore();
			fetchSpy = null;
		}
	});

	test("can store and retrieve responses", async () => {
		const request = new Request("http://example.com/test");
		const response = new Response("Hello World");

		await cache.put(request, response);

		const cached = await cache.match(request);
		expect(cached).not.toBeNull();
		expect(await cached.text()).toBe("Hello World");
	});

	test("returns undefined for non-existent entries", async () => {
		const request = new Request("http://example.com/nonexistent");
		const cached = await cache.match(request);
		expect(cached).toBeUndefined();
	});

	test("can delete entries", async () => {
		const request = new Request("http://example.com/test");
		const response = new Response("Hello World");

		await cache.put(request, response);
		expect(await cache.match(request)).not.toBeUndefined();

		const deleted = await cache.delete(request);
		expect(deleted).toBe(true);
		expect(await cache.match(request)).toBeUndefined();
	});

	test("returns false when deleting non-existent entry", async () => {
		const request = new Request("http://example.com/nonexistent");
		const deleted = await cache.delete(request);
		expect(deleted).toBe(false);
	});

	test("can list cache keys", async () => {
		const request1 = new Request("http://example.com/test1");
		const request2 = new Request("http://example.com/test2");
		const response = new Response("Test");

		await cache.put(request1, response.clone());
		await cache.put(request2, response.clone());

		const keys = await cache.keys();
		expect(keys).toHaveLength(2);
		expect(keys[0].url).toBe("http://example.com/test1");
		expect(keys[1].url).toBe("http://example.com/test2");
	});

	test("add() fetches and stores response", async () => {
		// Mock fetch using spyOn
		fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
			async (request) => {
				return new Response(`Fetched: ${(request as Request).url}`);
			},
		);

		const request = new Request("http://example.com/api/data");
		await cache.add(request);

		const cached = await cache.match(request);
		expect(cached).not.toBeUndefined();
		expect(await cached.text()).toBe("Fetched: http://example.com/api/data");
	});

	test("addAll() fetches and stores multiple responses", async () => {
		// Mock fetch using spyOn
		fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
			async (request) => {
				return new Response(`Fetched: ${(request as Request).url}`);
			},
		);

		const requests = [
			new Request("http://example.com/api/data1"),
			new Request("http://example.com/api/data2"),
		];

		await cache.addAll(requests);

		const cached1 = await cache.match(requests[0]);
		const cached2 = await cache.match(requests[1]);

		expect(await cached1.text()).toBe("Fetched: http://example.com/api/data1");
		expect(await cached2.text()).toBe("Fetched: http://example.com/api/data2");
	});

	test("respects maxEntries option", async () => {
		const limitedCache = new MemoryCache("limited", {maxEntries: 2});

		await limitedCache.put(
			new Request("http://example.com/1"),
			new Response("1"),
		);
		await limitedCache.put(
			new Request("http://example.com/2"),
			new Response("2"),
		);
		await limitedCache.put(
			new Request("http://example.com/3"),
			new Response("3"),
		);

		const keys = await limitedCache.keys();
		expect(keys).toHaveLength(2);

		// First entry should be evicted (LRU)
		const cached1 = await limitedCache.match(
			new Request("http://example.com/1"),
		);
		expect(cached1).toBeUndefined();
	});

	test("can clear all entries", async () => {
		await cache.put(new Request("http://example.com/1"), new Response("1"));
		await cache.put(new Request("http://example.com/2"), new Response("2"));

		expect((await cache.keys()).length).toBe(2);

		await cache.clear();

		expect((await cache.keys()).length).toBe(0);
	});
});

describe("CustomCacheStorage message handling (PostMessage coordination)", () => {
	test("CustomCacheStorage handles cache:match messages", async () => {
		const cacheStorage = new CustomCacheStorage(
			(name: string) => new MemoryCache(name),
		);
		const messages: any[] = [];

		// Mock worker that captures postMessage calls
		const mockWorker = {
			postMessage: (msg: any) => messages.push(msg),
		};

		// Simulate a cache:match message from worker
		const matchMessage = {
			type: "cache:match",
			requestID: "1",
			cacheName: "test-cache",
			request: {
				url: "http://example.com/test",
				method: "GET",
				headers: {},
			},
		};

		await cacheStorage.handleMessage(mockWorker, matchMessage);

		// Should respond with cache:response (no match)
		expect(messages).toHaveLength(1);
		expect(messages[0].type).toBe("cache:response");
		expect(messages[0].requestID).toBe("1");
		expect(messages[0].result).toBeUndefined();
	});

	test("CustomCacheStorage handles cache:put and cache:match", async () => {
		const cacheStorage = new CustomCacheStorage(
			(name: string) => new MemoryCache(name),
		);
		const messages: any[] = [];

		const mockWorker = {
			postMessage: (msg: any) => messages.push(msg),
		};

		// Put a response in the cache
		const putMessage = {
			type: "cache:put",
			requestID: "1",
			cacheName: "test-cache",
			request: {
				url: "http://example.com/test",
				method: "GET",
				headers: {},
			},
			response: {
				status: 200,
				statusText: "OK",
				headers: {"content-type": "text/plain"},
				body: "Hello World",
			},
		};

		await cacheStorage.handleMessage(mockWorker, putMessage);

		expect(messages).toHaveLength(1);
		expect(messages[0].type).toBe("cache:response");

		// Now match should find it
		messages.length = 0; // Clear messages

		const matchMessage = {
			type: "cache:match",
			requestID: "2",
			cacheName: "test-cache",
			request: {
				url: "http://example.com/test",
				method: "GET",
				headers: {},
			},
		};

		await cacheStorage.handleMessage(mockWorker, matchMessage);

		expect(messages).toHaveLength(1);
		expect(messages[0].type).toBe("cache:response");
		expect(messages[0].requestID).toBe("2");
		expect(messages[0].result).toBeDefined();
		expect(messages[0].result.body).toBe("Hello World");
	});

	test("CustomCacheStorage handles cache:delete", async () => {
		const cacheStorage = new CustomCacheStorage(
			(name: string) => new MemoryCache(name),
		);
		const messages: any[] = [];

		const mockWorker = {
			postMessage: (msg: any) => messages.push(msg),
		};

		// Put then delete
		await cacheStorage.handleMessage(mockWorker, {
			type: "cache:put",
			requestID: "1",
			cacheName: "test-cache",
			request: {
				url: "http://example.com/test",
				method: "GET",
				headers: {},
			},
			response: {
				status: 200,
				statusText: "OK",
				headers: {},
				body: "Test",
			},
		});

		messages.length = 0;

		await cacheStorage.handleMessage(mockWorker, {
			type: "cache:delete",
			requestID: "2",
			cacheName: "test-cache",
			request: {
				url: "http://example.com/test",
				method: "GET",
				headers: {},
			},
		});

		expect(messages).toHaveLength(1);
		expect(messages[0].type).toBe("cache:response");
		expect(messages[0].result).toBe(true);
	});

	test("CustomCacheStorage handles cache:keys", async () => {
		const cacheStorage = new CustomCacheStorage(
			(name: string) => new MemoryCache(name),
		);
		const messages: any[] = [];

		const mockWorker = {
			postMessage: (msg: any) => messages.push(msg),
		};

		// Put two items
		await cacheStorage.handleMessage(mockWorker, {
			type: "cache:put",
			requestID: "1",
			cacheName: "test-cache",
			request: {url: "http://example.com/1", method: "GET", headers: {}},
			response: {status: 200, statusText: "OK", headers: {}, body: "1"},
		});

		await cacheStorage.handleMessage(mockWorker, {
			type: "cache:put",
			requestID: "2",
			cacheName: "test-cache",
			request: {url: "http://example.com/2", method: "GET", headers: {}},
			response: {status: 200, statusText: "OK", headers: {}, body: "2"},
		});

		messages.length = 0;

		await cacheStorage.handleMessage(mockWorker, {
			type: "cache:keys",
			requestID: "3",
			cacheName: "test-cache",
		});

		expect(messages).toHaveLength(1);
		expect(messages[0].type).toBe("cache:response");
		expect(messages[0].result).toHaveLength(2);
		expect(messages[0].result[0].url).toBe("http://example.com/1");
		expect(messages[0].result[1].url).toBe("http://example.com/2");
	});

	test("CustomCacheStorage handles cache:clear", async () => {
		const cacheStorage = new CustomCacheStorage(
			(name: string) => new MemoryCache(name),
		);
		const messages: any[] = [];

		const mockWorker = {
			postMessage: (msg: any) => messages.push(msg),
		};

		// Put items then clear
		await cacheStorage.handleMessage(mockWorker, {
			type: "cache:put",
			requestID: "1",
			cacheName: "test-cache",
			request: {url: "http://example.com/1", method: "GET", headers: {}},
			response: {status: 200, statusText: "OK", headers: {}, body: "1"},
		});

		messages.length = 0;

		await cacheStorage.handleMessage(mockWorker, {
			type: "cache:clear",
			requestID: "2",
			cacheName: "test-cache",
		});

		expect(messages).toHaveLength(1);
		expect(messages[0].type).toBe("cache:response");

		// Verify cache is empty
		messages.length = 0;

		await cacheStorage.handleMessage(mockWorker, {
			type: "cache:keys",
			requestID: "3",
			cacheName: "test-cache",
		});

		expect(messages[0].result).toHaveLength(0);
	});

	test("CustomCacheStorage handles errors gracefully", async () => {
		const cacheStorage = new CustomCacheStorage(
			(name: string) => new MemoryCache(name),
		);
		const messages: any[] = [];

		const mockWorker = {
			postMessage: (msg: any) => messages.push(msg),
		};

		// Send invalid message (missing required fields)
		await cacheStorage.handleMessage(mockWorker, {
			type: "cache:match",
			requestID: "1",
			cacheName: "test-cache",
			// Missing request field
		});

		expect(messages).toHaveLength(1);
		expect(messages[0].type).toBe("cache:error");
		expect(messages[0].requestID).toBe("1");
		expect(messages[0].error).toBeDefined();
	});
});
