import {describe, test, expect, beforeAll, afterAll} from "bun:test";
import * as path from "path";
import * as fs from "fs/promises";
import {CloudflarePlatform} from "../src/index.js";

describe("CloudflarePlatform with miniflare", () => {
	const testDir = path.resolve(import.meta.dir, "miniflare-fixtures");
	let platform: CloudflarePlatform;

	beforeAll(async () => {
		// Create test worker and assets
		await fs.mkdir(testDir, {recursive: true});
		await fs.mkdir(path.join(testDir, "static", "assets"), {recursive: true});

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
			path.join(testDir, "static", "assets", "style.css"),
			"body { color: blue; }",
		);
		await fs.writeFile(
			path.join(testDir, "static", "index.html"),
			"<html><body>Hello</body></html>",
		);

		// Create platform with assets directory
		platform = new CloudflarePlatform({
			assetsDirectory: path.join(testDir, "static"),
		});
	});

	afterAll(async () => {
		try {
			await fs.rm(testDir, {recursive: true});
		} catch {
			// Ignore cleanup errors
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

		// Debug: log what we got
		const text = await response.clone().text();
		console.info("Response status:", response.status);
		console.info("Response body:", text);

		expect(response.status).toBe(200);

		const json = JSON.parse(text);
		expect(json.message).toBe("Hello from worker!");

		await instance.dispose();
	});
});
