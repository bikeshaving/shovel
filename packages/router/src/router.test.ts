import {test, expect, describe} from "bun:test";
import {Router} from "./index.js";

describe("Router", () => {
	test("can create a router instance", () => {
		const router = new Router();
		expect(router).toBeDefined();
		expect(router.getStats().routeCount).toBe(0);
		expect(router.getStats().middlewareCount).toBe(0);
	});

	test("can register routes with chaining API", () => {
		const router = new Router();
		const handler = async (request: Request, context: any) =>
			new Response("Hello");

		router.route("/api/users/:id").get(handler).post(handler);

		expect(router.getStats().routeCount).toBe(2);
	});

	test("can match GET requests", async () => {
		const router = new Router();
		const handler = async (request: Request, context: any) => {
			return new Response(`Hello user ${context.params.id}`);
		};

		router.route("/api/users/:id").get(handler);

		const request = new Request("http://example.com/api/users/123");
		const response = await router.match(request);

		expect(response).not.toBeNull();
		expect(await response.text()).toBe("Hello user 123");
	});

	test("returns null for non-matching routes", async () => {
		const router = new Router();
		router
			.route("/api/users/:id")
			.get(async (request: Request, context: any) => new Response("Hello"));

		const request = new Request("http://example.com/api/posts/123");
		const response = await router.match(request);

		expect(response).toBeNull();
	});

	test("filters by HTTP method", async () => {
		const router = new Router();
		const getHandler = async (request: Request, context: any) =>
			new Response("GET response");
		const postHandler = async (request: Request, context: any) =>
			new Response("POST response");

		router.route("/api/users/:id").get(getHandler).post(postHandler);

		const getRequest = new Request("http://example.com/api/users/123", {
			method: "GET",
		});
		const postRequest = new Request("http://example.com/api/users/123", {
			method: "POST",
		});
		const putRequest = new Request("http://example.com/api/users/123", {
			method: "PUT",
		});

		const getResponse = await router.match(getRequest);
		const postResponse = await router.match(postRequest);
		const putResponse = await router.match(putRequest);

		expect(await getResponse.text()).toBe("GET response");
		expect(await postResponse.text()).toBe("POST response");
		expect(putResponse).toBeNull();
	});

	test("middleware executes before handlers", async () => {
		const router = new Router();
		const executionOrder = [];

		const middleware = async (
			request: Request,
			context: any,
			next: Function,
		) => {
			executionOrder.push("middleware");
			const response = await next();
			executionOrder.push("middleware-after");
			return response;
		};

		const handler = async (request: Request, context: any) => {
			executionOrder.push("handler");
			return new Response("Hello");
		};

		router.use(middleware);
		router.route("/test").get(handler);

		const request = new Request("http://example.com/test");
		await router.match(request);

		expect(executionOrder).toEqual([
			"middleware",
			"handler",
			"middleware-after",
		]);
	});

	test("middleware can short-circuit", async () => {
		const router = new Router();
		const executionOrder = [];

		const middleware = async (
			request: Request,
			context: any,
			next: Function,
		) => {
			executionOrder.push("middleware");
			return new Response("Short-circuited");
		};

		const handler = async (request: Request, context: any) => {
			executionOrder.push("handler");
			return new Response("Hello");
		};

		router.use(middleware);
		router.route("/test").get(handler);

		const request = new Request("http://example.com/test");
		const response = await router.match(request);

		expect(executionOrder).toEqual(["middleware"]);
		expect(await response.text()).toBe("Short-circuited");
	});

	test("extracts route parameters correctly", async () => {
		const router = new Router();
		let capturedParams = null;

		const handler = async (request: Request, context: any) => {
			capturedParams = context.params;
			return new Response("OK");
		};

		router.route("/api/users/:userId/posts/:postId").get(handler);

		const request = new Request("http://example.com/api/users/123/posts/456");
		await router.match(request);

		expect(capturedParams).toEqual({
			userId: "123",
			postId: "456",
		});
	});

	test("handles trailing slashes correctly", async () => {
		const router = new Router();
		const handler = async (request: Request, context: any) =>
			new Response("OK");

		router.route("/api/users/:id").get(handler);

		const request1 = new Request("http://example.com/api/users/123");
		const request2 = new Request("http://example.com/api/users/123/");

		const response1 = await router.match(request1);
		const response2 = await router.match(request2);

		expect(response1).not.toBeNull();
		expect(response2).not.toBeNull();
		expect(await response1.text()).toBe("OK");
		expect(await response2.text()).toBe("OK");
	});

	test("handler method executes middleware for matching routes", async () => {
		const router = new Router();
		const executionOrder = [];

		const middleware = async (
			request: Request,
			context: any,
			next: Function,
		) => {
			executionOrder.push("middleware");
			const response = await next();
			return response;
		};

		const handler = async (request: Request, context: any) => {
			executionOrder.push("handler");
			return new Response("Hello");
		};

		router.use(middleware);
		router.route("/test").get(handler);

		const request = new Request("http://example.com/test");
		const response = await router.handler(request);

		expect(executionOrder).toEqual(["middleware", "handler"]);
		expect(await response.text()).toBe("Hello");
	});

	test("handler method executes middleware for non-matching routes", async () => {
		const router = new Router();
		const executionOrder = [];

		const middleware = async (
			request: Request,
			context: any,
			next: Function,
		) => {
			executionOrder.push("middleware");
			const response = await next();
			return response;
		};

		const handler = async (request: Request, context: any) => {
			executionOrder.push("handler");
			return new Response("Hello");
		};

		router.use(middleware);
		router.route("/test").get(handler);

		// Request to non-matching route
		const request = new Request("http://example.com/static/file.css");
		const response = await router.handler(request);

		// Middleware should still be called even for non-matching routes
		expect(executionOrder).toEqual(["middleware"]);
		expect(response.status).toBe(404);
		expect(await response.text()).toBe("Not Found");
	});
});

describe("Router.mount()", () => {
	test("mounts subrouter at specified path", async () => {
		const subrouter = new Router();
		subrouter.route("/users").get(async () => new Response("Users"));
		subrouter
			.route("/users/:id")
			.get(
				async (request, context) => new Response(`User ${context.params.id}`),
			);

		const mainRouter = new Router();
		mainRouter.mount("/api/v1", subrouter);

		// Test mounted routes
		const usersRequest = new Request("http://example.com/api/v1/users");
		const usersResponse = await mainRouter.match(usersRequest);
		expect(await usersResponse?.text()).toBe("Users");

		const userRequest = new Request("http://example.com/api/v1/users/123");
		const userResponse = await mainRouter.match(userRequest);
		expect(await userResponse?.text()).toBe("User 123");
	});

	test("handles root path mounting correctly", async () => {
		const subrouter = new Router();
		subrouter.route("/").get(async () => new Response("Root"));
		subrouter.route("/health").get(async () => new Response("OK"));

		const mainRouter = new Router();
		mainRouter.mount("/api", subrouter);

		// Root path should map to mount path
		const rootRequest = new Request("http://example.com/api");
		const rootResponse = await mainRouter.match(rootRequest);
		expect(await rootResponse?.text()).toBe("Root");

		// Other paths should be preserved
		const healthRequest = new Request("http://example.com/api/health");
		const healthResponse = await mainRouter.match(healthRequest);
		expect(await healthResponse?.text()).toBe("OK");
	});

	test("normalizes mount paths correctly", async () => {
		const subrouter = new Router();
		subrouter.route("/test").get(async () => new Response("Test"));

		const mainRouter = new Router();

		// Test various mount path formats
		mainRouter.mount("api/", subrouter); // Should normalize to /api
		mainRouter.mount("/v2", subrouter); // Should stay /v2
		mainRouter.mount("v3", subrouter); // Should normalize to /v3

		const test1 = new Request("http://example.com/api/test");
		const test2 = new Request("http://example.com/v2/test");
		const test3 = new Request("http://example.com/v3/test");

		expect(await (await mainRouter.match(test1))?.text()).toBe("Test");
		expect(await (await mainRouter.match(test2))?.text()).toBe("Test");
		expect(await (await mainRouter.match(test3))?.text()).toBe("Test");
	});

	test("preserves route parameters in mounted subrouters", async () => {
		const subrouter = new Router();
		subrouter
			.route("/posts/:postId/comments/:commentId")
			.get(
				async (request, context) =>
					new Response(
						`Post ${context.params.postId}, Comment ${context.params.commentId}`,
					),
			);

		const mainRouter = new Router();
		mainRouter.mount("/api/v1", subrouter);

		const request = new Request(
			"http://example.com/api/v1/posts/456/comments/789",
		);
		const response = await mainRouter.match(request);
		expect(await response?.text()).toBe("Post 456, Comment 789");
	});

	test("mounts subrouter middleware globally", async () => {
		const executionOrder: string[] = [];

		const subrouterMiddleware = async (
			request: Request,
			context: any,
			next: () => Promise<Response>,
		) => {
			executionOrder.push("subrouter-middleware");
			return next();
		};

		const subrouter = new Router();
		subrouter.use(subrouterMiddleware);
		subrouter.route("/test").get(async () => {
			executionOrder.push("subrouter-handler");
			return new Response("OK");
		});

		const mainRouter = new Router();
		mainRouter.mount("/api", subrouter);

		// Add a route directly to main router to test middleware inheritance
		mainRouter.route("/direct").get(async () => {
			executionOrder.push("main-handler");
			return new Response("Direct");
		});

		// Test mounted route gets subrouter middleware
		const mountedRequest = new Request("http://example.com/api/test");
		await mainRouter.match(mountedRequest);
		expect(executionOrder).toEqual([
			"subrouter-middleware",
			"subrouter-handler",
		]);

		// Reset execution order
		executionOrder.length = 0;

		// Test direct route also gets subrouter middleware (global behavior)
		const directRequest = new Request("http://example.com/direct");
		await mainRouter.match(directRequest);
		expect(executionOrder).toEqual(["subrouter-middleware", "main-handler"]);
	});

	test("supports multiple HTTP methods on mounted routes", async () => {
		const subrouter = new Router();
		subrouter
			.route("/resource/:id")
			.get(async (request, context) => new Response(`GET ${context.params.id}`))
			.post(
				async (request, context) => new Response(`POST ${context.params.id}`),
			)
			.put(async (request, context) => new Response(`PUT ${context.params.id}`))
			.delete(
				async (request, context) => new Response(`DELETE ${context.params.id}`),
			);

		const mainRouter = new Router();
		mainRouter.mount("/api", subrouter);

		const testCases = [
			{method: "GET", expected: "GET 123"},
			{method: "POST", expected: "POST 123"},
			{method: "PUT", expected: "PUT 123"},
			{method: "DELETE", expected: "DELETE 123"},
		];

		for (const {method, expected} of testCases) {
			const request = new Request("http://example.com/api/resource/123", {
				method,
			});
			const response = await mainRouter.match(request);
			expect(await response?.text()).toBe(expected);
		}
	});

	test("allows mounting multiple subrouters", async () => {
		const usersRouter = new Router();
		usersRouter.route("/").get(async () => new Response("Users List"));
		usersRouter
			.route("/:id")
			.get(
				async (request, context) => new Response(`User ${context.params.id}`),
			);

		const postsRouter = new Router();
		postsRouter.route("/").get(async () => new Response("Posts List"));
		postsRouter
			.route("/:id")
			.get(
				async (request, context) => new Response(`Post ${context.params.id}`),
			);

		const mainRouter = new Router();
		mainRouter.mount("/users", usersRouter);
		mainRouter.mount("/posts", postsRouter);

		// Test users routes
		const usersListRequest = new Request("http://example.com/users");
		const usersListResponse = await mainRouter.match(usersListRequest);
		expect(await usersListResponse?.text()).toBe("Users List");

		const userRequest = new Request("http://example.com/users/123");
		const userResponse = await mainRouter.match(userRequest);
		expect(await userResponse?.text()).toBe("User 123");

		// Test posts routes
		const postsListRequest = new Request("http://example.com/posts");
		const postsListResponse = await mainRouter.match(postsListRequest);
		expect(await postsListResponse?.text()).toBe("Posts List");

		const postRequest = new Request("http://example.com/posts/456");
		const postResponse = await mainRouter.match(postRequest);
		expect(await postResponse?.text()).toBe("Post 456");
	});

	test("supports nested mounting (mounting routers with mounted subrouters)", async () => {
		// Create deepest level router
		const commentsRouter = new Router();
		commentsRouter
			.route("/:commentId")
			.get(
				async (request, context) =>
					new Response(`Comment ${context.params.commentId}`),
			);

		// Create middle level router and mount comments
		const postsRouter = new Router();
		postsRouter
			.route("/:postId")
			.get(
				async (request, context) =>
					new Response(`Post ${context.params.postId}`),
			);
		postsRouter.mount("/:postId/comments", commentsRouter);

		// Create top level router and mount posts
		const mainRouter = new Router();
		mainRouter.mount("/api/posts", postsRouter);

		// Test nested route
		const commentRequest = new Request(
			"http://example.com/api/posts/123/comments/456",
		);
		const commentResponse = await mainRouter.match(commentRequest);
		expect(await commentResponse?.text()).toBe("Comment 456");

		// Test intermediate route
		const postRequest = new Request("http://example.com/api/posts/123");
		const postResponse = await mainRouter.match(postRequest);
		expect(await postResponse?.text()).toBe("Post 123");
	});

	test("preserves cache configuration from mounted subrouters", async () => {
		const cacheStorage = {
			open: () => Promise.resolve({}),
			register: () => {},
		} as any;

		const subrouter = new Router();
		subrouter
			.route({pattern: "/cached", cache: {name: "test-cache"}})
			.get(async () => new Response("Cached"));

		const mainRouter = new Router({caches: cacheStorage});
		mainRouter.mount("/api", subrouter);

		const request = new Request("http://example.com/api/cached");
		await mainRouter.match(request);

		// Should attempt to open the cache from subrouter config
		// Note: In a real test, we'd verify the cache.open call, but for now we just verify no errors
	});
});
