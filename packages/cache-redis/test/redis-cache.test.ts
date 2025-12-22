/**
 * Tests for RedisCache
 *
 * These tests run against a real Redis/Valkey instance.
 * Start Redis with: docker compose up -d
 * If Redis is not reachable, the suite is skipped.
 */

import {test, expect, describe, beforeEach, afterEach} from "bun:test";
import {RedisCache} from "../src/index.js";
import {createClient} from "redis";

const REDIS_URL = import.meta.env.REDIS_URL || "redis://localhost:6379";

async function isRedisAvailable(url: string): Promise<boolean> {
	const client = createClient({url});
	try {
		await client.connect();
		await client.ping();
		await client.quit();
		return true;
	} catch {
		if (client.isOpen) {
			await client.quit();
		}
		return false;
	}
}

const redisAvailable = await isRedisAvailable(REDIS_URL);
const describeRedis = redisAvailable ? describe : describe.skip;

describeRedis("RedisCache", () => {
	let cache: RedisCache;
	let testPrefix: string;

	beforeEach(async () => {
		// Use unique prefix for each test (timestamp + random for parallel test isolation)
		testPrefix = `test:${Date.now()}:${Math.random().toString(36).substring(7)}`;

		cache = new RedisCache("integration-test", {
			redis: {url: REDIS_URL},
			prefix: testPrefix,
			defaultTTL: 300,
		});

		// Wait a bit for connection
		await new Promise((resolve) => setTimeout(resolve, 100));
	});

	afterEach(async () => {
		// Clean up test data for this test
		const cleanupClient = createClient({url: REDIS_URL});
		await cleanupClient.connect();

		// Delete all keys with this test's prefix
		const keys = [];
		for await (const key of cleanupClient.scanIterator({
			MATCH: `${testPrefix}:*`,
			COUNT: 1000,
		})) {
			keys.push(key);
		}

		if (keys.length > 0) {
			await cleanupClient.del(keys);
		}

		await cleanupClient.quit();
		await cache.dispose();
	});

	test("can store and retrieve responses", async () => {
		const request = new Request("http://example.com/test");
		const response = new Response("Hello World", {
			status: 200,
			headers: {"Content-Type": "text/plain"},
		});

		await cache.put(request, response);

		const cached = await cache.match(request);
		expect(cached).toBeDefined();
		expect(cached!.status).toBe(200);
		expect(await cached!.text()).toBe("Hello World");
		expect(cached!.headers.get("content-type")).toBe("text/plain");
	});

	test("returns undefined for non-existent entries", async () => {
		const request = new Request("http://example.com/nonexistent");
		const cached = await cache.match(request);
		expect(cached).toBeUndefined();
	});

	test("can delete entries", async () => {
		const request = new Request("http://example.com/delete-test");
		const response = new Response("Delete me");

		await cache.put(request, response);
		expect(await cache.match(request)).toBeDefined();

		const deleted = await cache.delete(request);
		expect(deleted).toBe(true);
		expect(await cache.match(request)).toBeUndefined();
	});

	test("respects Cache-Control max-age", async () => {
		const request = new Request("http://example.com/ttl-test");
		const response = new Response("Short lived", {
			headers: {"Cache-Control": "max-age=1"},
		});

		await cache.put(request, response);

		// Should be cached immediately
		const cached1 = await cache.match(request);
		expect(cached1).toBeDefined();

		// Wait for expiration
		await new Promise((resolve) => setTimeout(resolve, 1500));

		// Should be expired now
		const cached2 = await cache.match(request);
		expect(cached2).toBeUndefined();
	});

	test("respects Vary header", async () => {
		const request1 = new Request("http://example.com/vary-test", {
			headers: {"Accept-Encoding": "gzip"},
		});
		const response1 = new Response("gzipped content", {
			headers: {Vary: "Accept-Encoding"},
		});

		await cache.put(request1, response1);

		// Same Accept-Encoding should match
		const matchingSame = new Request("http://example.com/vary-test", {
			headers: {"Accept-Encoding": "gzip"},
		});
		const cached1 = await cache.match(matchingSame);
		expect(cached1).toBeDefined();
		expect(await cached1!.text()).toBe("gzipped content");

		// Different Accept-Encoding should NOT match
		const matchingDifferent = new Request("http://example.com/vary-test", {
			headers: {"Accept-Encoding": "br"},
		});
		const cached2 = await cache.match(matchingDifferent);
		expect(cached2).toBeUndefined();

		// With ignoreVary: true, should match
		const cached3 = await cache.match(matchingDifferent, {ignoreVary: true});
		expect(cached3).toBeDefined();
	});

	test("handles Vary: * (never matches)", async () => {
		const request = new Request("http://example.com/vary-star");
		const response = new Response("data", {
			headers: {Vary: "*"},
		});

		await cache.put(request, response);

		// Vary: * means never match
		const cached = await cache.match(request);
		expect(cached).toBeUndefined();

		// ignoreVary bypasses this
		const cachedIgnore = await cache.match(request, {ignoreVary: true});
		expect(cachedIgnore).toBeDefined();
	});

	test("handles multiple Vary headers", async () => {
		const request = new Request("http://example.com/vary-multi", {
			headers: {
				"Accept-Encoding": "gzip",
				"User-Agent": "TestClient",
			},
		});
		const response = new Response("data", {
			headers: {Vary: "Accept-Encoding, User-Agent"},
		});

		await cache.put(request, response);

		// Both headers match
		const matched1 = await cache.match(
			new Request("http://example.com/vary-multi", {
				headers: {
					"Accept-Encoding": "gzip",
					"User-Agent": "TestClient",
				},
			}),
		);
		expect(matched1).toBeDefined();

		// One header different
		const matched2 = await cache.match(
			new Request("http://example.com/vary-multi", {
				headers: {
					"Accept-Encoding": "gzip",
					"User-Agent": "DifferentClient",
				},
			}),
		);
		expect(matched2).toBeUndefined();
	});

	test("can list cache keys", async () => {
		await cache.put(new Request("http://example.com/key1"), new Response("1"));
		await cache.put(new Request("http://example.com/key2"), new Response("2"));

		const keys = await cache.keys();
		expect(keys.length).toBeGreaterThanOrEqual(2);
		expect(keys.some((r) => r.url === "http://example.com/key1")).toBe(true);
		expect(keys.some((r) => r.url === "http://example.com/key2")).toBe(true);
	});

	test("handles binary data", async () => {
		const request = new Request("http://example.com/binary");
		const binaryData = new Uint8Array([1, 2, 3, 4, 5, 255, 254, 253]);
		const response = new Response(binaryData, {
			headers: {"Content-Type": "application/octet-stream"},
		});

		await cache.put(request, response);

		const cached = await cache.match(request);
		expect(cached).toBeDefined();

		const cachedData = new Uint8Array(await cached!.arrayBuffer());
		expect(cachedData).toEqual(binaryData);
	});

	test("handles large responses within size limit", async () => {
		const request = new Request("http://example.com/large");
		// Create a 1MB response (within default 10MB limit)
		const largeData = new Uint8Array(1024 * 1024).fill(42);
		const response = new Response(largeData);

		await cache.put(request, response);

		const cached = await cache.match(request);
		expect(cached).toBeDefined();

		const cachedData = new Uint8Array(await cached!.arrayBuffer());
		expect(cachedData.length).toBe(1024 * 1024);
	});

	test("rejects responses exceeding size limit", async () => {
		const smallCache = new RedisCache("small", {
			redis: {url: REDIS_URL},
			prefix: testPrefix,
			maxEntrySize: 1024, // 1KB limit
		});

		const request = new Request("http://example.com/toolarge");
		const largeData = new Uint8Array(2048).fill(42); // 2KB
		const response = new Response(largeData);

		await expect(smallCache.put(request, response)).rejects.toThrow(
			/too large/,
		);

		await smallCache.dispose();
	});

	test("handles concurrent requests", async () => {
		const requests = Array.from({length: 10}, (_, i) => ({
			request: new Request(`http://example.com/concurrent/${i}`),
			response: new Response(`Response ${i}`),
		}));

		// Put all concurrently
		await Promise.all(
			requests.map(({request, response}) => cache.put(request, response)),
		);

		// Get all concurrently
		const results = await Promise.all(
			requests.map(({request}) => cache.match(request)),
		);

		// All should be cached
		expect(results.every((r) => r !== undefined)).toBe(true);

		// Verify content
		for (let i = 0; i < 10; i++) {
			expect(await results[i]!.text()).toBe(`Response ${i}`);
		}
	});

	test("uses default TTL when no Cache-Control header", async () => {
		const shortTTLCache = new RedisCache("short-ttl", {
			redis: {url: REDIS_URL},
			prefix: testPrefix,
			defaultTTL: 1, // 1 second
		});

		const request = new Request("http://example.com/default-ttl");
		const response = new Response("Expires soon");

		await shortTTLCache.put(request, response);

		// Should be cached immediately
		const cached1 = await shortTTLCache.match(request);
		expect(cached1).toBeDefined();

		// Wait for expiration
		await new Promise((resolve) => setTimeout(resolve, 1500));

		// Should be expired
		const cached2 = await shortTTLCache.match(request);
		expect(cached2).toBeUndefined();

		await shortTTLCache.dispose();
	});
});
