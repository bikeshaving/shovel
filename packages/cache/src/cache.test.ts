import {test, expect, describe, beforeEach} from "bun:test";
import {CustomCacheStorage} from "./cache-storage.js";
import {MemoryCache} from "./memory.js";

describe("CustomCacheStorage", () => {
	let cacheStorage: CustomCacheStorage;

	beforeEach(() => {
		// Create factory that handles different cache types
		const factory = (name: string) => new MemoryCache(name);
		cacheStorage = new CustomCacheStorage(factory);
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

	beforeEach(() => {
		cache = new MemoryCache("test");
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
		// Mock fetch for this test
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async (request) => {
			return new Response(`Fetched: ${request.url}`);
		};

		try {
			const request = new Request("http://example.com/api/data");
			await cache.add(request);

			const cached = await cache.match(request);
			expect(cached).not.toBeUndefined();
			expect(await cached.text()).toBe("Fetched: http://example.com/api/data");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("addAll() fetches and stores multiple responses", async () => {
		// Mock fetch for this test
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async (request) => {
			return new Response(`Fetched: ${request.url}`);
		};

		try {
			const requests = [
				new Request("http://example.com/api/data1"),
				new Request("http://example.com/api/data2"),
			];

			await cache.addAll(requests);

			const cached1 = await cache.match(requests[0]);
			const cached2 = await cache.match(requests[1]);

			expect(await cached1.text()).toBe(
				"Fetched: http://example.com/api/data1",
			);
			expect(await cached2.text()).toBe(
				"Fetched: http://example.com/api/data2",
			);
		} finally {
			globalThis.fetch = originalFetch;
		}
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
