import {describe, test, expect, beforeEach, afterEach} from "bun:test";
import {cors, logger, trailingSlash} from "../src/middleware.js";
import {Router} from "@b9g/router";
import {configure, type LogRecord} from "@logtape/logtape";

// ============================================================================
// Logger middleware
// ============================================================================

describe("logger middleware", () => {
	let logs: LogRecord[];

	beforeEach(async () => {
		logs = [];
		await configure({
			reset: true,
			sinks: {
				test: (record: LogRecord) => logs.push(record),
			},
			loggers: [
				{category: ["app"], lowestLevel: "info", sinks: ["test"]},
				{
					category: ["logtape", "meta"],
					lowestLevel: "warning",
					sinks: [],
				},
			],
			// ["app"] captures ["app", "router"] via LogTape hierarchy
		});
	});

	afterEach(async () => {
		await configure({
			reset: true,
			sinks: {},
			loggers: [
				{category: ["logtape", "meta"], lowestLevel: "warning", sinks: []},
			],
		});
	});

	test("logs request and response", async () => {
		const router = new Router();
		router.use(logger());
		router.route("/").get(() => new Response("ok"));

		const request = new Request("http://localhost/");
		await router.handle(request);

		expect(logs.length).toBe(1);
		// Response log: [200, " ", "GET", " ", "/", " (", N, "ms)"]
		expect(logs[0].message).toContain(200);
		expect(logs[0].message).toContain("GET");
		expect(logs[0].message).toContain("/");
	});

	test("passes through response unchanged", async () => {
		const router = new Router();
		router.use(logger());
		router.route("/test").get(
			() =>
				new Response("hello", {
					status: 201,
					headers: {"X-Custom": "value"},
				}),
		);

		const request = new Request("http://localhost/test");
		const response = await router.handle(request);

		expect(response.status).toBe(201);
		expect(await response.text()).toBe("hello");
		expect(response.headers.get("X-Custom")).toBe("value");
	});

	test("logs correct pathname for nested routes", async () => {
		const router = new Router();
		router.use(logger());
		router.route("/api/users").get(() => Response.json({users: []}));

		const request = new Request("http://localhost/api/users");
		await router.handle(request);

		expect(logs.length).toBe(1);
		expect(logs[0].message).toContain("/api/users");
	});

	test("supports custom category", async () => {
		// Configure a custom category
		await configure({
			reset: true,
			sinks: {
				test: (record: LogRecord) => logs.push(record),
			},
			loggers: [
				{
					category: ["app", "http"],
					lowestLevel: "info",
					sinks: ["test"],
				},
				{
					category: ["logtape", "meta"],
					lowestLevel: "warning",
					sinks: [],
				},
			],
		});

		const router = new Router();
		router.use(logger({category: ["app", "http"]}));
		router.route("/").get(() => new Response("ok"));

		await router.handle(new Request("http://localhost/"));
		expect(logs.length).toBe(1);
		expect(logs[0].category).toEqual(["app", "http"]);
	});
});

// ============================================================================
// CORS middleware
// ============================================================================

describe("cors middleware", () => {
	test("allows all origins with default config", async () => {
		const router = new Router();
		router.use(cors());
		router.route("/api").get(() => new Response("ok"));

		const request = new Request("http://localhost/api", {
			headers: {Origin: "https://example.com"},
		});

		const response = await router.handle(request);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
	});

	test("handles preflight OPTIONS request", async () => {
		const router = new Router();
		router.use(cors());
		router.route("/api").get(() => new Response("ok"));

		const request = new Request("http://localhost/api", {
			method: "OPTIONS",
			headers: {Origin: "https://example.com"},
		});

		const response = await router.handle(request);
		expect(response.status).toBe(204);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
		expect(response.headers.get("Access-Control-Allow-Methods")).toContain(
			"GET",
		);
	});

	test("allows specific origin", async () => {
		const router = new Router();
		router.use(cors({origin: "https://myapp.com"}));
		router.route("/api").get(() => new Response("ok"));

		// Allowed origin
		const allowed = new Request("http://localhost/api", {
			headers: {Origin: "https://myapp.com"},
		});
		const allowedRes = await router.handle(allowed);
		expect(allowedRes.headers.get("Access-Control-Allow-Origin")).toBe(
			"https://myapp.com",
		);

		// Disallowed origin - no CORS headers
		const disallowed = new Request("http://localhost/api", {
			headers: {Origin: "https://other.com"},
		});
		const disallowedRes = await router.handle(disallowed);
		expect(disallowedRes.headers.get("Access-Control-Allow-Origin")).toBeNull();
	});

	test("allows multiple origins", async () => {
		const router = new Router();
		router.use(cors({origin: ["https://app1.com", "https://app2.com"]}));
		router.route("/api").get(() => new Response("ok"));

		const req1 = new Request("http://localhost/api", {
			headers: {Origin: "https://app1.com"},
		});
		const res1 = await router.handle(req1);
		expect(res1.headers.get("Access-Control-Allow-Origin")).toBe(
			"https://app1.com",
		);

		const req2 = new Request("http://localhost/api", {
			headers: {Origin: "https://app2.com"},
		});
		const res2 = await router.handle(req2);
		expect(res2.headers.get("Access-Control-Allow-Origin")).toBe(
			"https://app2.com",
		);
	});

	test("supports dynamic origin function", async () => {
		const router = new Router();
		router.use(cors({origin: (origin) => origin.endsWith(".example.com")}));
		router.route("/api").get(() => new Response("ok"));

		const allowed = new Request("http://localhost/api", {
			headers: {Origin: "https://app.example.com"},
		});
		const allowedRes = await router.handle(allowed);
		expect(allowedRes.headers.get("Access-Control-Allow-Origin")).toBe(
			"https://app.example.com",
		);

		const disallowed = new Request("http://localhost/api", {
			headers: {Origin: "https://other.com"},
		});
		const disallowedRes = await router.handle(disallowed);
		expect(disallowedRes.headers.get("Access-Control-Allow-Origin")).toBeNull();
	});

	test("sets credentials header when enabled", async () => {
		const router = new Router();
		router.use(cors({origin: "https://myapp.com", credentials: true}));
		router.route("/api").get(() => new Response("ok"));

		const request = new Request("http://localhost/api", {
			headers: {Origin: "https://myapp.com"},
		});

		const response = await router.handle(request);
		expect(response.headers.get("Access-Control-Allow-Credentials")).toBe(
			"true",
		);
	});

	test("throws when credentials used with wildcard origin", () => {
		expect(() => cors({origin: "*", credentials: true})).toThrow();
	});

	test("skips CORS for same-origin requests (no Origin header)", async () => {
		const router = new Router();
		router.use(cors());
		router.route("/api").get(() => new Response("ok"));

		const request = new Request("http://localhost/api");
		const response = await router.handle(request);

		// No CORS headers for same-origin
		expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
	});

	test("returns 403 for disallowed origin on preflight", async () => {
		const router = new Router();
		router.use(cors({origin: "https://allowed.com"}));
		router.route("/api").get(() => new Response("ok"));

		const request = new Request("http://localhost/api", {
			method: "OPTIONS",
			headers: {Origin: "https://disallowed.com"},
		});

		const response = await router.handle(request);
		expect(response.status).toBe(403);
	});

	test("sets exposed headers", async () => {
		const router = new Router();
		router.use(cors({exposedHeaders: ["X-Custom-Header", "X-Request-Id"]}));
		router.route("/api").get(() => new Response("ok"));

		const request = new Request("http://localhost/api", {
			headers: {Origin: "https://example.com"},
		});

		const response = await router.handle(request);
		expect(response.headers.get("Access-Control-Expose-Headers")).toBe(
			"X-Custom-Header, X-Request-Id",
		);
	});

	test("sets Vary header for caching", async () => {
		const router = new Router();
		router.use(cors());
		router.route("/api").get(() => new Response("ok"));

		const request = new Request("http://localhost/api", {
			headers: {Origin: "https://example.com"},
		});

		const response = await router.handle(request);
		expect(response.headers.get("Vary")).toBe("Origin");
	});
});

describe("trailingSlash middleware", () => {
	test("strip mode redirects /path/ to /path", async () => {
		const router = new Router();
		router.use(trailingSlash("strip"));
		router.route("/users").get(async () => new Response("Users"));

		const request = new Request("http://example.com/users/");
		const response = await router.handle(request);

		expect(response).not.toBeNull();
		expect(response?.status).toBe(301);
		expect(response?.headers.get("Location")).toBe("http://example.com/users");
	});

	test("add mode redirects /path to /path/", async () => {
		const router = new Router();
		router.use(trailingSlash("add"));
		router.route("/users/").get(async () => new Response("Users"));

		const request = new Request("http://example.com/users");
		const response = await router.handle(request);

		expect(response).not.toBeNull();
		expect(response?.status).toBe(301);
		expect(response?.headers.get("Location")).toBe("http://example.com/users/");
	});

	test("strip mode does not redirect paths without trailing slash", async () => {
		const router = new Router();
		router.use(trailingSlash("strip"));
		router.route("/users").get(async () => new Response("Users"));

		const request = new Request("http://example.com/users");
		const response = await router.handle(request);

		expect(response).not.toBeNull();
		expect(response?.status).toBe(200);
		expect(await response?.text()).toBe("Users");
	});

	test("add mode does not redirect paths with trailing slash", async () => {
		const router = new Router();
		router.use(trailingSlash("add"));
		router.route("/users/").get(async () => new Response("Users"));

		const request = new Request("http://example.com/users/");
		const response = await router.handle(request);

		expect(response).not.toBeNull();
		expect(response?.status).toBe(200);
		expect(await response?.text()).toBe("Users");
	});

	test("does not modify root path", async () => {
		const router = new Router();
		router.use(trailingSlash("strip"));
		router.route("/").get(async () => new Response("Home"));

		const request = new Request("http://example.com/");
		const response = await router.handle(request);

		expect(response).not.toBeNull();
		expect(response?.status).toBe(200);
		expect(await response?.text()).toBe("Home");
	});

	test("preserves query strings", async () => {
		const router = new Router();
		router.use(trailingSlash("strip"));
		router.route("/search").get(async () => new Response("Search"));

		const request = new Request("http://example.com/search/?q=test&page=1");
		const response = await router.handle(request);

		expect(response).not.toBeNull();
		expect(response?.status).toBe(301);
		expect(response?.headers.get("Location")).toBe(
			"http://example.com/search?q=test&page=1",
		);
	});

	test("works with path-scoped middleware", async () => {
		const router = new Router();
		router.use("/api", trailingSlash("strip"));
		router.route("/api/users").get(async () => new Response("API Users"));
		router.route("/web/users/").get(async () => new Response("Web Users"));

		// API path should redirect
		const apiRequest = new Request("http://example.com/api/users/");
		const apiResponse = await router.handle(apiRequest);
		expect(apiResponse?.status).toBe(301);
		expect(apiResponse?.headers.get("Location")).toBe(
			"http://example.com/api/users",
		);

		// Web path should not be affected by the middleware
		const webRequest = new Request("http://example.com/web/users/");
		const webResponse = await router.handle(webRequest);
		expect(webResponse?.status).toBe(200);
		expect(await webResponse?.text()).toBe("Web Users");
	});
});
