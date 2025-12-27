import {describe, test, expect, beforeAll, afterAll} from "bun:test";
import * as path from "path";
import * as fs from "fs/promises";
import {CloudflarePlatform} from "../src/index.js";
import {getLogger} from "@logtape/logtape";

const logger = getLogger(["test", "platform-cloudflare-simple"]);

describe("CloudflarePlatform with miniflare (no assets)", () => {
	const testDir = path.resolve(import.meta.dir, "miniflare-simple-fixtures");
	let platform: CloudflarePlatform;

	beforeAll(async () => {
		await fs.mkdir(testDir, {recursive: true});

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

		// Create platform WITHOUT assets directory
		platform = new CloudflarePlatform({});
	});

	afterAll(async () => {
		// Platform is already disposed by individual tests, just cleanup files
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

		const text = await response.text();
		logger.debug`Response status: ${response.status}, body: ${text}`;

		expect(response.status).toBe(200);

		const json = JSON.parse(text);
		expect(json.message).toBe("Hello from worker!");

		await instance.dispose();
	});

	test("handles 404 from worker", async () => {
		const instance = await platform.loadServiceWorker(
			path.join(testDir, "worker.js"),
		);

		const response = await instance.handleRequest(
			new Request("http://localhost/unknown"),
		);

		expect(response.status).toBe(404);
		const text = await response.text();
		expect(text).toContain("Not found");

		await instance.dispose();
	});
});
