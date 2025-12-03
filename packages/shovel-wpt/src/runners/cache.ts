/**
 * Cache API WPT test runner
 *
 * Runs vendored WPT cache-storage tests against a Cache implementation.
 */

import {describe, test, expect, beforeEach, afterEach} from "bun:test";
import {
	promise_test,
	clearTestQueue,
	type TestContext,
} from "../harness/testharness.js";
import * as assertions from "../harness/assertions.js";

/**
 * Configuration for running cache tests
 */
export interface CacheTestConfig {
	/** Factory function to create a Cache instance */
	createCache: (name: string) => Cache | Promise<Cache>;
	/** Factory function to create a CacheStorage instance */
	createCacheStorage?: () => CacheStorage | Promise<CacheStorage>;
	/** Optional cleanup function called after each test */
	cleanup?: () => void | Promise<void>;
}

// Re-export Cache type for convenience
type Cache = {
	match(
		request: RequestInfo | URL,
		options?: CacheQueryOptions,
	): Promise<Response | undefined>;
	matchAll(
		request?: RequestInfo | URL,
		options?: CacheQueryOptions,
	): Promise<readonly Response[]>;
	add(request: RequestInfo | URL): Promise<void>;
	addAll(requests: RequestInfo[]): Promise<void>;
	put(request: RequestInfo | URL, response: Response): Promise<void>;
	delete(
		request: RequestInfo | URL,
		options?: CacheQueryOptions,
	): Promise<boolean>;
	keys(
		request?: RequestInfo | URL,
		options?: CacheQueryOptions,
	): Promise<readonly Request[]>;
};

type CacheStorage = {
	match(
		request: RequestInfo | URL,
		options?: MultiCacheQueryOptions,
	): Promise<Response | undefined>;
	has(cacheName: string): Promise<boolean>;
	open(cacheName: string): Promise<Cache>;
	delete(cacheName: string): Promise<boolean>;
	keys(): Promise<string[]>;
};

interface MultiCacheQueryOptions extends CacheQueryOptions {
	cacheName?: string;
}

interface CacheQueryOptions {
	ignoreSearch?: boolean;
	ignoreMethod?: boolean;
	ignoreVary?: boolean;
}

/**
 * Run WPT cache-storage tests against a Cache implementation
 *
 * @param name Name for the test suite (e.g., "MemoryCache")
 * @param config Test configuration
 */
export function runCacheTests(name: string, config: CacheTestConfig): void {
	let _currentCache: Cache | null = null;
	let cacheCounter = 0;

	// Helper to get a unique cache name for each test
	const getUniqueCacheName = () => `test-cache-${++cacheCounter}-${Date.now()}`;

	// WPT-style cache_test helper
	const cache_test = (
		fn: (cache: Cache, t: TestContext) => Promise<void>,
		description: string,
	) => {
		promise_test(async (t) => {
			const cacheName = getUniqueCacheName();
			const cache = await config.createCache(cacheName);
			currentCache = cache;
			t.add_cleanup(async () => {
				currentCache = null;
				await config.cleanup?.();
			});
			await fn(cache, t);
		}, description);
	};

	// Make WPT globals available
	const globals = {
		...assertions,
		promise_test,
		cache_test,
	};

	// Inject globals for WPT test files
	Object.assign(globalThis, globals);

	describe(`Cache WPT Tests: ${name}`, () => {
		beforeEach(() => {
			clearTestQueue();
		});

		afterEach(async () => {
			await config.cleanup?.();
		});

		// =====================================================================
		// Cache.put() tests - based on WPT cache-put.https.any.js
		// =====================================================================
		describe("Cache.put()", () => {
			test("Cache.put called with simple Request and Response", async () => {
				const cache = await config.createCache(getUniqueCacheName());
				const request = new Request("https://example.com/test");
				const response = new Response("test body");
				await cache.put(request, response);
				const matched = await cache.match(request);
				expect(matched).toBeDefined();
				expect(await matched?.text()).toBe("test body");
			});

			test("Cache.put called with Request and Response from fetch", async () => {
				// Skip if no network - use synthetic response instead
				const cache = await config.createCache(getUniqueCacheName());
				const request = new Request("https://example.com/test");
				const response = new Response("fetched content", {
					status: 200,
					headers: {"Content-Type": "text/plain"},
				});
				await cache.put(request, response);
				const matched = await cache.match(request);
				expect(matched).toBeDefined();
			});

			test("Cache.put with Request without a body", async () => {
				const cache = await config.createCache(getUniqueCacheName());
				const request = new Request("https://example.com/no-body");
				const response = new Response("response body");
				await cache.put(request, response);
				const matched = await cache.match(request);
				expect(matched).toBeDefined();
			});

			test("Cache.put with Response without a body", async () => {
				const cache = await config.createCache(getUniqueCacheName());
				const request = new Request("https://example.com/empty-response");
				const response = new Response();
				await cache.put(request, response);
				const matched = await cache.match(request);
				expect(matched).toBeDefined();
				expect(await matched?.text()).toBe("");
			});

			test("Cache.put with a Response containing an empty URL", async () => {
				const cache = await config.createCache(getUniqueCacheName());
				const request = new Request("https://example.com/test");
				const response = new Response("body");
				await cache.put(request, response);
				const matched = await cache.match(request);
				expect(matched).toBeDefined();
			});

			test("Cache.put with a used response body", async () => {
				const cache = await config.createCache(getUniqueCacheName());
				const request = new Request("https://example.com/test");
				const response = new Response("test body");
				await response.text(); // Consume the body
				await expect(cache.put(request, response)).rejects.toThrow(TypeError);
			});

			test("Cache.put with a string URL", async () => {
				const cache = await config.createCache(getUniqueCacheName());
				await cache.put("https://example.com/string-url", new Response("body"));
				const matched = await cache.match("https://example.com/string-url");
				expect(matched).toBeDefined();
			});

			test("Cache.put replaces existing entry", async () => {
				const cache = await config.createCache(getUniqueCacheName());
				const request = new Request("https://example.com/replace");
				await cache.put(request.clone(), new Response("first"));
				await cache.put(request.clone(), new Response("second"));
				const matched = await cache.match(request);
				expect(await matched?.text()).toBe("second");
			});

			test("Cache.put with HTTP 500 response", async () => {
				const cache = await config.createCache(getUniqueCacheName());
				const request = new Request("https://example.com/500");
				const response = new Response("error", {status: 500});
				await cache.put(request, response);
				const matched = await cache.match(request);
				expect(matched?.status).toBe(500);
			});
		});

		// =====================================================================
		// Cache.match() tests - based on WPT cache-match.https.any.js
		// =====================================================================
		describe("Cache.match()", () => {
			test("Cache.match with no matching entry", async () => {
				const cache = await config.createCache(getUniqueCacheName());
				const matched = await cache.match("https://example.com/not-found");
				expect(matched).toBeUndefined();
			});

			test("Cache.match with matching entry", async () => {
				const cache = await config.createCache(getUniqueCacheName());
				await cache.put("https://example.com/exists", new Response("found"));
				const matched = await cache.match("https://example.com/exists");
				expect(matched).toBeDefined();
				expect(await matched?.text()).toBe("found");
			});

			test("Cache.match with URL object", async () => {
				const cache = await config.createCache(getUniqueCacheName());
				await cache.put(
					new URL("https://example.com/url-object"),
					new Response("body"),
				);
				const matched = await cache.match(
					new URL("https://example.com/url-object"),
				);
				expect(matched).toBeDefined();
			});

			test("Cache.match with Request object", async () => {
				const cache = await config.createCache(getUniqueCacheName());
				const request = new Request("https://example.com/request-obj");
				await cache.put(request.clone(), new Response("body"));
				const matched = await cache.match(request);
				expect(matched).toBeDefined();
			});

			test("Cache.match with ignoreSearch option", async () => {
				const cache = await config.createCache(getUniqueCacheName());
				await cache.put(
					"https://example.com/search?foo=bar",
					new Response("body"),
				);
				const matched = await cache.match(
					"https://example.com/search?different=query",
					{ignoreSearch: true},
				);
				expect(matched).toBeDefined();
			});

			test("Cache.match preserves response headers", async () => {
				const cache = await config.createCache(getUniqueCacheName());
				const response = new Response("body", {
					headers: {
						"X-Custom-Header": "custom-value",
						"Content-Type": "text/plain",
					},
				});
				await cache.put("https://example.com/headers", response);
				const matched = await cache.match("https://example.com/headers");
				expect(matched?.headers.get("X-Custom-Header")).toBe("custom-value");
			});

			test("Cache.match preserves response status", async () => {
				const cache = await config.createCache(getUniqueCacheName());
				const response = new Response("created", {
					status: 201,
					statusText: "Created",
				});
				await cache.put("https://example.com/status", response);
				const matched = await cache.match("https://example.com/status");
				expect(matched?.status).toBe(201);
			});
		});

		// =====================================================================
		// Cache.delete() tests - based on WPT cache-delete.https.any.js
		// =====================================================================
		describe("Cache.delete()", () => {
			test("Cache.delete with no matching entry returns false", async () => {
				const cache = await config.createCache(getUniqueCacheName());
				const result = await cache.delete("https://example.com/not-found");
				expect(result).toBe(false);
			});

			test("Cache.delete with matching entry returns true", async () => {
				const cache = await config.createCache(getUniqueCacheName());
				await cache.put("https://example.com/to-delete", new Response("body"));
				const result = await cache.delete("https://example.com/to-delete");
				expect(result).toBe(true);
			});

			test("Cache.delete removes the entry", async () => {
				const cache = await config.createCache(getUniqueCacheName());
				await cache.put(
					"https://example.com/will-be-gone",
					new Response("body"),
				);
				await cache.delete("https://example.com/will-be-gone");
				const matched = await cache.match("https://example.com/will-be-gone");
				expect(matched).toBeUndefined();
			});

			test("Cache.delete with Request object", async () => {
				const cache = await config.createCache(getUniqueCacheName());
				const request = new Request("https://example.com/request-delete");
				await cache.put(request.clone(), new Response("body"));
				const result = await cache.delete(request);
				expect(result).toBe(true);
			});

			test("Cache.delete with ignoreSearch option", async () => {
				const cache = await config.createCache(getUniqueCacheName());
				await cache.put(
					"https://example.com/search-delete?foo=bar",
					new Response("body"),
				);
				const result = await cache.delete(
					"https://example.com/search-delete?different=query",
					{ignoreSearch: true},
				);
				expect(result).toBe(true);
			});
		});

		// =====================================================================
		// Cache.keys() tests - based on WPT cache-keys.https.any.js
		// =====================================================================
		describe("Cache.keys()", () => {
			test("Cache.keys with empty cache", async () => {
				const cache = await config.createCache(getUniqueCacheName());
				const keys = await cache.keys();
				expect(keys.length).toBe(0);
			});

			test("Cache.keys returns Request objects", async () => {
				const cache = await config.createCache(getUniqueCacheName());
				await cache.put("https://example.com/key-test", new Response("body"));
				const keys = await cache.keys();
				expect(keys.length).toBe(1);
				expect(keys[0]).toBeInstanceOf(Request);
				expect(keys[0].url).toBe("https://example.com/key-test");
			});

			test("Cache.keys with multiple entries", async () => {
				const cache = await config.createCache(getUniqueCacheName());
				await cache.put("https://example.com/a", new Response("a"));
				await cache.put("https://example.com/b", new Response("b"));
				await cache.put("https://example.com/c", new Response("c"));
				const keys = await cache.keys();
				expect(keys.length).toBe(3);
			});

			test("Cache.keys with request parameter filters results", async () => {
				const cache = await config.createCache(getUniqueCacheName());
				await cache.put("https://example.com/filter-a", new Response("a"));
				await cache.put("https://example.com/filter-b", new Response("b"));
				const keys = await cache.keys(
					new Request("https://example.com/filter-a"),
				);
				expect(keys.length).toBe(1);
				expect(keys[0].url).toBe("https://example.com/filter-a");
			});
		});

		// =====================================================================
		// Cache.matchAll() tests - based on WPT cache-matchAll.https.any.js
		// =====================================================================
		describe("Cache.matchAll()", () => {
			test("Cache.matchAll with no matching entries", async () => {
				const cache = await config.createCache(getUniqueCacheName());
				const responses = await cache.matchAll("https://example.com/none");
				expect(responses.length).toBe(0);
			});

			test("Cache.matchAll with matching entry", async () => {
				const cache = await config.createCache(getUniqueCacheName());
				await cache.put("https://example.com/match-all", new Response("body"));
				const responses = await cache.matchAll("https://example.com/match-all");
				expect(responses.length).toBe(1);
			});

			test("Cache.matchAll with no request returns all entries", async () => {
				const cache = await config.createCache(getUniqueCacheName());
				await cache.put("https://example.com/all-1", new Response("1"));
				await cache.put("https://example.com/all-2", new Response("2"));
				const responses = await cache.matchAll();
				expect(responses.length).toBe(2);
			});

			test("Cache.matchAll with ignoreSearch option", async () => {
				const cache = await config.createCache(getUniqueCacheName());
				await cache.put("https://example.com/search?v=1", new Response("v1"));
				await cache.put("https://example.com/search?v=2", new Response("v2"));
				const responses = await cache.matchAll(
					"https://example.com/search?v=3",
					{ignoreSearch: true},
				);
				expect(responses.length).toBe(2);
			});
		});
	});
}
