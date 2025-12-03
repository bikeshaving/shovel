/**
 * Tests for self.cookieStore across different platforms
 * Copies fixtures to temp directories for test isolation.
 */

import {test, expect} from "bun:test";
import {join} from "path";
import {copyFixtureToTemp} from "./utils.js";

test("self.cookieStore is available in ServiceWorker handler (Node)", async () => {
	const fixture = await copyFixtureToTemp("cookiestore-app");

	try {
		const entryPath = join(fixture.src, "cookiestore-basic.js");

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
	} finally {
		await fixture.cleanup();
	}
});

test("self.cookieStore is isolated per-request (Node)", async () => {
	const fixture = await copyFixtureToTemp("cookiestore-app");

	try {
		const entryPath = join(fixture.src, "cookiestore-isolated.js");

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
	} finally {
		await fixture.cleanup();
	}
});

test("self.cookieStore reads cookies from request (Node)", async () => {
	const fixture = await copyFixtureToTemp("cookiestore-app");

	try {
		const entryPath = join(fixture.src, "cookiestore-read.js");

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
	} finally {
		await fixture.cleanup();
	}
});

test("self.cookieStore is available in ServiceWorker handler (Bun)", async () => {
	const fixture = await copyFixtureToTemp("cookiestore-app");

	try {
		const entryPath = join(fixture.src, "cookiestore-basic-bun.js");

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
	} finally {
		await fixture.cleanup();
	}
});

test("self.cookieStore reads cookies from request (Bun)", async () => {
	const fixture = await copyFixtureToTemp("cookiestore-app");

	try {
		const entryPath = join(fixture.src, "cookiestore-read-bun.js");

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
	} finally {
		await fixture.cleanup();
	}
});
