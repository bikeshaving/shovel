import {test, expect, describe} from "bun:test";
import {Router} from "../src/index.js";

describe("Router", () => {
	test("can create a router instance", () => {
		const router = new Router();
		expect(router).toBeDefined();
		expect(router.getStats().routeCount).toBe(0);
		expect(router.getStats().middlewareCount).toBe(0);
	});

	test("can register routes with chaining API", () => {
		const router = new Router();
		const handler = async () => new Response("Hello");

		router.route("/api/users/:id").get(handler).post(handler);

		expect(router.getStats().routeCount).toBe(2);
	});

	test("can match GET requests", async () => {
		const router = new Router();
		const handler = async (_request: Request, context: any) => {
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
		router.route("/api/users/:id").get(async () => new Response("Hello"));

		const request = new Request("http://example.com/api/posts/123");
		const response = await router.match(request);

		expect(response).toBeNull();
	});

	test("extracts route parameters correctly", async () => {
		const router = new Router();
		let capturedParams = null;

		const handler = async (_request: Request, context: any) => {
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
});

describe("Middleware Detection", () => {
	test("detects async generator functions as generator middleware", () => {
		const router = new Router();

		async function* generatorMiddleware(request: Request, _context: any) {
			const response = yield request;
			return response;
		}

		router.use(generatorMiddleware);
		expect(router.getStats().middlewareCount).toBe(1);
	});

	test("detects regular async functions as function middleware", () => {
		const router = new Router();

		async function functionMiddleware(request: Request, context: any) {
			context.processed = true;
		}

		router.use(functionMiddleware);
		expect(router.getStats().middlewareCount).toBe(1);
	});

	test("detects regular functions as function middleware", () => {
		const router = new Router();

		function syncMiddleware(request: Request, context: any) {
			context.processed = true;
		}

		router.use(syncMiddleware);
		expect(router.getStats().middlewareCount).toBe(1);
	});

	test("throws error for invalid middleware types", () => {
		const router = new Router();

		expect(() => {
			router.use("not a function" as any);
		}).toThrow();

		expect(() => {
			router.use(null as any);
		}).toThrow();

		expect(() => {
			router.use(undefined as any);
		}).toThrow();
	});
});

describe("Generator Middleware Execution", () => {
	test("executes generator middleware with yield request", async () => {
		const router = new Router();
		const executionOrder: string[] = [];

		async function* testMiddleware(request: Request, _context: any) {
			executionOrder.push("middleware-before");
			const response = yield request;
			executionOrder.push("middleware-after");
			response.headers.set("X-Middleware", "processed");
			return response;
		}

		const handler = async () => {
			executionOrder.push("handler");
			return new Response("Hello");
		};

		router.use(testMiddleware);
		router.route("/test").get(handler);

		const request = new Request("http://example.com/test");
		const response = await router.match(request);

		expect(executionOrder).toEqual([
			"middleware-before",
			"handler",
			"middleware-after",
		]);
		expect(response?.headers.get("X-Middleware")).toBe("processed");
		expect(await response?.text()).toBe("Hello");
	});

	test("executes generator middleware with yield (implicit request)", async () => {
		const router = new Router();
		const executionOrder: string[] = [];

		async function* testMiddleware(_request: Request, _context: any) {
			executionOrder.push("middleware-before");
			const response = yield; // Implicit yield request
			executionOrder.push("middleware-after");
			return response;
		}

		const handler = async () => {
			executionOrder.push("handler");
			return new Response("Hello");
		};

		router.use(testMiddleware);
		router.route("/test").get(handler);

		const request = new Request("http://example.com/test");
		const response = await router.match(request);

		expect(executionOrder).toEqual([
			"middleware-before",
			"handler",
			"middleware-after",
		]);
		expect(await response?.text()).toBe("Hello");
	});

	test("handles early returns (0 yields)", async () => {
		const router = new Router();
		const executionOrder: string[] = [];

		async function* authMiddleware(request: Request, context: any) {
			executionOrder.push("auth-middleware");
			const token = request.headers.get("Authorization");

			if (!token) {
				return new Response("Unauthorized", {status: 401});
			}

			context.user = {id: "123"};
			const response = yield request;
			return response;
		}

		const handler = async () => {
			executionOrder.push("handler");
			return new Response("Hello");
		};

		router.use(authMiddleware);
		router.route("/test").get(handler);

		// Test without auth header
		const request = new Request("http://example.com/test");
		const response = await router.match(request);

		expect(executionOrder).toEqual(["auth-middleware"]);
		expect(response?.status).toBe(401);
		expect(await response?.text()).toBe("Unauthorized");
	});

	test("handles passthrough returns (null/undefined)", async () => {
		const router = new Router();

		async function* setupMiddleware(_request: Request, context: any) {
			context.setupDone = true;
			yield; // Generator must have yield
			return; // null/undefined passthrough
		}

		const handler = async (_request: Request, context: any) => {
			return new Response(`Setup: ${context.setupDone}`);
		};

		router.use(setupMiddleware);
		router.route("/test").get(handler);

		const request = new Request("http://example.com/test");
		const response = await router.match(request);

		expect(await response?.text()).toBe("Setup: true");
	});

	test("modifies request before yield", async () => {
		const router = new Router();

		async function* headerMiddleware(request: Request, _context: any) {
			request.headers.set("X-Added-Header", "test-value");
			const response = yield request;
			return response;
		}

		const handler = async (request: Request) => {
			const headerValue = request.headers.get("X-Added-Header");
			return new Response(`Header: ${headerValue}`);
		};

		router.use(headerMiddleware);
		router.route("/test").get(handler);

		const request = new Request("http://example.com/test");
		const response = await router.match(request);

		expect(await response?.text()).toBe("Header: test-value");
	});

	test("modifies response after yield", async () => {
		const router = new Router();

		async function* responseMiddleware(request: Request, _context: any) {
			const response = yield request;
			response.headers.set("X-Response-Modified", "true");
			return response;
		}

		const handler = async () => new Response("Hello");

		router.use(responseMiddleware);
		router.route("/test").get(handler);

		const request = new Request("http://example.com/test");
		const response = await router.match(request);

		expect(response?.headers.get("X-Response-Modified")).toBe("true");
		expect(await response?.text()).toBe("Hello");
	});
});

describe("Function Middleware Execution", () => {
	test("executes function middleware with implicit passthrough", async () => {
		const router = new Router();

		async function functionMiddleware(request: Request, context: any) {
			context.processedByFunction = true;
			request.headers.set("X-Function-Middleware", "true");
		}

		const handler = async (request: Request, context: any) => {
			const fromContext = context.processedByFunction;
			const fromHeader = request.headers.get("X-Function-Middleware");
			return new Response(`Context: ${fromContext}, Header: ${fromHeader}`);
		};

		router.use(functionMiddleware);
		router.route("/test").get(handler);

		const request = new Request("http://example.com/test");
		const response = await router.match(request);

		expect(await response?.text()).toBe("Context: true, Header: true");
	});
});

describe("Middleware Short-Circuiting", () => {
	test("middleware short-circuits on early Response return from generator", async () => {
		const router = new Router();
		const executionOrder: string[] = [];

		// eslint-disable-next-line require-yield
		async function* authMiddleware(_request: Request, _context: any) {
			executionOrder.push("auth");
			return new Response("Unauthorized", {status: 401}); // Early return should short-circuit
		}

		async function* corsMiddleware(request: Request, _context: any) {
			executionOrder.push("cors"); // Should NOT execute
			const response = yield request;
			response.headers.set("Access-Control-Allow-Origin", "*");
			return response;
		}

		async function* loggingMiddleware(request: Request, _context: any) {
			executionOrder.push("logging"); // Should NOT execute
			const response = yield request;
			response.headers.set("X-Request-Logged", "true");
			return response;
		}

		const handler = async () => {
			executionOrder.push("handler"); // Should NOT execute
			return new Response("Hello");
		};

		router.use(authMiddleware);
		router.use(corsMiddleware);
		router.use(loggingMiddleware);
		router.route("/test").get(handler);

		const request = new Request("http://example.com/test");
		const response = await router.match(request);

		// Only auth middleware should execute, everything else short-circuited
		expect(executionOrder).toEqual(["auth"]);
		expect(response?.status).toBe(401);
		expect(await response?.text()).toBe("Unauthorized");
		// Headers from cors and logging should NOT be present
		expect(response?.headers.get("Access-Control-Allow-Origin")).toBeNull();
		expect(response?.headers.get("X-Request-Logged")).toBeNull();
	});

	test("middleware short-circuits on early Response return from function middleware", async () => {
		const router = new Router();
		const executionOrder: string[] = [];

		async function authMiddleware(
			_request: Request,
			_context: any,
		): Promise<Response | null> {
			executionOrder.push("auth");
			return new Response("Unauthorized", {status: 401}); // Early return should short-circuit
		}

		async function corsMiddleware(_request: Request, _context: any) {
			executionOrder.push("cors"); // Should NOT execute
		}

		const handler = async () => {
			executionOrder.push("handler"); // Should NOT execute
			return new Response("Hello");
		};

		router.use(authMiddleware);
		router.use(corsMiddleware);
		router.route("/test").get(handler);

		const request = new Request("http://example.com/test");
		const response = await router.match(request);

		// Only auth middleware should execute
		expect(executionOrder).toEqual(["auth"]);
		expect(response?.status).toBe(401);
		expect(await response?.text()).toBe("Unauthorized");
	});

	test("middleware continues on null/undefined return (fallthrough)", async () => {
		const router = new Router();
		const executionOrder: string[] = [];

		async function passthroughMiddleware(
			_request: Request,
			_context: any,
		): Promise<null> {
			executionOrder.push("passthrough");
			return null; // Should continue to next middleware
		}

		async function* processingMiddleware(request: Request, _context: any) {
			executionOrder.push("processing");
			const response = yield request;
			response.headers.set("X-Processed", "true");
			return response;
		}

		const handler = async () => {
			executionOrder.push("handler");
			return new Response("Hello");
		};

		router.use(passthroughMiddleware);
		router.use(processingMiddleware);
		router.route("/test").get(handler);

		const request = new Request("http://example.com/test");
		const response = await router.match(request);

		// All should execute because null means fallthrough
		expect(executionOrder).toEqual(["passthrough", "processing", "handler"]);
		expect(response?.status).toBe(200);
		expect(await response?.text()).toBe("Hello");
		expect(response?.headers.get("X-Processed")).toBe("true");
	});

	test("middleware continues on undefined return (fallthrough)", async () => {
		const router = new Router();
		const executionOrder: string[] = [];

		async function implicitUndefinedMiddleware(
			_request: Request,
			_context: any,
		) {
			executionOrder.push("implicit");
			// Implicit undefined return
		}

		async function explicitUndefinedMiddleware(
			_request: Request,
			_context: any,
		): Promise<undefined> {
			executionOrder.push("explicit");
			return undefined; // Explicit undefined return
		}

		const handler = async () => {
			executionOrder.push("handler");
			return new Response("Hello");
		};

		router.use(implicitUndefinedMiddleware);
		router.use(explicitUndefinedMiddleware);
		router.route("/test").get(handler);

		const request = new Request("http://example.com/test");
		const response = await router.match(request);

		// All should execute because undefined means fallthrough
		expect(executionOrder).toEqual(["implicit", "explicit", "handler"]);
		expect(response?.status).toBe(200);
		expect(await response?.text()).toBe("Hello");
	});

	test("execution order is preserved", async () => {
		const router = new Router();
		const executionOrder: string[] = [];

		async function* middleware1(request: Request, _context: any) {
			executionOrder.push("middleware1-before");
			const response = yield request;
			executionOrder.push("middleware1-after");
			return response;
		}

		async function* middleware2(request: Request, _context: any) {
			executionOrder.push("middleware2-before");
			const response = yield request;
			executionOrder.push("middleware2-after");
			return response;
		}

		async function* middleware3(request: Request, _context: any) {
			executionOrder.push("middleware3-before");
			const response = yield request;
			executionOrder.push("middleware3-after");
			return response;
		}

		const handler = async () => {
			executionOrder.push("handler");
			return new Response("Hello");
		};

		router.use(middleware1);
		router.use(middleware2);
		router.use(middleware3);
		router.route("/test").get(handler);

		const request = new Request("http://example.com/test");
		await router.match(request);

		expect(executionOrder).toEqual([
			"middleware1-before",
			"middleware2-before",
			"middleware3-before",
			"handler",
			"middleware3-after",
			"middleware2-after",
			"middleware1-after",
		]);
	});

	test("chained generator middleware with yield request should preserve request object", async () => {
		const router = new Router();
		let firstMiddlewareURL: string | undefined;
		let secondMiddlewareURL: string | undefined;
		let firstURLError: Error | null = null;
		let secondURLError: Error | null = null;

		// First generator middleware (like pageCache)
		async function* firstMiddleware(request: Request, _context: any) {
			try {
				// Try to access request.url - should work
				firstMiddlewareURL = request.url;
				new URL(request.url); // Should not throw

				// Pass through
				const response = yield request;
				return response;
			} catch (error) {
				firstURLError = error as Error;
				return new Response("First middleware URL error: " + error.message, {
					status: 500,
				});
			}
		}

		// Second generator middleware (like assets middleware)
		async function* secondMiddleware(request: Request, _context: any) {
			try {
				// Try to access request.url - this is where the bug manifests
				secondMiddlewareURL = request.url;
				const url = new URL(request.url); // This should not throw "Invalid URL: [object Object]"

				// Only handle specific paths
				if (!url.pathname.startsWith("/assets")) {
					const response = yield request;
					return response;
				}

				return new Response("Asset handled", {status: 200});
			} catch (error) {
				secondURLError = error as Error;
				return new Response("Second middleware URL error: " + error.message, {
					status: 500,
				});
			}
		}

		router.use(firstMiddleware);
		router.use(secondMiddleware);
		router.route("/test").get(async () => new Response("Hello"));

		const request = new Request("http://example.com/test");
		const response = await router.handler(request);

		// Both middleware should see the same valid URL
		expect(firstURLError).toBeNull();
		expect(secondURLError).toBeNull();
		expect(firstMiddlewareURL).toBe("http://example.com/test");
		expect(secondMiddlewareURL).toBe("http://example.com/test");
		expect(typeof firstMiddlewareURL).toBe("string");
		expect(typeof secondMiddlewareURL).toBe("string");
		expect(response?.status).toBe(200);
	});

	test("works with mixed generator and function middleware", async () => {
		const router = new Router();
		const executionOrder: string[] = [];

		function functionMiddleware1(request: Request, context: any) {
			executionOrder.push("function1");
			context.func1 = true;
		}

		async function* generatorMiddleware(request: Request, _context: any) {
			executionOrder.push("generator-before");
			const response = yield request;
			executionOrder.push("generator-after");
			response.headers.set("X-Generator", "true");
			return response;
		}

		async function functionMiddleware2(request: Request, context: any) {
			executionOrder.push("function2");
			context.func2 = true;
		}

		const handler = async (_request: Request, context: any) => {
			executionOrder.push("handler");
			return new Response(`func1:${context.func1} func2:${context.func2}`);
		};

		router.use(functionMiddleware1);
		router.use(generatorMiddleware);
		router.use(functionMiddleware2);
		router.route("/test").get(handler);

		const request = new Request("http://example.com/test");
		const response = await router.match(request);

		expect(executionOrder).toEqual([
			"function1",
			"generator-before",
			"function2",
			"handler",
			"generator-after",
		]);
		expect(await response?.text()).toBe("func1:true func2:true");
		expect(response?.headers.get("X-Generator")).toBe("true");
	});
});

describe("Context Sharing", () => {
	test("context is shared between all middleware and handlers", async () => {
		const router = new Router();

		async function* middleware1(request: Request, context: any) {
			context.step1 = "completed";
			const response = yield request;
			context.responseTime = Date.now() - context.startTime;
			return response;
		}

		function middleware2(request: Request, context: any) {
			context.step2 = "completed";
			context.startTime = Date.now();
		}

		async function* middleware3(request: Request, context: any) {
			context.step3 = "completed";
			const response = yield request;
			response.headers.set(
				"X-Steps",
				`${context.step1},${context.step2},${context.step3}`,
			);
			return response;
		}

		const handler = async (_request: Request, context: any) => {
			return new Response(
				`All steps: ${context.step1} ${context.step2} ${context.step3}`,
			);
		};

		router.use(middleware1);
		router.use(middleware2);
		router.use(middleware3);
		router.route("/test").get(handler);

		const request = new Request("http://example.com/test");
		const response = await router.match(request);

		expect(await response?.text()).toBe(
			"All steps: completed completed completed",
		);
		expect(response?.headers.get("X-Steps")).toBe(
			"completed,completed,completed",
		);
	});

	test("middleware can enrich context for handlers", async () => {
		const router = new Router();

		async function* authMiddleware(request: Request, context: any) {
			const token = request.headers.get("Authorization");
			if (token === "valid-token") {
				context.user = {id: "123", name: "John"};
			}
			const response = yield request;
			return response;
		}

		function enrichMiddleware(request: Request, context: any) {
			if (context.user) {
				context.permissions = ["read", "write"];
			}
		}

		const handler = async (_request: Request, context: any) => {
			if (!context.user) {
				return new Response("No user", {status: 401});
			}
			return new Response(
				`User: ${context.user.name}, Permissions: ${context.permissions.join(",")}`,
			);
		};

		router.use(authMiddleware);
		router.use(enrichMiddleware);
		router.route("/test").get(handler);

		const request = new Request("http://example.com/test", {
			headers: {Authorization: "valid-token"},
		});
		const response = await router.match(request);

		expect(await response?.text()).toBe("User: John, Permissions: read,write");
	});
});

describe("Error Handling", () => {
	test("middleware can handle errors with try/catch", async () => {
		const router = new Router();

		async function* errorHandlingMiddleware(request: Request, _context: any) {
			try {
				const response = yield request;
				return response;
			} catch (error) {
				return new Response(`Error caught: ${error.message}`, {status: 500});
			}
		}

		const handler = async () => {
			throw new Error("Handler error");
		};

		router.use(errorHandlingMiddleware);
		router.route("/test").get(handler);

		const request = new Request("http://example.com/test");
		const response = await router.match(request);

		expect(response?.status).toBe(500);
		expect(await response?.text()).toBe("Error caught: Handler error");
	});
});

describe("Automatic Redirects", () => {
	test("returns 302 for URL changes by default", async () => {
		const router = new Router();

		async function* redirectMiddleware(request: Request, _context: any) {
			if (request.url.endsWith("/old-path")) {
				request.url = request.url.replace("/old-path", "/new-path");
			}
			const response = yield request;
			return response;
		}

		router.use(redirectMiddleware);
		router.route("/new-path").get(async () => new Response("New path"));

		const request = new Request("http://example.com/old-path");
		const response = await router.match(request);

		expect(response?.status).toBe(302);
		expect(response?.headers.get("Location")).toBe(
			"http://example.com/new-path",
		);
	});

	test("returns 301 for protocol changes (http->https)", async () => {
		const router = new Router();

		async function* httpsRedirectMiddleware(request: Request, _context: any) {
			if (request.url.startsWith("http://")) {
				request.url = request.url.replace("http://", "https://");
			}
			const response = yield request;
			return response;
		}

		router.use(httpsRedirectMiddleware);

		const request = new Request("http://example.com/test");
		const response = await router.match(request);

		expect(response?.status).toBe(301);
		expect(response?.headers.get("Location")).toBe("https://example.com/test");
	});

	test("returns 307 for non-GET method changes", async () => {
		const router = new Router();

		async function* apiVersionMiddleware(request: Request, _context: any) {
			if (request.url.includes("/api/v1/")) {
				request.url = request.url.replace("/api/v1/", "/api/v2/");
			}
			const response = yield request;
			return response;
		}

		router.use(apiVersionMiddleware);

		const request = new Request("http://example.com/api/v1/users", {
			method: "POST",
		});
		const response = await router.match(request);

		expect(response?.status).toBe(307);
		expect(response?.headers.get("Location")).toBe(
			"http://example.com/api/v2/users",
		);
	});

	test("throws error for cross-origin URL changes", async () => {
		const router = new Router();

		async function* maliciousMiddleware(request: Request, _context: any) {
			request.url = "https://evil.com/steal-data";
			const response = yield request;
			return response;
		}

		router.use(maliciousMiddleware);
		router.route("/test").get(async () => new Response("Test"));

		const request = new Request("http://example.com/test");

		await expect(router.match(request)).rejects.toThrow(/origin/);
	});

	test("redirect responses flow through remaining middleware", async () => {
		const router = new Router();

		async function* redirectMiddleware(request: Request, _context: any) {
			request.url = request.url.replace("/old", "/new");
			const response = yield request;
			return response;
		}

		async function* headerMiddleware(request: Request, _context: any) {
			const response = yield request;
			response.headers.set("X-Processed", "true");
			return response;
		}

		router.use(redirectMiddleware);
		router.use(headerMiddleware);

		const request = new Request("http://example.com/old");
		const response = await router.match(request);

		expect(response?.status).toBe(302);
		expect(response?.headers.get("Location")).toBe("http://example.com/new");
		expect(response?.headers.get("X-Processed")).toBe("true");
	});
});

describe("Router Integration", () => {
	test("handler method executes middleware for matching routes", async () => {
		const router = new Router();
		const executionOrder: string[] = [];

		async function* middleware(request: Request, _context: any) {
			executionOrder.push("middleware");
			const response = yield request;
			return response;
		}

		const handler = async () => {
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
		const executionOrder: string[] = [];

		async function* middleware(request: Request, _context: any) {
			executionOrder.push("middleware");
			const response = yield request;
			return response;
		}

		router.use(middleware);
		router.route("/test").get(async () => new Response("Hello"));

		const request = new Request("http://example.com/nonexistent");
		const response = await router.handler(request);

		expect(executionOrder).toEqual(["middleware"]);
		expect(response.status).toBe(404);
		expect(await response.text()).toBe("Not Found");
	});
});

describe("Advanced Generator Middleware", () => {
	test("multiple generators with complex yielding patterns", async () => {
		const router = new Router();
		const executionOrder: string[] = [];

		async function* authMiddleware(request: Request, context: any) {
			executionOrder.push("auth-start");
			context.authenticated = true;
			const response = yield request;
			executionOrder.push("auth-end");
			response.headers.set("X-Auth", "verified");
			return response;
		}

		async function* loggingMiddleware(request: Request, context: any) {
			executionOrder.push("logging-start");
			context.requestTime = Date.now();
			const response = yield request;
			executionOrder.push("logging-end");
			response.headers.set("X-Request-Time", context.requestTime.toString());
			return response;
		}

		async function* corsMiddleware(request: Request, _context: any) {
			executionOrder.push("cors-start");
			const response = yield request;
			executionOrder.push("cors-end");
			response.headers.set("Access-Control-Allow-Origin", "*");
			return response;
		}

		const handler = async (request: Request, context: any) => {
			executionOrder.push("handler");
			return new Response(`Auth: ${context.authenticated}`);
		};

		router.use(authMiddleware);
		router.use(loggingMiddleware);
		router.use(corsMiddleware);
		router.route("/test").get(handler);

		const request = new Request("http://example.com/test");
		const response = await router.match(request);

		expect(executionOrder).toEqual([
			"auth-start",
			"logging-start",
			"cors-start",
			"handler",
			"cors-end",
			"logging-end",
			"auth-end",
		]);
		expect(response?.headers.get("X-Auth")).toBe("verified");
		expect(response?.headers.get("Access-Control-Allow-Origin")).toBe("*");
		expect(response?.headers.has("X-Request-Time")).toBe(true);
		expect(await response?.text()).toBe("Auth: true");
	});

	test("generators with conditional early returns", async () => {
		const router = new Router();
		const executionOrder: string[] = [];

		async function* rateLimitMiddleware(request: Request, _context: any) {
			executionOrder.push("rate-limit");
			const rateLimited = request.headers.get("X-Rate-Limited");

			if (rateLimited === "true") {
				return new Response("Rate limited", {status: 429});
			}

			const response = yield request;
			response.headers.set("X-Rate-Limit", "OK");
			return response;
		}

		async function* analyticsMiddleware(request: Request, _context: any) {
			executionOrder.push("analytics");
			const response = yield request;
			response.headers.set("X-Analytics", "tracked");
			return response;
		}

		const handler = async () => {
			executionOrder.push("handler");
			return new Response("Success");
		};

		router.use(rateLimitMiddleware);
		router.use(analyticsMiddleware);
		router.route("/test").get(handler);

		// Test rate limited request
		const rateLimitedRequest = new Request("http://example.com/test", {
			headers: {"X-Rate-Limited": "true"},
		});
		const rateLimitedResponse = await router.match(rateLimitedRequest);

		expect(executionOrder).toEqual(["rate-limit"]); // analytics should NOT run due to short-circuit
		expect(rateLimitedResponse?.status).toBe(429);
		expect(rateLimitedResponse?.headers.get("X-Analytics")).toBeNull(); // no analytics header since it didn't run
		expect(await rateLimitedResponse?.text()).toBe("Rate limited");

		// Test normal request
		executionOrder.length = 0;
		const normalRequest = new Request("http://example.com/test");
		const normalResponse = await router.match(normalRequest);

		expect(executionOrder).toEqual(["rate-limit", "analytics", "handler"]);
		expect(normalResponse?.status).toBe(200);
		expect(normalResponse?.headers.get("X-Rate-Limit")).toBe("OK");
		expect(normalResponse?.headers.get("X-Analytics")).toBe("tracked");
	});

	test("error propagation through generator stack", async () => {
		const router = new Router();
		const executionOrder: string[] = [];

		async function* errorHandlingMiddleware(request: Request, _context: any) {
			executionOrder.push("error-handler-start");
			try {
				const response = yield request;
				executionOrder.push("error-handler-success");
				return response;
			} catch (error) {
				executionOrder.push("error-handler-catch");
				return new Response(`Caught: ${error.message}`, {status: 500});
			}
		}

		async function* normalMiddleware(request: Request, _context: any) {
			executionOrder.push("normal-middleware");
			const response = yield request;
			executionOrder.push("normal-middleware");
			response.headers.set("X-Normal", "processed");
			return response;
		}

		const faultyHandler = async () => {
			executionOrder.push("faulty-handler");
			throw new Error("Handler failure");
		};

		router.use(errorHandlingMiddleware);
		router.use(normalMiddleware);
		router.route("/test").get(faultyHandler);

		const request = new Request("http://example.com/test");
		const response = await router.match(request);

		expect(executionOrder).toEqual([
			"error-handler-start",
			"normal-middleware",
			"faulty-handler",
			"error-handler-catch",
		]);
		expect(response?.status).toBe(500);
		expect(await response?.text()).toBe("Caught: Handler failure");
		// Normal middleware doesn't process the error response because it rethrew during error handling
		expect(response?.headers.get("X-Normal")).toBeNull();
	});

	test("async operations in generators", async () => {
		const router = new Router();
		const executionOrder: string[] = [];

		async function* dbMiddleware(request: Request, context: any) {
			executionOrder.push("db-start");

			// Simulate async database call
			const userData = await new Promise((resolve) =>
				setTimeout(() => resolve({id: 123, name: "John"}), 10),
			);
			context.user = userData;

			const response = yield request;

			// Simulate async cleanup
			await new Promise((resolve) => setTimeout(resolve, 5));
			executionOrder.push("db-cleanup");

			return response;
		}

		async function* cacheMiddleware(request: Request, context: any) {
			executionOrder.push("cache-start");

			// Simulate cache lookup
			const cacheKey = `user-${context.user?.id}`;
			await new Promise((resolve) => setTimeout(resolve, 5));

			const response = yield request;

			// Simulate cache write
			await new Promise((resolve) => setTimeout(resolve, 5));
			response.headers.set("X-Cache-Key", cacheKey);

			return response;
		}

		const handler = async (request: Request, context: any) => {
			executionOrder.push("handler");
			return new Response(`User: ${context.user?.name}`);
		};

		router.use(dbMiddleware);
		router.use(cacheMiddleware);
		router.route("/test").get(handler);

		const request = new Request("http://example.com/test");
		const response = await router.match(request);

		expect(executionOrder).toEqual([
			"db-start",
			"cache-start",
			"handler",
			"db-cleanup",
		]);
		expect(response?.headers.get("X-Cache-Key")).toBe("user-123");
		expect(await response?.text()).toBe("User: John");
	});

	test("generator with no yield (passthrough)", async () => {
		const router = new Router();
		const executionOrder: string[] = [];

		async function* setupMiddleware(request: Request, context: any) {
			executionOrder.push("setup");
			context.setupComplete = true;
			yield; // Generator must have yield
			// No yield - passthrough
		}

		async function* processingMiddleware(request: Request, context: any) {
			executionOrder.push("processing-start");
			const response = yield request;
			executionOrder.push("processing-end");
			response.headers.set("X-Setup", context.setupComplete ? "true" : "false");
			return response;
		}

		const handler = async (_request: Request, _context: any) => {
			executionOrder.push("handler");
			return new Response("OK");
		};

		router.use(setupMiddleware);
		router.use(processingMiddleware);
		router.route("/test").get(handler);

		const request = new Request("http://example.com/test");
		const response = await router.match(request);

		expect(executionOrder).toEqual([
			"setup",
			"processing-start",
			"handler",
			"processing-end",
		]);
		expect(response?.headers.get("X-Setup")).toBe("true");
	});

	test("complex URL routing with middleware modifications", async () => {
		const router = new Router();

		async function* routingMiddleware(request: Request, _context: any) {
			// Rewrite legacy API paths
			if (request.url.includes("/api/v1/")) {
				request.url = request.url.replace("/api/v1/", "/api/v2/");
			}

			// Add trailing slash normalization
			if (!request.url.endsWith("/") && !request.url.includes("?")) {
				request.url = request.url + "/";
			}

			const response = yield request;
			response.headers.set("X-Rewritten", "true");
			return response;
		}

		router.use(routingMiddleware);
		router.route("/api/v2/users/").get(async () => new Response("V2 Users"));

		const request = new Request("http://example.com/api/v1/users");
		const response = await router.match(request);

		expect(response?.status).toBe(302); // Redirect due to URL change
		expect(response?.headers.get("Location")).toBe(
			"http://example.com/api/v2/users/",
		);
	});

	test("middleware execution with mixed async/sync functions", async () => {
		const router = new Router();
		const executionOrder: string[] = [];

		function syncMiddleware(request: Request, context: any) {
			executionOrder.push("sync");
			context.sync = true;
		}

		async function asyncFunctionMiddleware(request: Request, context: any) {
			executionOrder.push("async-function");
			await new Promise((resolve) => setTimeout(resolve, 1));
			context.asyncFunc = true;
		}

		async function* generatorMiddleware(request: Request, context: any) {
			executionOrder.push("generator-start");
			const response = yield request;
			executionOrder.push("generator-end");
			response.headers.set(
				"X-Mixed",
				`sync:${context.sync} async:${context.asyncFunc}`,
			);
			return response;
		}

		const handler = async (_request: Request, _context: any) => {
			executionOrder.push("handler");
			return new Response("Mixed execution");
		};

		router.use(syncMiddleware);
		router.use(asyncFunctionMiddleware);
		router.use(generatorMiddleware);
		router.route("/test").get(handler);

		const request = new Request("http://example.com/test");
		const response = await router.match(request);

		expect(executionOrder).toEqual([
			"sync",
			"async-function",
			"generator-start",
			"handler",
			"generator-end",
		]);
		expect(response?.headers.get("X-Mixed")).toBe("sync:true async:true");
	});
});

describe("Edge Cases and Error Scenarios", () => {
	test("empty middleware stack", async () => {
		const router = new Router();
		const handler = async () => new Response("No middleware");

		router.route("/test").get(handler);

		const request = new Request("http://example.com/test");
		const response = await router.match(request);

		expect(response?.status).toBe(200);
		expect(await response?.text()).toBe("No middleware");
	});

	test("generator throws error in initial execution", async () => {
		const router = new Router();

		async function* faultyMiddleware(_request: Request, _context: any) {
			yield; // Generator must have yield
			throw new Error("Middleware startup error");
		}

		router.use(faultyMiddleware);
		router.route("/test").get(async () => new Response("Success"));

		const request = new Request("http://example.com/test");

		await expect(router.match(request)).rejects.toThrow(
			"Middleware startup error",
		);
	});

	test("generator throws error after yield", async () => {
		const router = new Router();

		async function* faultyMiddleware(_request: Request, _context: any) {
			yield; // Generator must have yield
			throw new Error("Post-yield error");
		}

		router.use(faultyMiddleware);
		router.route("/test").get(async () => new Response("Success"));

		const request = new Request("http://example.com/test");

		await expect(router.match(request)).rejects.toThrow("Post-yield error");
	});

	test("function middleware throws error", async () => {
		const router = new Router();

		async function faultyMiddleware(_request: Request, _context: any) {
			throw new Error("Function middleware error");
		}

		router.use(faultyMiddleware);
		router.route("/test").get(async () => new Response("Success"));

		const request = new Request("http://example.com/test");

		await expect(router.match(request)).rejects.toThrow(
			"Function middleware error",
		);
	});

	test("very large middleware stack", async () => {
		const router = new Router();
		const executionOrder: string[] = [];

		// Add 50 middleware functions
		for (let i = 0; i < 50; i++) {
			const middleware = async function (request: Request, context: any) {
				executionOrder.push(`middleware-${i}`);
				context[`step${i}`] = true;
			};
			router.use(middleware);
		}

		const handler = async (_request: Request, _context: any) => {
			executionOrder.push("handler");
			return new Response("Large stack");
		};

		router.route("/test").get(handler);

		const request = new Request("http://example.com/test");
		const response = await router.match(request);

		expect(executionOrder.length).toBe(51); // 50 middleware + 1 handler
		expect(executionOrder[50]).toBe("handler");
		expect(response?.status).toBe(200);
	});

	test("recursive URL modification prevention", async () => {
		const router = new Router();
		let modificationCount = 0;

		async function* recursiveMiddleware(request: Request, _context: any) {
			modificationCount++;
			if (modificationCount > 5) {
				// Prevent infinite recursion
				const response = yield request;
				return response;
			}

			request.url = request.url + "?modified=" + modificationCount;
			const response = yield request;
			return response;
		}

		router.use(recursiveMiddleware);
		router.route("/test").get(async () => new Response("Success"));

		const request = new Request("http://example.com/test");
		const response = await router.match(request);

		// Should generate redirect due to URL modification
		expect(response?.status).toBe(302);
		expect(modificationCount).toBe(1); // Only modified once
	});

	test("malformed URLs in redirect handling", async () => {
		const router = new Router();

		async function* malformedURLMiddleware(request: Request, _context: any) {
			request.url = "not-a-valid-url";
			const response = yield request;
			return response;
		}

		router.use(malformedURLMiddleware);
		router.route("/test").get(async () => new Response("Success"));

		const request = new Request("http://example.com/test");

		// Should throw due to malformed URL
		await expect(router.match(request)).rejects.toThrow();
	});

	test("null and undefined return values", async () => {
		const router = new Router();

		async function* nullMiddleware(_request: Request, _context: any) {
			yield; // Generator must have yield
			return null; // Explicit null
		}

		async function* undefinedMiddleware(_request: Request, _context: any) {
			yield; // Generator must have yield
			return undefined; // Explicit undefined
		}

		async function* implicitMiddleware(_request: Request, _context: any) {
			yield; // Generator must have yield
			// Implicit undefined return
		}

		router.use(nullMiddleware);
		router.use(undefinedMiddleware);
		router.use(implicitMiddleware);
		router.route("/test").get(async () => new Response("Final"));

		const request = new Request("http://example.com/test");
		const response = await router.match(request);

		expect(response?.status).toBe(200);
		expect(await response?.text()).toBe("Final");
	});

	test("request body handling across middleware", async () => {
		const router = new Router();

		async function* bodyReadingMiddleware(request: Request, context: any) {
			if (request.method === "POST") {
				context.bodyText = await request.text();
			}
			const response = yield request;
			response.headers.set(
				"X-Body-Length",
				context.bodyText?.length.toString() || "0",
			);
			return response;
		}

		const handler = async (request: Request, context: any) => {
			return new Response(`Body: ${context.bodyText || "none"}`);
		};

		router.use(bodyReadingMiddleware);
		router.route("/test").post(handler);

		const request = new Request("http://example.com/test", {
			method: "POST",
			body: "test body content",
		});
		const response = await router.match(request);

		expect(response?.headers.get("X-Body-Length")).toBe("17");
		expect(await response?.text()).toBe("Body: test body content");
	});
});

describe("Path-Scoped Middleware", () => {
	test("middleware with pathPrefix only runs for matching paths", async () => {
		const router = new Router();
		const executionOrder: string[] = [];

		function adminMiddleware(_request: Request, context: any) {
			executionOrder.push("admin-middleware");
			context.isAdmin = true;
		}

		router.use("/admin", adminMiddleware);
		router.route("/admin/users").get(async (_req, ctx) => {
			return new Response(`isAdmin: ${ctx.isAdmin}`);
		});
		router.route("/public/page").get(async (_req, ctx) => {
			return new Response(`isAdmin: ${ctx.isAdmin}`);
		});

		// Request to /admin/users should trigger admin middleware
		const adminRequest = new Request("http://example.com/admin/users");
		const adminResponse = await router.handler(adminRequest);
		expect(executionOrder).toEqual(["admin-middleware"]);
		expect(await adminResponse.text()).toBe("isAdmin: true");

		// Request to /public/page should NOT trigger admin middleware
		executionOrder.length = 0;
		const publicRequest = new Request("http://example.com/public/page");
		const publicResponse = await router.handler(publicRequest);
		expect(executionOrder).toEqual([]);
		expect(await publicResponse.text()).toBe("isAdmin: undefined");
	});

	test("pathPrefix matches on segment boundaries", async () => {
		const router = new Router();
		const executionOrder: string[] = [];

		function adminMiddleware(_request: Request, _context: any) {
			executionOrder.push("admin");
		}

		router.use("/admin", adminMiddleware);
		router.route("/admin").get(async () => new Response("admin root"));
		router.route("/admin/users").get(async () => new Response("admin users"));
		router.route("/administrator").get(async () => new Response("administrator"));

		// /admin should match
		let request = new Request("http://example.com/admin");
		await router.handler(request);
		expect(executionOrder).toEqual(["admin"]);

		// /admin/users should match
		executionOrder.length = 0;
		request = new Request("http://example.com/admin/users");
		await router.handler(request);
		expect(executionOrder).toEqual(["admin"]);

		// /administrator should NOT match (not a segment boundary)
		executionOrder.length = 0;
		request = new Request("http://example.com/administrator");
		await router.handler(request);
		expect(executionOrder).toEqual([]);
	});

	test("global middleware runs alongside path-scoped middleware", async () => {
		const router = new Router();
		const executionOrder: string[] = [];

		function globalMiddleware(_request: Request, _context: any) {
			executionOrder.push("global");
		}

		function adminMiddleware(_request: Request, _context: any) {
			executionOrder.push("admin");
		}

		router.use(globalMiddleware);
		router.use("/admin", adminMiddleware);
		router.route("/admin/users").get(async () => new Response("OK"));

		const request = new Request("http://example.com/admin/users");
		await router.handler(request);

		expect(executionOrder).toEqual(["global", "admin"]);
	});

	test("generator middleware with pathPrefix works correctly", async () => {
		const router = new Router();
		const executionOrder: string[] = [];

		async function* apiMiddleware(request: Request, _context: any) {
			executionOrder.push("api-before");
			const response = yield request;
			executionOrder.push("api-after");
			response.headers.set("X-API", "true");
			return response;
		}

		router.use("/api", apiMiddleware);
		router.route("/api/users").get(async () => new Response("Users"));
		router.route("/home").get(async () => new Response("Home"));

		// API route should trigger middleware
		let request = new Request("http://example.com/api/users");
		let response = await router.handler(request);
		expect(executionOrder).toEqual(["api-before", "api-after"]);
		expect(response.headers.get("X-API")).toBe("true");

		// Non-API route should not trigger middleware
		executionOrder.length = 0;
		request = new Request("http://example.com/home");
		response = await router.handler(request);
		expect(executionOrder).toEqual([]);
		expect(response.headers.get("X-API")).toBeNull();
	});
});

describe("Subrouter Mount Middleware Scoping", () => {
	test("mounted subrouter middleware is scoped to mount path", async () => {
		const router = new Router();
		const executionOrder: string[] = [];

		// Create subrouter with middleware
		const apiRouter = new Router();
		apiRouter.use(function apiMiddleware(_request: Request, _context: any) {
			executionOrder.push("api-middleware");
		});
		apiRouter.route("/users").get(async () => new Response("Users"));

		// Mount at /api
		router.mount("/api", apiRouter);

		// Add a non-api route to main router
		router.route("/home").get(async () => new Response("Home"));

		// Request to /api/users should trigger subrouter middleware
		let request = new Request("http://example.com/api/users");
		await router.handler(request);
		expect(executionOrder).toEqual(["api-middleware"]);

		// Request to /home should NOT trigger subrouter middleware
		executionOrder.length = 0;
		request = new Request("http://example.com/home");
		await router.handler(request);
		expect(executionOrder).toEqual([]);
	});

	test("nested mount composes path prefixes correctly", async () => {
		const router = new Router();
		const executionOrder: string[] = [];

		// Inner subrouter
		const innerRouter = new Router();
		innerRouter.use(function innerMiddleware(_request: Request, _context: any) {
			executionOrder.push("inner");
		});
		innerRouter.route("/endpoint").get(async () => new Response("OK"));

		// Outer subrouter
		const outerRouter = new Router();
		outerRouter.use(function outerMiddleware(_request: Request, _context: any) {
			executionOrder.push("outer");
		});
		outerRouter.mount("/inner", innerRouter);

		// Main router
		router.mount("/outer", outerRouter);
		router.route("/other").get(async () => new Response("Other"));

		// Request to /outer/inner/endpoint should trigger both middlewares
		let request = new Request("http://example.com/outer/inner/endpoint");
		await router.handler(request);
		expect(executionOrder).toEqual(["outer", "inner"]);

		// Request to /other should trigger neither
		executionOrder.length = 0;
		request = new Request("http://example.com/other");
		await router.handler(request);
		expect(executionOrder).toEqual([]);
	});

	test("subrouter with path-scoped middleware composes prefixes", async () => {
		const router = new Router();
		const executionOrder: string[] = [];

		// Subrouter with path-scoped middleware
		const apiRouter = new Router();
		apiRouter.use("/admin", function adminMiddleware(_request: Request, _context: any) {
			executionOrder.push("admin");
		});
		apiRouter.route("/admin/users").get(async () => new Response("Admin users"));
		apiRouter.route("/public/page").get(async () => new Response("Public page"));

		// Mount at /api
		router.mount("/api", apiRouter);

		// Request to /api/admin/users should trigger admin middleware
		let request = new Request("http://example.com/api/admin/users");
		await router.handler(request);
		expect(executionOrder).toEqual(["admin"]);

		// Request to /api/public/page should NOT trigger admin middleware
		executionOrder.length = 0;
		request = new Request("http://example.com/api/public/page");
		await router.handler(request);
		expect(executionOrder).toEqual([]);
	});

	test("same subrouter can be mounted at multiple paths", async () => {
		const router = new Router();
		const executionOrder: string[] = [];

		// Shared subrouter
		const sharedRouter = new Router();
		sharedRouter.use(function sharedMiddleware(_request: Request, context: any) {
			executionOrder.push(`shared-${context.params.version || "no-version"}`);
		});
		sharedRouter.route("/users").get(async () => new Response("Users"));

		// Mount at multiple paths
		router.mount("/api/v1", sharedRouter);
		router.mount("/api/v2", sharedRouter);
		router.route("/other").get(async () => new Response("Other"));

		// Request to /api/v1/users
		let request = new Request("http://example.com/api/v1/users");
		await router.handler(request);
		expect(executionOrder).toContain("shared-no-version");

		// Request to /api/v2/users
		executionOrder.length = 0;
		request = new Request("http://example.com/api/v2/users");
		await router.handler(request);
		expect(executionOrder).toContain("shared-no-version");

		// Request to /other should NOT trigger shared middleware
		executionOrder.length = 0;
		request = new Request("http://example.com/other");
		await router.handler(request);
		expect(executionOrder).toEqual([]);
	});
});
