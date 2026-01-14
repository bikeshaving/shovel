/**
 * Platform API contract test runner
 *
 * Tests platform implementations against the Platform interface contract.
 * Unlike Cache and FileSystem, Platform is a custom Shovel abstraction,
 * not a web standard, so these are contract tests rather than WPT tests.
 */

import {describe, test, expect, beforeAll, afterAll, afterEach} from "bun:test";
import {getLogger} from "@logtape/logtape";

const logger = getLogger(["test", "wpt", "platform"]);

/**
 * Platform interface (mirrors @b9g/platform)
 */
interface Platform {
	readonly name: string;
	readonly serviceWorker: ShovelServiceWorkerContainer;
	listen(): Promise<Server>;
	close(): Promise<void>;
	createCaches(): Promise<CacheStorage>;
	createServer(handler: Handler, options?: ServerOptions): Server;
}

interface ShovelServiceWorkerContainer extends ServiceWorkerContainer {
	readonly pool?: any;
	terminate(): Promise<void>;
	reloadWorkers(entrypoint: string): Promise<void>;
}

type Handler = (
	request: Request,
	context?: any,
) => Promise<Response> | Response;

interface ServerOptions {
	port?: number;
	host?: string;
}

interface Server {
	listen(): Promise<void>;
	close(): Promise<void>;
	address(): {port: number; host: string};
	readonly url: string;
	readonly ready: boolean;
}

/**
 * Configuration for running platform tests
 */
export interface PlatformTestConfig {
	/** Factory function to create the platform instance */
	createPlatform: () => Platform | Promise<Platform>;
	/** Path to a simple test ServiceWorker entrypoint (optional) */
	testEntrypoint?: string;
	/**
	 * Path to a ServiceWorker entrypoint that tests ServiceWorkerGlobals features.
	 * The worker should handle these routes:
	 * - /test-caches: returns {cachesAvailable, cacheOpenWorks}
	 * - /test-directories: returns {directoriesAvailable}
	 * - /test-cookiestore: returns {cookieStoreAvailable, canReadCookie}
	 */
	testGlobalsEntrypoint?: string;
	/** Optional cleanup function */
	cleanup?: () => void | Promise<void>;
	/** Skip service worker tests (for platforms that don't support them) */
	skipServiceWorkerTests?: boolean;
	/** Skip server tests */
	skipServerTests?: boolean;
}

/**
 * Run contract tests against a Platform implementation
 *
 * @param name Name for the test suite (e.g., "BunPlatform", "NodePlatform")
 * @param config Test configuration
 */
export function runPlatformTests(
	name: string,
	config: PlatformTestConfig,
): void {
	describe(`Platform Contract Tests: ${name}`, () => {
		let platform: Platform;

		// Create platform once for all tests in this suite (not per-test)
		// This avoids module caching issues where ServiceWorker code only runs once
		beforeAll(async () => {
			platform = await config.createPlatform();
		});

		afterAll(async () => {
			await config.cleanup?.();
		});

		// =====================================================================
		// Basic Interface Tests
		// =====================================================================
		describe("Platform Interface", () => {
			test("has a name property", () => {
				expect(platform.name).toBeDefined();
				expect(typeof platform.name).toBe("string");
				expect(platform.name.length).toBeGreaterThan(0);
			});

			test("has serviceWorker container", () => {
				expect(platform.serviceWorker).toBeDefined();
				expect(typeof platform.serviceWorker.register).toBe("function");
			});

			test("has createCaches method", () => {
				expect(platform.createCaches).toBeDefined();
				expect(typeof platform.createCaches).toBe("function");
			});

			test("has createServer method", () => {
				expect(platform.createServer).toBeDefined();
				expect(typeof platform.createServer).toBe("function");
			});
		});

		// =====================================================================
		// CacheStorage Tests
		// =====================================================================
		describe("createCaches()", () => {
			test("returns a CacheStorage-like object", async () => {
				const caches = await platform.createCaches();
				expect(caches).toBeDefined();
			});

			test("CacheStorage has open method", async () => {
				const caches = await platform.createCaches();
				expect(caches.open).toBeDefined();
				expect(typeof caches.open).toBe("function");
			});

			test("CacheStorage has delete method", async () => {
				const caches = await platform.createCaches();
				expect(caches.delete).toBeDefined();
				expect(typeof caches.delete).toBe("function");
			});

			test("CacheStorage has has method", async () => {
				const caches = await platform.createCaches();
				expect(caches.has).toBeDefined();
				expect(typeof caches.has).toBe("function");
			});

			test("CacheStorage has keys method", async () => {
				const caches = await platform.createCaches();
				expect(caches.keys).toBeDefined();
				expect(typeof caches.keys).toBe("function");
			});

			test("CacheStorage has match method", async () => {
				const caches = await platform.createCaches();
				expect(caches.match).toBeDefined();
				expect(typeof caches.match).toBe("function");
			});

			test("can open a cache", async () => {
				const caches = await platform.createCaches();
				const cache = await caches.open("test-cache");
				expect(cache).toBeDefined();
				expect(cache.put).toBeDefined();
				expect(cache.match).toBeDefined();
			});

			test("opened cache is functional", async () => {
				const caches = await platform.createCaches();
				const cache = await caches.open("functional-test");

				// Put a response
				const request = new Request("https://example.com/test");
				const response = new Response("test body");
				await cache.put(request.clone(), response);

				// Match it back
				const matched = await cache.match(request);
				expect(matched).toBeDefined();
				expect(await matched?.text()).toBe("test body");
			});

			test("cache names are isolated", async () => {
				const caches = await platform.createCaches();

				const cache1 = await caches.open("cache-1");
				const cache2 = await caches.open("cache-2");

				await cache1.put(
					new Request("https://example.com/a"),
					new Response("from cache 1"),
				);

				// cache2 shouldn't have the entry
				const matched = await cache2.match("https://example.com/a");
				expect(matched).toBeUndefined();
			});
		});

		// =====================================================================
		// Server Tests
		// =====================================================================
		if (!config.skipServerTests) {
			describe("createServer()", () => {
				let server: Server | null = null;

				afterEach(async () => {
					if (server) {
						try {
							await server.close();
						} catch (err) {
							logger.debug`Server close error: ${err}`;
						}
						server = null;
					}
				});

				test("creates a server instance", () => {
					const handler: Handler = async () => new Response("ok");
					server = platform.createServer(handler);
					expect(server).toBeDefined();
				});

				test("server has required methods", () => {
					const handler: Handler = async () => new Response("ok");
					server = platform.createServer(handler);

					expect(server.listen).toBeDefined();
					expect(server.close).toBeDefined();
					expect(server.address).toBeDefined();
				});

				test("server has url property", () => {
					const handler: Handler = async () => new Response("ok");
					server = platform.createServer(handler, {port: 0});

					expect(server.url).toBeDefined();
					expect(typeof server.url).toBe("string");
				});

				test("server can listen and close", async () => {
					const handler: Handler = async () => new Response("ok");
					server = platform.createServer(handler, {port: 0});

					await server.listen();
					expect(server.ready).toBe(true);

					await server.close();
					// After close, ready might be false or server might throw
				});

				test("server responds to requests", async () => {
					const handler: Handler = async (req) => {
						return new Response(`Hello from ${req.url}`);
					};
					server = platform.createServer(handler, {port: 0});

					await server.listen();

					const response = await fetch(server.url);
					expect(response.ok).toBe(true);

					const text = await response.text();
					expect(text).toContain("Hello from");
				});

				test("server passes request correctly", async () => {
					const handler: Handler = async (req) => {
						return new Response(
							JSON.stringify({
								method: req.method,
								url: req.url,
								headers: Object.fromEntries(req.headers),
							}),
							{headers: {"Content-Type": "application/json"}},
						);
					};
					server = platform.createServer(handler, {port: 0});

					await server.listen();

					const response = await fetch(`${server.url}/test-path`, {
						method: "POST",
						headers: {"X-Custom": "value"},
					});

					const data = await response.json();
					expect(data.method).toBe("POST");
					expect(data.url).toContain("/test-path");
					expect(data.headers["x-custom"]).toBe("value");
				});
			});
		}

		// =====================================================================
		// ServiceWorker Tests
		// =====================================================================
		if (!config.skipServiceWorkerTests && config.testEntrypoint) {
			describe("loadServiceWorker()", () => {
				// Share one SW instance for all tests to avoid module caching issues
				let sw: ServiceWorkerInstance | null = null;

				beforeAll(async () => {
					sw = await platform.loadServiceWorker(config.testEntrypoint!);
				});

				afterAll(async () => {
					if (sw) {
						try {
							await sw.dispose();
						} catch (err) {
							logger.debug`ServiceWorker dispose error: ${err}`;
						}
						sw = null;
					}
				});

				test("loads a service worker", async () => {
					expect(sw).toBeDefined();
				});

				test("service worker has required interface", async () => {
					expect(sw!.handleRequest).toBeDefined();
					expect(sw!.install).toBeDefined();
					expect(sw!.activate).toBeDefined();
					expect(sw!.dispose).toBeDefined();
				});

				test("service worker can handle requests", async () => {
					const request = new Request("https://example.com/test");
					const response = await sw!.handleRequest(request);

					expect(response).toBeInstanceOf(Response);
				});
			});
		}

		// =====================================================================
		// ServiceWorkerGlobals Feature Tests
		// These test that features work inside ServiceWorker handlers
		// =====================================================================
		if (!config.skipServiceWorkerTests && config.testGlobalsEntrypoint) {
			describe("ServiceWorkerGlobals features", () => {
				// Share one SW instance for all tests to avoid module caching issues
				let sw: ServiceWorkerInstance | null = null;

				beforeAll(async () => {
					sw = await platform.loadServiceWorker(config.testGlobalsEntrypoint!);
				});

				afterAll(async () => {
					if (sw) {
						try {
							await sw.dispose();
						} catch (err) {
							logger.debug`ServiceWorker globals dispose error: ${err}`;
						}
						sw = null;
					}
				});

				test("caches: can open, put, match, and delete", async () => {
					const request = new Request("https://example.com/test-caches");
					const response = await sw!.handleRequest(request);
					const data = await response.json();

					if (!data.success) {
						logger.error`Cache test failed: ${data}`;
					}
					expect(data.canOpen).toBe(true);
					expect(data.canPut).toBe(true);
					expect(data.canMatch).toBe(true);
					expect(data.canDelete).toBe(true);
					expect(data.success).toBe(true);
				});

				test("directories: can open, write, and read files", async () => {
					const request = new Request("https://example.com/test-directories");
					const response = await sw!.handleRequest(request);
					const data = await response.json();

					if (!data.success) {
						logger.error`Directories test failed: ${data}`;
					}
					expect(data.canOpen).toBe(true);
					expect(data.canWrite).toBe(true);
					expect(data.canRead).toBe(true);
					expect(data.success).toBe(true);
				});

				test("cookieStore: can read cookies from request", async () => {
					const request = new Request("https://example.com/test-cookiestore", {
						headers: {Cookie: "test=value"},
					});
					const response = await sw!.handleRequest(request);
					const data = await response.json();

					if (!data.success) {
						logger.error`CookieStore test failed: ${data}`;
					}
					expect(data.canGet).toBe(true);
					expect(data.canReadFromRequest).toBe(true);
					expect(data.cookieValue).toBe("value");
					expect(data.success).toBe(true);
				});
			});
		}
	});
}
