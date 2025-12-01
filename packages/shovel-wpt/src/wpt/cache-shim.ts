/**
 * WPT Cache API test shim
 *
 * Provides the globals needed to run actual WPT cache-storage tests
 * with a custom Cache/CacheStorage implementation.
 */

import {
	promise_test,
	type TestContext,
} from "../harness/testharness.js";
import * as assertions from "../harness/assertions.js";

// Re-export Cache types
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

export interface CacheShimConfig {
	/** CacheStorage instance to use for tests */
	caches: CacheStorage;
}

/**
 * Setup globals for WPT cache tests
 *
 * Call this before loading WPT test files to inject the cache implementation.
 */
export function setupCacheTestGlobals(config: CacheShimConfig): void {
	let nextCacheIndex = 1;

	// WPT helper: create_temporary_cache
	async function create_temporary_cache(test: TestContext): Promise<Cache> {
		const uniquifier = String(++nextCacheIndex);
		const cacheName = `/wpt-test/${uniquifier}`;

		test.add_cleanup(async () => {
			await config.caches.delete(cacheName);
		});

		await config.caches.delete(cacheName);
		return await config.caches.open(cacheName);
	}

	// WPT helper: cache_test
	function cache_test(
		testFunction: (cache: Cache, test: TestContext) => Promise<void>,
		description: string,
	): void {
		promise_test(async (test) => {
			const cache = await create_temporary_cache(test);
			await testFunction(cache, test);
		}, description);
	}

	// WPT helper: delete_all_caches
	async function delete_all_caches(): Promise<void> {
		const keys = await config.caches.keys();
		await Promise.all(keys.map((key) => config.caches.delete(key)));
	}

	// WPT helper: assert_response_equals
	function assert_response_equals(
		actual: Response,
		expected: Response,
		description?: string,
	): void {
		assertions.assert_class_string(actual, "Response", description);
		["type", "url", "status", "ok", "statusText"].forEach((attribute) => {
			assertions.assert_equals(
				(actual as any)[attribute],
				(expected as any)[attribute],
				description ? `${description} Attributes differ: ${attribute}.` : undefined,
			);
		});
	}

	// Inject globals
	Object.assign(globalThis, {
		// Core harness
		promise_test,
		...assertions,

		// Cache-specific helpers
		cache_test,
		create_temporary_cache,
		delete_all_caches,
		assert_response_equals,

		// Caches API
		caches: config.caches,
	});

	// Also set on self for browser compatibility
	if (typeof self !== "undefined") {
		Object.assign(self, {
			caches: config.caches,
		});
	}
}

/**
 * Additional cache test helpers from WPT test-helpers.js
 */
export const simple_entries = [
	{
		name: "a",
		request: new Request("http://example.com/a"),
		response: new Response(""),
	},
	{
		name: "b",
		request: new Request("http://example.com/b"),
		response: new Response(""),
	},
	{
		name: "a_with_query",
		request: new Request("http://example.com/a?q=r"),
		response: new Response(""),
	},
	{
		name: "A",
		request: new Request("http://example.com/A"),
		response: new Response(""),
	},
	{
		name: "a_https",
		request: new Request("https://example.com/a"),
		response: new Response(""),
	},
];
