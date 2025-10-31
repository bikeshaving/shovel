import {test, expect, describe, beforeEach} from "bun:test";
import {
	BrowserCache,
	createBrowserCache,
	isBrowserCacheSupported,
	getBrowserCacheInfo,
} from "./browser-cache.js";

describe("BrowserCache", () => {
	test("detects lack of CacheStorage support in test environment", () => {
		expect(isBrowserCacheSupported()).toBe(false);
	});

	test("provides environment information", () => {
		const info = getBrowserCacheInfo();

		expect(info.supported).toBe(false);
		expect(typeof info.context).toBe("string");
		expect(typeof info.hasServiceWorker).toBe("boolean");
		expect(typeof info.hasWindow).toBe("boolean");
	});

	describe("with mocked CacheStorage", () => {
		let mockCache: Cache;
		let mockCacheStorage: CacheStorage;
		let browserCache: BrowserCache;

		beforeEach(() => {
			// Create mock cache
			mockCache = {
				match: async (request, options) => {
					if (request.url === "http://example.com/cached") {
						return new Response("Cached response");
					}
					return undefined;
				},
				put: async (request, response) => {
					// Mock implementation - just succeed
				},
				delete: async (request, options) => {
					return request.url === "http://example.com/cached";
				},
				keys: async (request, options) => {
					return [new Request("http://example.com/cached")];
				},
			};

			// Create mock CacheStorage
			mockCacheStorage = {
				open: async (name) => {
					if (name === "test-cache") {
						return mockCache;
					}
					throw new Error(`Cache ${name} not found`);
				},
				delete: async (name) => {
					return name === "test-cache";
				},
			};

			browserCache = new BrowserCache("test-cache", {
				cacheStorage: mockCacheStorage,
				fallbackToMemory: true,
			});
		});

		test("can match cached responses", async () => {
			const request = new Request("http://example.com/cached");
			const response = await browserCache.match(request);

			expect(response).not.toBeUndefined();
			expect(await response.text()).toBe("Cached response");
		});

		test("returns undefined for non-cached responses", async () => {
			const request = new Request("http://example.com/not-cached");
			const response = await browserCache.match(request);

			expect(response).toBeUndefined();
		});

		test("can store responses", async () => {
			const request = new Request("http://example.com/new");
			const response = new Response("New response");

			// Should not throw
			await browserCache.put(request, response);
		});

		test("can delete responses", async () => {
			const request = new Request("http://example.com/cached");
			const deleted = await browserCache.delete(request);

			expect(deleted).toBe(true);
		});

		test("can list cache keys", async () => {
			const keys = await browserCache.keys();

			expect(keys).toHaveLength(1);
			expect(keys[0].url).toBe("http://example.com/cached");
		});

		test("can clear cache", async () => {
			await browserCache.clear();
			// Should not throw - clear operation delegates to native cache delete
		});

		test("provides cache statistics", () => {
			const stats = browserCache.getStats();

			expect(stats.name).toBe("test-cache");
			expect(stats.type).toBe("browser");
			expect(typeof stats.nativeSupport).toBe("boolean");
			expect(typeof stats.hasFallback).toBe("boolean");
		});
	});

	describe("fallback behavior", () => {
		let browserCache: BrowserCache;

		beforeEach(() => {
			// Create cache without CacheStorage - should fall back to memory
			browserCache = new BrowserCache("fallback-test", {
				fallbackToMemory: true,
			});
		});

		test("falls back to memory cache when CacheStorage unavailable", async () => {
			const request = new Request("http://example.com/test");
			const response = new Response("Fallback test");

			// Should use fallback cache
			await browserCache.put(request, response);

			const cached = await browserCache.match(request);
			expect(cached).not.toBeUndefined();
			expect(await cached.text()).toBe("Fallback test");
		});

		test("can delete from fallback cache", async () => {
			const request = new Request("http://example.com/test");
			const response = new Response("Test");

			await browserCache.put(request, response);
			expect(await browserCache.match(request)).not.toBeUndefined();

			const deleted = await browserCache.delete(request);
			expect(deleted).toBe(true);
			expect(await browserCache.match(request)).toBeUndefined();
		});

		test("can list keys from fallback cache", async () => {
			const request1 = new Request("http://example.com/test1");
			const request2 = new Request("http://example.com/test2");
			const response = new Response("Test");

			await browserCache.put(request1, response.clone());
			await browserCache.put(request2, response.clone());

			const keys = await browserCache.keys();
			expect(keys).toHaveLength(2);
		});
	});

	describe("without fallback", () => {
		let browserCache: BrowserCache;

		beforeEach(() => {
			browserCache = new BrowserCache("no-fallback", {
				fallbackToMemory: false,
			});
		});

		test("throws error when putting without cache support", async () => {
			const request = new Request("http://example.com/test");
			const response = new Response("Test");

			await expect(async () => {
				await browserCache.put(request, response);
			}).toThrow("No cache implementation available");
		});

		test("returns undefined when matching without cache support", async () => {
			const request = new Request("http://example.com/test");
			const response = await browserCache.match(request);

			expect(response).toBeUndefined();
		});

		test("returns false when deleting without cache support", async () => {
			const request = new Request("http://example.com/test");
			const deleted = await browserCache.delete(request);

			expect(deleted).toBe(false);
		});

		test("returns empty array when listing keys without cache support", async () => {
			const keys = await browserCache.keys();

			expect(keys).toEqual([]);
		});
	});

	test("createBrowserCache helper creates cache with fallback enabled", () => {
		const cache = createBrowserCache("helper-test");
		const stats = cache.getStats();

		expect(stats.name).toBe("helper-test");
		expect(stats.type).toBe("browser");
	});

	test("static isSupported method works correctly", () => {
		// In test environment, should return false
		expect(BrowserCache.isSupported()).toBe(false);
	});

	describe("cache options conversion", () => {
		let mockCache: Cache & {_getLastOptions?: () => any};
		let mockCacheStorage: CacheStorage;
		let browserCache: BrowserCache & {_getLastOptions?: () => any};

		beforeEach(() => {
			let lastOptions: any;

			mockCache = {
				match: async (request, options) => {
					lastOptions = options;
					return undefined;
				},
				put: async () => {},
				delete: async (request, options) => {
					lastOptions = options;
					return false;
				},
				keys: async (request, options) => {
					lastOptions = options;
					return [];
				},
			};

			mockCacheStorage = {
				open: async () => mockCache,
				delete: async () => true,
			};

			browserCache = new BrowserCache("options-test", {
				cacheStorage: mockCacheStorage,
			});

			// Helper to get the last options passed to native cache
			browserCache._getLastOptions = () => lastOptions;
		});

		test("converts cache options correctly", async () => {
			const request = new Request("http://example.com/test");

			await browserCache.match(request, {
				ignoreSearch: true,
				ignoreMethod: false,
				cacheName: "custom", // This should be filtered out
			});

			// The cacheName should be filtered out, but other options preserved
			const lastOptions = browserCache._getLastOptions();
			expect(lastOptions).toEqual({
				ignoreSearch: true,
				ignoreMethod: false,
			});
		});
	});
});
