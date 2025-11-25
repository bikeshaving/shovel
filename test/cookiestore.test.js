/**
 * Tests for self.cookieStore across different platforms
 */

import {test, expect, beforeEach, afterEach} from "bun:test";
import {mkdir, writeFile, rm} from "fs/promises";
import {join} from "path";
import {tmpdir} from "os";

let testDir;

beforeEach(async () => {
	testDir = join(
		tmpdir(),
		`shovel-cookiestore-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	await mkdir(testDir, {recursive: true});
});

afterEach(async () => {
	if (testDir) {
		await rm(testDir, {recursive: true, force: true});
	}
});

test("self.cookieStore is available in ServiceWorker handler (Node)", async () => {
	const entryPath = join(testDir, "server.js");
	await writeFile(
		entryPath,
		`
self.addEventListener("fetch", (event) => {
  const cookieStore = self.cookieStore;
  event.respondWith(
    new Response(JSON.stringify({
      hasCookieStore: !!cookieStore,
      cookieStoreType: typeof cookieStore
    }), {
      headers: { "Content-Type": "application/json" }
    })
  );
});
`,
	);

	// Use platform-node to run the ServiceWorker
	const {default: NodePlatform} = await import("@b9g/platform-node");

	const platform = new NodePlatform();
	const instance = await platform.loadServiceWorker(entryPath);

	const request = new Request("http://localhost:3000/test");
	const response = await instance.handleRequest(request);
	const result = await response.json();

	expect(result.hasCookieStore).toBe(true);
	expect(result.cookieStoreType).toBe("object");

	await instance.dispose();
	await platform.dispose();
});

test("self.cookieStore is isolated per-request (Node)", async () => {
	const entryPath = join(testDir, "server.js");
	await writeFile(
		entryPath,
		`
self.addEventListener("fetch", (event) => {
  event.respondWith((async () => {
    const cookieStore = self.cookieStore;
    const url = new URL(event.request.url);
    const requestId = url.searchParams.get("id");

    // Get the cookie from the request
    const cookie = await cookieStore.get("test");

    return new Response(JSON.stringify({
      requestId: requestId,
      cookieValue: cookie?.value || null
    }), {
      headers: { "Content-Type": "application/json" }
    });
  })());
});
`,
	);

	const {default: NodePlatform} = await import("@b9g/platform-node");

	const platform = new NodePlatform();
	const instance = await platform.loadServiceWorker(entryPath);

	// Make two concurrent requests with different cookie values in the request headers
	const [response1, response2] = await Promise.all([
		instance.handleRequest(
			new Request("http://localhost:3000/test?id=1", {
				headers: {Cookie: "test=value-1"},
			}),
		),
		instance.handleRequest(
			new Request("http://localhost:3000/test?id=2", {
				headers: {Cookie: "test=value-2"},
			}),
		),
	]);

	const result1 = await response1.json();
	const result2 = await response2.json();

	// Verify each request gets its own cookie value
	expect(result1.requestId).toBe("1");
	expect(result1.cookieValue).toBe("value-1");

	expect(result2.requestId).toBe("2");
	expect(result2.cookieValue).toBe("value-2");

	await instance.dispose();
	await platform.dispose();
});

test("self.cookieStore reads cookies from request (Node)", async () => {
	const entryPath = join(testDir, "server.js");
	await writeFile(
		entryPath,
		`
self.addEventListener("fetch", (event) => {
  event.respondWith((async () => {
    const cookieStore = self.cookieStore;
    const testCookie = await cookieStore.get("test");

    return new Response(JSON.stringify({
      cookieValue: testCookie?.value || null
    }), {
      headers: { "Content-Type": "application/json" }
    });
  })());
});
`,
	);

	const {default: NodePlatform} = await import("@b9g/platform-node");

	const platform = new NodePlatform();
	const instance = await platform.loadServiceWorker(entryPath);

	const request = new Request("http://localhost:3000/test", {
		headers: {
			Cookie: "test=request-cookie-value",
		},
	});

	const response = await instance.handleRequest(request);
	const result = await response.json();

	expect(result.cookieValue).toBe("request-cookie-value");

	await instance.dispose();
	await platform.dispose();
});

test("self.cookieStore is available in ServiceWorker handler (Bun)", async () => {
	const entryPath = join(testDir, "server.js");
	await writeFile(
		entryPath,
		`
self.addEventListener("fetch", (event) => {
  const cookieStore = self.cookieStore;
  event.respondWith(
    new Response(JSON.stringify({
      hasCookieStore: !!cookieStore,
      cookieStoreType: typeof cookieStore
    }), {
      headers: { "Content-Type": "application/json" }
    })
  );
});
`,
	);

	// Use platform-bun to run the ServiceWorker
	const {default: BunPlatform} = await import("@b9g/platform-bun");

	const platform = new BunPlatform();
	const instance = await platform.loadServiceWorker(entryPath);

	const request = new Request("http://localhost:3000/test");
	const response = await instance.handleRequest(request);
	const result = await response.json();

	expect(result.hasCookieStore).toBe(true);
	expect(result.cookieStoreType).toBe("object");

	await instance.dispose();
	await platform.dispose();
});

test("self.cookieStore reads cookies from request (Bun)", async () => {
	const entryPath = join(testDir, "server.js");
	await writeFile(
		entryPath,
		`
self.addEventListener("fetch", (event) => {
  event.respondWith((async () => {
    const cookieStore = self.cookieStore;
    const testCookie = await cookieStore.get("test");

    return new Response(JSON.stringify({
      cookieValue: testCookie?.value || null
    }), {
      headers: { "Content-Type": "application/json" }
    });
  })());
});
`,
	);

	const {default: BunPlatform} = await import("@b9g/platform-bun");

	const platform = new BunPlatform();
	const instance = await platform.loadServiceWorker(entryPath);

	const request = new Request("http://localhost:3000/test", {
		headers: {
			Cookie: "test=bun-cookie-value",
		},
	});

	const response = await instance.handleRequest(request);
	const result = await response.json();

	expect(result.cookieValue).toBe("bun-cookie-value");

	await instance.dispose();
	await platform.dispose();
});
