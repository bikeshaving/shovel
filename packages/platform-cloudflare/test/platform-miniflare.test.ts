import {describe, test, expect, beforeAll, afterAll} from "bun:test";
import * as path from "path";
import * as fs from "fs/promises";
import {CloudflarePlatform} from "../src/index.js";
import type {ServiceWorkerInstance} from "@b9g/platform";

describe("CloudflarePlatform with miniflare", () => {
	const testDir = path.resolve(import.meta.dir, "miniflare-fixtures");
	let platform: CloudflarePlatform;
	let instance: ServiceWorkerInstance;

	beforeAll(async () => {
		await fs.mkdir(testDir, {recursive: true});
		await fs.mkdir(path.join(testDir, "public", "assets"), {recursive: true});

		// Single worker that handles all test routes
		await fs.writeFile(
			path.join(testDir, "worker.js"),
			`
self.addEventListener("fetch", (event) => {
	const url = new URL(event.request.url);

	if (url.pathname === "/api/hello") {
		event.respondWith(new Response(JSON.stringify({ message: "Hello from worker!" }), {
			headers: { "Content-Type": "application/json" }
		}));
	} else if (url.pathname === "/echo") {
		const status = parseInt(url.searchParams.get("status") || "200");
		const headerValue = url.searchParams.get("header") || "default";
		event.respondWith(new Response("body:" + headerValue, {
			status: status,
			headers: {
				"X-Echo": headerValue,
				"X-Status": String(status)
			}
		}));
	} else if (url.pathname === "/reflect") {
		event.respondWith(new Response(JSON.stringify({
			method: event.request.method,
			url: event.request.url,
			timestamp: Date.now()
		}), {
			status: 201,
			headers: {
				"Content-Type": "application/json",
				"X-Request-Method": event.request.method
			}
		}));
	} else {
		event.respondWith(new Response("Not found: " + url.pathname, { status: 404 }));
	}
});
`,
		);

		await fs.writeFile(
			path.join(testDir, "public", "assets", "style.css"),
			"body { color: blue; }",
		);
		await fs.writeFile(
			path.join(testDir, "public", "index.html"),
			"<html><body>Hello</body></html>",
		);

		platform = new CloudflarePlatform({
			assetsDirectory: path.join(testDir, "public"),
			port: 0,
		});

		instance = await platform.loadServiceWorker(
			path.join(testDir, "worker.js"),
		);
	});

	afterAll(async () => {
		await instance?.dispose();
		await platform.dispose();
		try {
			await fs.rm(testDir, {recursive: true});
		} catch (_err) {
			// ignore cleanup errors
		}
	});

	test("loadServiceWorker starts miniflare and handles requests", async () => {
		expect(instance.ready).toBe(true);

		const response = await instance.handleRequest(
			new Request("http://localhost/api/hello"),
		);

		expect(response.status).toBe(200);
		const text = await response.text();
		const json = JSON.parse(text);
		expect(json.message).toBe("Hello from worker!");
		expect(text).not.toContain("Worker handler");
	});

	test("handleRequest returns actual worker response, not stub", async () => {
		const response = await instance.handleRequest(
			new Request("http://localhost/nonexistent"),
		);

		expect(response.status).toBe(404);
		const text = await response.text();
		expect(text).toContain("Not found");
		expect(text).toContain("/nonexistent");
	});

	test("response reflects exact respondWith content", async () => {
		const response = await instance.handleRequest(
			new Request("http://localhost/reflect?query=value", {method: "POST"}),
		);

		expect(response.status).toBe(201);
		expect(response.headers.get("X-Request-Method")).toBe("POST");
		expect(response.headers.get("Content-Type")).toBe("application/json");

		const json = (await response.json()) as Record<string, any>;
		expect(json.method).toBe("POST");
		expect(json.url).toContain("/reflect");
		expect(json.url).toContain("query=value");
	});

	test("response headers and status match respondWith exactly", async () => {
		const testCases = [
			{status: 200, header: "ok-response"},
			{status: 201, header: "created"},
			{status: 400, header: "bad-request"},
			{status: 500, header: "server-error"},
		];

		for (const {status, header} of testCases) {
			const url = `http://localhost/echo?status=${status}&header=${header}`;
			const response = await instance.handleRequest(new Request(url));

			expect(response.status).toBe(status);
			expect(response.headers.get("X-Echo")).toBe(header);
			expect(response.headers.get("X-Status")).toBe(String(status));

			const text = await response.text();
			expect(text).toBe(`body:${header}`);
		}
	});
});
