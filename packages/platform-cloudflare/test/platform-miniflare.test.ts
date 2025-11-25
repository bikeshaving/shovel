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
		console.log("Response status:", response.status);
		console.log("Response body:", text);

		expect(response.status).toBe(200);

		const json = JSON.parse(text);
		expect(json.message).toBe("Hello from worker!");

		await instance.dispose();
	});

	test("getFileSystemRoot returns CFAssetsDirectoryHandle for 'assets'", async () => {
		// First load a worker to initialize miniflare and ASSETS binding
		const instance = await platform.loadServiceWorker(
			path.join(testDir, "worker.js"),
		);

		const assetsHandle = await platform.getFileSystemRoot("assets");
		expect(assetsHandle.kind).toBe("directory");

		// Navigate to assets subdirectory (static/assets in our fixture)
		const assetsDir = await assetsHandle.getDirectoryHandle("assets");
		expect(assetsDir.name).toBe("assets");

		// Get a file
		const cssHandle = await assetsDir.getFileHandle("style.css");
		const cssFile = await cssHandle.getFile();
		const content = await cssFile.text();

		expect(content).toBe("body { color: blue; }");

		await instance.dispose();
	});

	test("getFileSystemRoot returns MemoryBucket for 'tmp'", async () => {
		const bucket = await platform.getFileSystemRoot("tmp");
		expect(bucket.kind).toBe("directory");
		expect(bucket.name).toBe("tmp");

		// MemoryBucket is writable
		const fileHandle = await bucket.getFileHandle("test.txt", {create: true});
		expect(fileHandle.kind).toBe("file");
	});

	test("getFileSystemRoot throws for unknown buckets", async () => {
		await expect(platform.getFileSystemRoot("my-bucket")).rejects.toThrow(
			/Unknown bucket.*my-bucket/,
		);
	});
});
