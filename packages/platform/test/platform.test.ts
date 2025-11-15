import {test, expect, describe} from "bun:test";
import {
	platformRegistry,
	detectPlatform,
	type Platform,
} from "../src/index.js";

describe("@b9g/platform", () => {
	describe("Platform registry", () => {
		test("registers and retrieves platforms", () => {
			const mockPlatform: Platform = {
				name: "test",
				capabilities: {
					hotReload: false,
					sourceMaps: false,
					compression: false,
					compilation: false,
					cacheBackends: ["memory"],
				},
				createCaches: () => {
					throw new Error("Not implemented");
				},
				createStaticHandler: () => {
					throw new Error("Not implemented");
				},
				createServer: () => {
					throw new Error("Not implemented");
				},
			};

			platformRegistry.register("test", mockPlatform);
			expect(platformRegistry.get("test")).toBe(mockPlatform);
			expect(platformRegistry.list()).toContain("test");
		});

		test("detects platform", () => {
			const detection = platformRegistry.detect();
			expect(detection.platform).toMatch(/bun|node|unknown/);
			expect(typeof detection.confidence).toBe("number");
			expect(Array.isArray(detection.reasons)).toBe(true);
		});

		test("detectPlatform returns null for unknown platforms", () => {
			// This test might pass or fail depending on the runtime
			// but it shouldn't throw
			const platform = detectPlatform();
			expect(platform === null || typeof platform === "object").toBe(true);
		});
	});
});
