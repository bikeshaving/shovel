import {test, expect, describe, beforeEach, afterEach} from "bun:test";
import {mkdirSync, writeFileSync, rmSync, existsSync} from "fs";
import {join} from "path";
import {createStaticFilesMiddleware} from "./handler.js";

const testDir = join(process.cwd(), "test-static");
const manifestPath = join(testDir, "manifest.json");

describe("createStaticFilesMiddleware", () => {
	beforeEach(() => {
		// Create test directory and files
		if (!existsSync(testDir)) {
			mkdirSync(testDir, {recursive: true});
		}

		// Create test files (both source and hashed output files)
		writeFileSync(join(testDir, "style.css"), "body { color: red; }");
		writeFileSync(join(testDir, "script.js"), 'console.log("hello");');
		writeFileSync(join(testDir, "image.png"), "fake-png-data");

		// Create hashed output files
		writeFileSync(join(testDir, "style-123.css"), "body { color: red; }");
		writeFileSync(join(testDir, "script-456.js"), 'console.log("hello");');
		writeFileSync(join(testDir, "image-789.png"), "fake-png-data");

		// Create test manifest
		const manifest = {
			assets: {
				"style.css": {
					source: "style.css",
					output: "style-123.css",
					url: "/static/style-123.css",
					hash: "123",
					size: 17,
					type: "text/css",
				},
				"script.js": {
					source: "script.js",
					output: "script-456.js",
					url: "/static/script-456.js",
					hash: "456",
					size: 20,
					type: "application/javascript",
				},
				"image.png": {
					source: "image.png",
					output: "image-789.png",
					url: "/static/image-789.png",
					hash: "789",
					size: 13,
					type: "image/png",
				},
			},
			generated: new Date().toISOString(),
			config: {
				publicPath: "/static/",
				outputDir: testDir,
			},
		};
		writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
	});

	afterEach(() => {
		// Clean up test directory
		if (existsSync(testDir)) {
			rmSync(testDir, {recursive: true, force: true});
		}
	});

	test("serves files from manifest in production mode", async () => {
		const middleware = createStaticFilesMiddleware({
			dev: false,
			outputDir: testDir,
			manifest: manifestPath,
		});

		const request = new Request("http://example.com/static/style-123.css");
		const context = {};
		const next = async () => new Response("Not found", {status: 404});

		const response = await middleware(request, context, next);

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("text/css");
		expect(await response.text()).toBe("body { color: red; }");
	});

	test("serves files with correct MIME types", async () => {
		const middleware = createStaticFilesMiddleware({
			dev: false,
			outputDir: testDir,
			manifest: manifestPath,
		});

		const testCases = [
			{url: "/static/style-123.css", expectedType: "text/css"},
			{url: "/static/script-456.js", expectedType: "application/javascript"},
			{url: "/static/image-789.png", expectedType: "image/png"},
		];

		for (const testCase of testCases) {
			const request = new Request(`http://example.com${testCase.url}`);
			const response = await middleware(
				request,
				{},
				async () => new Response("Not found", {status: 404}),
			);

			expect(response.status).toBe(200);
			expect(response.headers.get("Content-Type")).toBe(testCase.expectedType);
		}
	});

	test("calls next() for non-matching URLs", async () => {
		const middleware = createStaticFilesMiddleware({
			dev: false,
			outputDir: testDir,
			manifest: manifestPath,
		});

		let nextCalled = false;
		const next = async () => {
			nextCalled = true;
			return new Response("Next middleware", {status: 200});
		};

		const request = new Request("http://example.com/api/users");
		const response = await middleware(request, {}, next);

		expect(nextCalled).toBe(true);
		expect(await response.text()).toBe("Next middleware");
	});

	test("returns 404 for non-existent static files", async () => {
		const middleware = createStaticFilesMiddleware({
			dev: false,
			outputDir: testDir,
			manifest: manifestPath,
		});

		const request = new Request("http://example.com/static/nonexistent.css");
		const next = async () => new Response("Not found", {status: 404});

		const response = await middleware(request, {}, next);

		expect(response.status).toBe(404);
	});

	test("handles missing manifest gracefully", async () => {
		const middleware = createStaticFilesMiddleware({
			dev: false,
			outputDir: testDir,
			manifest: "/nonexistent/manifest.json",
		});

		let nextCalled = false;
		const next = async () => {
			nextCalled = true;
			return new Response("Next middleware");
		};

		const request = new Request("http://example.com/static/style.css");
		await middleware(request, {}, next);

		expect(nextCalled).toBe(true);
	});

	test("serves files directly in development mode", async () => {
		const middleware = createStaticFilesMiddleware({
			dev: true,
			outputDir: testDir,
			manifest: manifestPath,
			staticPrefix: "/static/",
			sourceDir: testDir,
		});

		const request = new Request("http://example.com/static/style.css");
		const next = async () => new Response("Not found", {status: 404});

		const response = await middleware(request, {}, next);

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("text/css");
		expect(await response.text()).toBe("body { color: red; }");
	});

	test("handles URL encoding in file paths", async () => {
		// Create a file with special characters
		writeFileSync(join(testDir, "file with spaces.txt"), "content");

		const manifest = {
			"file with spaces.txt": "/static/file%20with%20spaces.txt",
		};
		writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

		const middleware = createStaticFilesMiddleware({
			dev: false,
			outputDir: testDir,
			manifest: manifestPath,
		});

		const request = new Request(
			"http://example.com/static/file%20with%20spaces.txt",
		);
		const response = await middleware(
			request,
			{},
			async () => new Response("Not found", {status: 404}),
		);

		expect(response.status).toBe(200);
		expect(await response.text()).toBe("content");
	});

	test("sets appropriate cache headers for static files", async () => {
		const middleware = createStaticFilesMiddleware({
			dev: false,
			outputDir: testDir,
			manifest: manifestPath,
		});

		const request = new Request("http://example.com/static/style-123.css");
		const response = await middleware(
			request,
			{},
			async () => new Response("Not found", {status: 404}),
		);

		expect(response.status).toBe(200);

		// Should have cache headers for production builds
		const cacheControl = response.headers.get("Cache-Control");
		expect(cacheControl).toBeDefined();
		expect(cacheControl).toContain("max-age=");
	});

	test("handles concurrent requests to same file", async () => {
		const middleware = createStaticFilesMiddleware({
			dev: false,
			outputDir: testDir,
			manifest: manifestPath,
		});

		const requests = Array.from(
			{length: 10},
			() => new Request("http://example.com/static/style-123.css"),
		);

		const responses = await Promise.all(
			requests.map((request) =>
				middleware(
					request,
					{},
					async () => new Response("Not found", {status: 404}),
				),
			),
		);

		// All responses should be successful
		for (const response of responses) {
			expect(response.status).toBe(200);
			expect(await response.text()).toBe("body { color: red; }");
		}
	});

	test("respects custom static prefix", async () => {
		const middleware = createStaticFilesMiddleware({
			dev: false,
			outputDir: testDir,
			manifest: manifestPath,
			staticPrefix: "/assets/",
		});

		// Update manifest to use custom prefix
		const manifest = {
			"style.css": "/assets/style-123.css",
		};
		writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

		const request = new Request("http://example.com/assets/style-123.css");
		const response = await middleware(
			request,
			{},
			async () => new Response("Not found", {status: 404}),
		);

		expect(response.status).toBe(200);
		expect(await response.text()).toBe("body { color: red; }");
	});
});
