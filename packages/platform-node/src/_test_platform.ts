/**
 * Test for Node platform functionality
 */

import {describe, test, expect} from "bun:test";
import {createNodePlatform} from "./platform.js";

describe("NodePlatform", () => {
	test("creates platform with correct capabilities", () => {
		const platform = createNodePlatform();

		expect(platform.name).toBe("node");
		expect(platform.capabilities.hotReload).toBe(true);
		expect(platform.capabilities.sourceMaps).toBe(true);
		expect(platform.capabilities.filesystem).toBe(true);
		expect(platform.capabilities.serverSideRendering).toBe(true);
		expect(platform.capabilities.staticGeneration).toBe(true);
	});

	test("creates caches with filesystem default", () => {
		const platform = createNodePlatform();
		const caches = platform.createCaches();

		expect(caches.getDefault()).toBe("filesystem");
		expect(caches.has("memory")).toBe(true);
		expect(caches.has("filesystem")).toBe(true);
	});

	test("creates static handler", () => {
		const platform = createNodePlatform();
		const handler = platform.createStaticHandler();

		expect(typeof handler).toBe("function");
	});

	test("disposes cleanly", async () => {
		const platform = createNodePlatform();
		await expect(platform.dispose()).resolves.toBeUndefined();
	});
});
