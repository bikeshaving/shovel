import {test, expect, describe} from "bun:test";
import {
	platformRegistry,
	detectDevelopmentPlatform,
	type Platform,
} from "../src/index.js";

describe("@b9g/platform", () => {
	describe("Platform registry", () => {
		test("registers and retrieves platforms", () => {
			const mockServiceWorkerContainer = {
				controller: null,
				ready: Promise.resolve({} as ServiceWorkerRegistration),
				oncontrollerchange: null,
				onmessage: null,
				onmessageerror: null,
				register: async () => ({}) as ServiceWorkerRegistration,
				getRegistration: async () => undefined,
				getRegistrations: async () => [],
				startMessages: () => {},
				addEventListener: () => {},
				removeEventListener: () => {},
				dispatchEvent: () => true,
				pool: undefined,
				terminate: async () => {},
				reloadWorkers: async () => {},
			};
			const mockPlatform: Platform = {
				name: "test",
				serviceWorker: mockServiceWorkerContainer,
				listen: async () => {
					throw new Error("Not implemented");
				},
				close: async () => {},
				createCaches: async () => {
					throw new Error("Not implemented");
				},
				createDirectories: async () => {
					throw new Error("Not implemented");
				},
				createLoggers: async () => {
					throw new Error("Not implemented");
				},
				createServer: () => {
					throw new Error("Not implemented");
				},
				getProductionEntryPoints: () => ({server: "// server code"}),
				getESBuildConfig: () => ({}),
				getDefaults: () => ({}),
				dispose: async () => {},
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
