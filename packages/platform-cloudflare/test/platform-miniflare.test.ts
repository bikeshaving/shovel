import {describe, test, expect, beforeAll, afterAll} from "bun:test";
import * as path from "path";
import * as fs from "fs/promises";
import {CloudflarePlatform} from "../src/index.js";
import {getLogger} from "@logtape/logtape";

const logger = getLogger(["test", "platform-cloudflare"]);

describe("CloudflarePlatform with miniflare", () => {
	const testDir = path.resolve(import.meta.dir, "miniflare-fixtures");
	let platform: CloudflarePlatform;

	beforeAll(async () => {
		// Create test worker and assets
		await fs.mkdir(testDir, {recursive: true});
		await fs.mkdir(path.join(testDir, "public", "assets"), {recursive: true});

		// Write a simple ServiceWorker
		await fs.writeFile(
			path.join(testDir, "worker.js"),
			`
self.addEventListener("fetch", (event) => {
	const url = new URL(event.request.url);

	if (url.pathname === "/api/hello") {
		event.respondWith(new Response(JSON.stringify({ message: "Hello from worker!" }), {
			headers: { "Content-Type": "application/json" }
		}));
	} else {
		event.respondWith(new Response("Not found: " + url.pathname, { status: 404 }));
	}
});
`,
		);

		// Write some static assets
		await fs.writeFile(
			path.join(testDir, "public", "assets", "style.css"),
			"body { color: blue; }",
		);
		await fs.writeFile(
			path.join(testDir, "public", "index.html"),
			"<html><body>Hello</body></html>",
		);

		// Create platform with assets directory
		platform = new CloudflarePlatform({
			assetsDirectory: path.join(testDir, "public"),
		});
	});

	afterAll(async () => {
		try {
			await fs.rm(testDir, {recursive: true});
		} catch (err) {
			logger.debug`Cleanup of ${testDir} failed: ${err}`;
		}
	});

	test("loadServiceWorker starts miniflare and handles requests", async () => {
		const instance = await platform.loadServiceWorker(
			path.join(testDir, "worker.js"),
		);

		expect(instance.ready).toBe(true);

		// Test API route
		const response = await instance.handleRequest(
			new Request("http://localhost/api/hello"),
		);

		expect(response.status).toBe(200);

		const text = await response.text();
		const json = JSON.parse(text);
		expect(json.message).toBe("Hello from worker!");

		// Ensure response comes from actual worker, not hardcoded stub
		expect(text).not.toContain("Worker handler");

		await instance.dispose();
	});

	test("handleRequest returns actual worker response, not stub", async () => {
		const instance = await platform.loadServiceWorker(
			path.join(testDir, "worker.js"),
		);

		// Request a non-existent route to verify 404 comes from worker
		const response = await instance.handleRequest(
			new Request("http://localhost/nonexistent"),
		);

		expect(response.status).toBe(404);
		const text = await response.text();
		// Worker returns "Not found: /nonexistent", not a generic stub
		expect(text).toContain("Not found");
		expect(text).toContain("/nonexistent");

		await instance.dispose();
	});

	test("response reflects exact respondWith content", async () => {
		// Create a worker that sets specific headers and body to verify
		// the response is exactly what respondWith receives
		const uniqueWorkerPath = path.join(testDir, "unique-worker.js");
		const uniqueId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;

		await fs.writeFile(
			uniqueWorkerPath,
			`
self.addEventListener("fetch", (event) => {
	event.respondWith(new Response(JSON.stringify({
		uniqueId: "${uniqueId}",
		method: event.request.method,
		url: event.request.url,
		timestamp: Date.now()
	}), {
		status: 201,
		statusText: "Created",
		headers: {
			"Content-Type": "application/json",
			"X-Custom-Header": "${uniqueId}",
			"X-Request-Method": event.request.method
		}
	}));
});
`,
		);

		const instance = await platform.loadServiceWorker(uniqueWorkerPath);

		const response = await instance.handleRequest(
			new Request("http://localhost/test-path?query=value", {method: "POST"}),
		);

		// Verify status
		expect(response.status).toBe(201);

		// Verify custom headers set by worker
		expect(response.headers.get("X-Custom-Header")).toBe(uniqueId);
		expect(response.headers.get("X-Request-Method")).toBe("POST");
		expect(response.headers.get("Content-Type")).toBe("application/json");

		// Verify body contains unique ID and request details
		const json = await response.json();
		expect(json.uniqueId).toBe(uniqueId);
		expect(json.method).toBe("POST");
		expect(json.url).toContain("/test-path");
		expect(json.url).toContain("query=value");

		await instance.dispose();
		await fs.unlink(uniqueWorkerPath);
	});

	test("response headers and status match respondWith exactly", async () => {
		const headerTestWorkerPath = path.join(testDir, "header-test-worker.js");

		await fs.writeFile(
			headerTestWorkerPath,
			`
self.addEventListener("fetch", (event) => {
	const url = new URL(event.request.url);
	const status = parseInt(url.searchParams.get("status") || "200");
	const headerValue = url.searchParams.get("header") || "default";

	event.respondWith(new Response("body:" + headerValue, {
		status: status,
		headers: {
			"X-Echo": headerValue,
			"X-Status": String(status)
		}
	}));
});
`,
		);

		const instance = await platform.loadServiceWorker(headerTestWorkerPath);

		// Test various status codes and headers
		const testCases = [
			{status: 200, header: "ok-response"},
			{status: 201, header: "created"},
			{status: 400, header: "bad-request"},
			{status: 500, header: "server-error"},
		];

		for (const {status, header} of testCases) {
			const response = await instance.handleRequest(
				new Request(`http://localhost/test?status=${status}&header=${header}`),
			);

			expect(response.status).toBe(status);
			expect(response.headers.get("X-Echo")).toBe(header);
			expect(response.headers.get("X-Status")).toBe(String(status));

			const text = await response.text();
			expect(text).toBe(`body:${header}`);
		}

		await instance.dispose();
		await fs.unlink(headerTestWorkerPath);
	});
});
