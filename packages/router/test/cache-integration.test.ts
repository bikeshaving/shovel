import {test, expect, describe, beforeEach} from "bun:test";
import {Router} from "../src/index.js";
import {CustomCacheStorage} from "@b9g/cache/cache-storage.js";
import {MemoryCache} from "@b9g/cache/memory.js";

describe("Router Cache Integration", () => {
	let router: Router;
	let caches: CustomCacheStorage;

	beforeEach(() => {
		// Create a factory that creates MemoryCache instances
		const factory = (name: string) => new MemoryCache(name);
		caches = new CustomCacheStorage(factory);

		router = new Router({caches});
	});

	test("can create router with cache storage", () => {
		expect(router).toBeDefined();
		expect(router.getStats().routeCount).toBe(0);
	});

	test("can register routes with cache configuration", () => {
		const handler = async (_request: Request, _context: any) =>
			new Response("Hello");

		router
			.route({
				pattern: "/api/posts/:id",
				cache: {name: "posts"},
			})
			.get(handler);

		expect(router.getStats().routeCount).toBe(1);
	});

	test("provides cache context to handlers", async () => {
		let capturedContext: any = null;

		const handler = async (request: Request, context: any) => {
			capturedContext = context;
			return new Response("OK");
		};

		router
			.route({
				pattern: "/api/posts/:id",
				cache: {name: "posts"},
			})
			.get(handler);

		const request = new Request("http://example.com/api/posts/123");
		await router.match(request);

		expect(capturedContext).not.toBeNull();
		expect(capturedContext.params).toEqual({id: "123"});
		expect(capturedContext.cache).toBeDefined();
		expect(capturedContext.caches).toBe(caches);
	});

	test("provides caches but no specific cache when not configured", async () => {
		let capturedContext: any = null;

		const handler = async (request: Request, context: any) => {
			capturedContext = context;
			return new Response("OK");
		};

		router.route("/api/posts/:id").get(handler);

		const request = new Request("http://example.com/api/posts/123");
		await router.match(request);

		expect(capturedContext.cache).toBeUndefined();
		expect(capturedContext.caches).toBe(caches);
	});

	test("works without cache storage", async () => {
		const routerWithoutCache = new Router();
		let capturedContext: any = null;

		const handler = async (request: Request, context: any) => {
			capturedContext = context;
			return new Response("OK");
		};

		routerWithoutCache.route("/api/posts/:id").get(handler);

		const request = new Request("http://example.com/api/posts/123");
		await routerWithoutCache.match(request);

		expect(capturedContext.cache).toBeUndefined();
		expect(capturedContext.caches).toBeUndefined();
		expect(capturedContext.params).toEqual({id: "123"});
	});

	test("cache integration with middleware", async () => {
		const executionOrder: string[] = [];
		let middlewareContext: any = null;
		let handlerContext: any = null;

		const middleware = async (
			request: Request,
			context: any,
			next: () => Promise<Response>,
		) => {
			middlewareContext = context;
			executionOrder.push("middleware");
			const response = await next();
			executionOrder.push("middleware-after");
			return response;
		};

		const handler = async (request: Request, context: any) => {
			handlerContext = context;
			executionOrder.push("handler");
			return new Response("OK");
		};

		router.use(middleware);
		router
			.route({
				pattern: "/api/posts/:id",
				cache: {name: "posts"},
			})
			.get(handler);

		const request = new Request("http://example.com/api/posts/123");
		await router.match(request);

		expect(executionOrder).toEqual([
			"middleware",
			"handler",
			"middleware-after",
		]);

		// Both middleware and handler should get the same context with cache
		expect(middlewareContext.cache).toBe(handlerContext.cache);
		expect(middlewareContext.caches).toBe(handlerContext.caches);
		expect(middlewareContext.params).toEqual({id: "123"});
	});

	test("handles cache opening errors gracefully", async () => {
		// Create a factory that fails for specific cache names
		const failingFactory = (name: string) => {
			if (name === "failing-cache") {
				throw new Error("Cache creation failed");
			}
			return new MemoryCache(name);
		};
		const failingCaches = new CustomCacheStorage(failingFactory);
		const failingRouter = new Router({caches: failingCaches});

		let capturedContext: any = null;
		const handler = async (request: Request, context: any) => {
			capturedContext = context;
			return new Response("OK");
		};

		failingRouter
			.route({
				pattern: "/api/test",
				cache: {name: "failing-cache"},
			})
			.get(handler);

		const request = new Request("http://example.com/api/test");
		const response = await failingRouter.match(request);

		// Request should still succeed
		expect(response).not.toBeNull();
		expect(await response.text()).toBe("OK");

		// Cache should be undefined, but caches should still be available
		expect(capturedContext.cache).toBeUndefined();
		expect(capturedContext.caches).toBe(failingCaches);
	});

	test("can access different caches through context.caches", async () => {
		let _capturedContext: any = null;

		const handler = async (request: Request, context: any) => {
			_capturedContext = context;

			// Access a different cache through context.caches
			const usersCache = await context.caches.open("users");
			await usersCache.put(request, new Response("User data"));

			return new Response("OK");
		};

		router
			.route({
				pattern: "/api/posts/:id",
				cache: {name: "posts"},
			})
			.get(handler);

		const request = new Request("http://example.com/api/posts/123");
		await router.match(request);

		// Should have accessed users cache successfully
		const usersCache = await caches.open("users");
		const cachedResponse = await usersCache.match(request);

		expect(cachedResponse).not.toBeUndefined();
		expect(await cachedResponse.text()).toBe("User data");
	});
});
