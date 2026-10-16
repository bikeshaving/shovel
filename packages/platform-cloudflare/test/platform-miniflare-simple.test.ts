import * as Fs from "fs/promises";
import * as Path from "path";

import {getLogger} from "@logtape/logtape";
import {afterAll, beforeAll, describe, expect, test} from "bun:test";

import {CloudflarePlatform} from "../src/index.js";

const logger = getLogger(["test", "platform-cloudflare-simple"]);

describe("CloudflarePlatform with miniflare (no assets)", () => {
	const testDir = Path.resolve(import.meta.dir, "miniflare-simple-fixtures");
	let platform: CloudflarePlatform;

	beforeAll(async () => {
		await Fs.mkdir(testDir, {recursive: true});

		// Write a simple ServiceWorker
		await Fs.writeFile(
			Path.join(testDir, "worker.js"),
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
		platform = new CloudflarePlatform({port: 0});
	});

	afterAll(async () => {
		// Dispose platform to clean up any remaining miniflare instances
		await platform.dispose();
		try {
			await Fs.rm(testDir, {recursive: true});
		} catch (err) {
			logger.debug`Cleanup of ${testDir} failed: ${err}`;
		}
	});

	test("loadServiceWorker starts miniflare and handles requests", async () => {
		const instance = await platform.loadServiceWorker(
			Path.join(testDir, "worker.js"),
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
			Path.join(testDir, "worker.js"),
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
