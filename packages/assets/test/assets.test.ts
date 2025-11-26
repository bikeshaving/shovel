import {test, expect, describe, beforeEach} from "bun:test";
import {assets} from "../src/middleware.js";
import {Router} from "@b9g/router";

describe("Assets Middleware", () => {
	// Mock self.buckets
	const mockBuckets = {
		async open(name: string) {
			if (name === "static") {
				return {
					async getFileHandle(path: string) {
						if (path === "manifest.json") {
							return {
								async getFile() {
									return {
										async text() {
											return JSON.stringify({
												assets: {
													"/app.js": {
														url: "/app.js",
														type: "application/javascript",
														size: 1234,
														hash: "abc123",
													},
													"/styles.css": {
														url: "/styles.css",
														type: "text/css",
														size: 567,
														hash: "def456",
													},
												},
											});
										},
									};
								},
							};
						}
						if (path === "assets/app.js") {
							return {
								async getFile() {
									return {
										stream: () => new ReadableStream(),
										size: 1234,
										lastModified: Date.now(),
									};
								},
							};
						}
						if (path === "assets/styles.css") {
							return {
								async getFile() {
									return {
										stream: () => new ReadableStream(),
										size: 567,
										lastModified: Date.now(),
									};
								},
							};
						}
						throw new Error("NotFoundError");
					},
				};
			}
			throw new Error("Bucket not found");
		},
	};

	beforeEach(() => {
		(globalThis as any).self = {
			buckets: mockBuckets,
		};
	});

	test("should serve asset from manifest", async () => {
		const router = new Router();
		router.use(assets());
		router.route("/*").get(() => new Response("Not Found", {status: 404}));

		const request = new Request("http://example.com/app.js");
		const response = await router.handler(request);

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("application/javascript");
		expect(response.headers.get("Content-Length")).toBe("1234");
		expect(response.headers.get("ETag")).toBe('"abc123"');
	});

	test("should pass through to next middleware for non-existent asset", async () => {
		const router = new Router();
		router.use(assets());
		router.route("/*").get(() => new Response("Not Found", {status: 404}));

		const request = new Request("http://example.com/nonexistent.js");
		const response = await router.handler(request);

		// Should pass through to 404 handler
		expect(response.status).toBe(404);
	});

	test("should block directory traversal with double slash", async () => {
		const router = new Router();
		router.use(assets());
		router.route("/*").get(() => new Response("Not Found", {status: 404}));

		const request = new Request("http://example.com//etc/passwd");
		const response = await router.handler(request);

		expect(response.status).toBe(403);
		expect(await response.text()).toBe("Forbidden");
	});

	test("should handle conditional requests with 304", async () => {
		const router = new Router();
		router.use(assets());
		router.route("/*").get(() => new Response("Not Found", {status: 404}));

		const futureDate = new Date(Date.now() + 100000).toUTCString();
		const request = new Request("http://example.com/app.js", {
			headers: {"if-modified-since": futureDate},
		});
		const response = await router.handler(request);

		expect(response.status).toBe(304);
	});

	test("should use custom MIME types when manifest type not present", async () => {
		// Override the manifest to not include type for testing custom MIME types
		(globalThis as any).self = {
			buckets: {
				async open(name: string) {
					if (name === "static") {
						return {
							async getFileHandle(path: string) {
								if (path === "manifest.json") {
									return {
										async getFile() {
											return {
												async text() {
													return JSON.stringify({
														assets: {
															"/app.js": {
																url: "/app.js",
																// No type specified - should use custom MIME type
																size: 1234,
																hash: "abc123",
															},
														},
													});
												},
											};
										},
									};
								}
								if (path === "assets/app.js") {
									return {
										async getFile() {
											return {
												stream: () => new ReadableStream(),
												size: 1234,
												lastModified: Date.now(),
											};
										},
									};
								}
								throw new Error("NotFoundError");
							},
						};
					}
					throw new Error("Bucket not found");
				},
			},
		};

		const router = new Router();
		router.use(
			assets({
				mimeTypes: {".js": "text/plain"},
			}),
		);
		router.route("/*").get(() => new Response("Not Found", {status: 404}));

		const request = new Request("http://example.com/app.js");
		const response = await router.handler(request);

		expect(response.headers.get("Content-Type")).toBe("text/plain");
	});

	test("should set custom cache headers", async () => {
		const router = new Router();
		router.use(
			assets({
				cacheControl: "no-cache",
			}),
		);
		router.route("/*").get(() => new Response("Not Found", {status: 404}));

		const request = new Request("http://example.com/app.js");
		const response = await router.handler(request);

		expect(response.headers.get("Cache-Control")).toBe("no-cache");
	});
});
