import {describe, test, expect} from "bun:test";
import {cors} from "../src/middleware.js";
import {Router} from "@b9g/router";

describe("cors middleware", () => {
	test("allows all origins with default config", async () => {
		const router = new Router();
		router.use(cors());
		router.route("/api").get(() => new Response("ok"));

		const request = new Request("http://localhost/api", {
			headers: {Origin: "https://example.com"},
		});

		const response = await router.handler(request);
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

		const response = await router.handler(request);
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
		const allowedRes = await router.handler(allowed);
		expect(allowedRes.headers.get("Access-Control-Allow-Origin")).toBe(
			"https://myapp.com",
		);

		// Disallowed origin - no CORS headers
		const disallowed = new Request("http://localhost/api", {
			headers: {Origin: "https://other.com"},
		});
		const disallowedRes = await router.handler(disallowed);
		expect(disallowedRes.headers.get("Access-Control-Allow-Origin")).toBeNull();
	});

	test("allows multiple origins", async () => {
		const router = new Router();
		router.use(
			cors({origin: ["https://app1.com", "https://app2.com"]}),
		);
		router.route("/api").get(() => new Response("ok"));

		const req1 = new Request("http://localhost/api", {
			headers: {Origin: "https://app1.com"},
		});
		const res1 = await router.handler(req1);
		expect(res1.headers.get("Access-Control-Allow-Origin")).toBe(
			"https://app1.com",
		);

		const req2 = new Request("http://localhost/api", {
			headers: {Origin: "https://app2.com"},
		});
		const res2 = await router.handler(req2);
		expect(res2.headers.get("Access-Control-Allow-Origin")).toBe(
			"https://app2.com",
		);
	});

	test("supports dynamic origin function", async () => {
		const router = new Router();
		router.use(
			cors({origin: (origin) => origin.endsWith(".example.com")}),
		);
		router.route("/api").get(() => new Response("ok"));

		const allowed = new Request("http://localhost/api", {
			headers: {Origin: "https://app.example.com"},
		});
		const allowedRes = await router.handler(allowed);
		expect(allowedRes.headers.get("Access-Control-Allow-Origin")).toBe(
			"https://app.example.com",
		);

		const disallowed = new Request("http://localhost/api", {
			headers: {Origin: "https://other.com"},
		});
		const disallowedRes = await router.handler(disallowed);
		expect(disallowedRes.headers.get("Access-Control-Allow-Origin")).toBeNull();
	});

	test("sets credentials header when enabled", async () => {
		const router = new Router();
		router.use(cors({origin: "https://myapp.com", credentials: true}));
		router.route("/api").get(() => new Response("ok"));

		const request = new Request("http://localhost/api", {
			headers: {Origin: "https://myapp.com"},
		});

		const response = await router.handler(request);
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
		const response = await router.handler(request);

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

		const response = await router.handler(request);
		expect(response.status).toBe(403);
	});

	test("sets exposed headers", async () => {
		const router = new Router();
		router.use(
			cors({exposedHeaders: ["X-Custom-Header", "X-Request-Id"]}),
		);
		router.route("/api").get(() => new Response("ok"));

		const request = new Request("http://localhost/api", {
			headers: {Origin: "https://example.com"},
		});

		const response = await router.handler(request);
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

		const response = await router.handler(request);
		expect(response.headers.get("Vary")).toBe("Origin");
	});
});
