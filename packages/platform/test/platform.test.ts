import {test, expect, describe} from "bun:test";
import {detectDevelopmentPlatform} from "../src/index.js";

describe("@b9g/platform", () => {
	describe("Platform detection", () => {
		test("detectDevelopmentPlatform detects current runtime", () => {
			// Should detect the current development platform
			const platform = detectDevelopmentPlatform();
			expect(typeof platform).toBe("string");
			expect(platform).toMatch(/bun|node|deno/);
		});
	});
});
