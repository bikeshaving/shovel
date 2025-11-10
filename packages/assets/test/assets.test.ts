import {test, expect, describe, beforeEach} from "bun:test";
import {assets} from "../src/middleware.js";

describe("Assets Middleware", () => {
	// Mock self.buckets
	const mockBuckets = {
		async open(name: string) {
			if (name === "assets") {
				return {
					async getFileHandle(path: string) {
						if (path === "manifest.json") {
							return {
								async getFile() {
									return {
										async text() {
											return JSON.stringify({
												assets: {
													"app.js": {
														url: "/app.js",
														type: "application/javascript",
														size: 1234,
														hash: "abc123",
													},
													"styles.css": {
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
		const middleware = assets();
		const request = new Request("http://example.com/app.js");

		const generator = middleware(request, {});
		const result = await generator.next();
		const response = result.value as Response;

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("application/javascript");
		expect(response.headers.get("Content-Length")).toBe("1234");
		expect(response.headers.get("ETag")).toBe('"abc123"');
	});

	test("should pass through to next middleware for non-existent asset", async () => {
		const middleware = assets();
		const request = new Request("http://example.com/nonexistent.js");

		const generator = middleware(request, {});
		const result = await generator.next();

		// Should yield the request for next middleware
		expect(result.value).toBe(request);
		expect(result.done).toBe(false);

		// Simulate next middleware returning 404
		const notFoundResponse = new Response("Not Found", {status: 404});
		const finalResult = await generator.next(notFoundResponse);
		const response = finalResult.value as Response;

		expect(response.status).toBe(404);
	});

	test("should block directory traversal with double slash", async () => {
		const middleware = assets();
		const request = new Request("http://example.com//etc/passwd");

		const generator = middleware(request, {});
		const result = await generator.next();
		const response = result.value as Response;

		expect(response.status).toBe(403);
		expect(await response.text()).toBe("Forbidden");
	});

	test("should handle conditional requests with 304", async () => {
		const middleware = assets();
		const futureDate = new Date(Date.now() + 100000).toUTCString();
		const request = new Request("http://example.com/app.js", {
			headers: {"if-modified-since": futureDate},
		});

		const generator = middleware(request, {});
		const result = await generator.next();
		const response = result.value as Response;

		expect(response.status).toBe(304);
	});

	test("should use custom MIME types when manifest type not present", async () => {
		// Override the manifest to not include type for testing custom MIME types
		(globalThis as any).self = {
			buckets: {
				async open(name: string) {
					if (name === "assets") {
						return {
							async getFileHandle(path: string) {
								if (path === "manifest.json") {
									return {
										async getFile() {
											return {
												async text() {
													return JSON.stringify({
														assets: {
															"app.js": {
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

		const middleware = assets({
			mimeTypes: {".js": "text/plain"},
		});
		const request = new Request("http://example.com/app.js");

		const generator = middleware(request, {});
		const result = await generator.next();
		const response = result.value as Response;

		expect(response.headers.get("Content-Type")).toBe("text/plain");
	});

	test("should set dev cache headers", async () => {
		const middleware = assets({dev: true});
		const request = new Request("http://example.com/app.js");

		const generator = middleware(request, {});
		const result = await generator.next();
		const response = result.value as Response;

		expect(response.headers.get("Cache-Control")).toBe("no-cache");
	});
});
