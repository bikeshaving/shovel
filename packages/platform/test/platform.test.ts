import {test, expect, describe} from "bun:test";
import {platformRegistry, detectDevelopmentPlatform, type Platform} from "../src/index.js";

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

		test("detectDevelopmentPlatform detects current runtime", () => {
			// Should detect the current development platform
			const platform = detectDevelopmentPlatform();
			expect(typeof platform).toBe("string");
			expect(platform).toMatch(/bun|node|deno/);
		});
	});
});
