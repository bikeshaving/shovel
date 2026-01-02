/**
 * Tests for config validation
 */

import {describe, it, expect, beforeEach} from "bun:test";
import {
	validateConfig,
	ConfigValidationError,
	env,
	setCurrentPlatform,
	getCurrentPlatform,
	type ConfigExpressionProvider,
} from "../src/config.js";

describe("validateConfig", () => {
	it("should pass for valid config with all values defined", () => {
		const config = {
			port: 3000,
			host: "localhost",
			workers: 1,
		};
		expect(() => validateConfig(config)).not.toThrow();
	});

	it("should throw ConfigValidationError for undefined value", () => {
		const config = {
			port: 3000,
			host: undefined,
		};
		expect(() => validateConfig(config)).toThrow(ConfigValidationError);
		try {
			validateConfig(config);
		} catch (e) {
			expect(e).toBeInstanceOf(ConfigValidationError);
			expect((e as ConfigValidationError).path).toBe("host");
			expect((e as ConfigValidationError).issue).toBe("undefined");
			expect((e as ConfigValidationError).message).toContain("host");
			expect((e as ConfigValidationError).message).toContain("undefined");
		}
	});

	it("should throw ConfigValidationError for NaN value", () => {
		const config = {
			port: NaN,
			host: "localhost",
		};
		expect(() => validateConfig(config)).toThrow(ConfigValidationError);
		try {
			validateConfig(config);
		} catch (e) {
			expect(e).toBeInstanceOf(ConfigValidationError);
			expect((e as ConfigValidationError).path).toBe("port");
			expect((e as ConfigValidationError).issue).toBe("NaN");
			expect((e as ConfigValidationError).message).toContain("NaN");
		}
	});

	it("should validate nested objects", () => {
		const config = {
			port: 3000,
			databases: {
				main: {
					url: "postgres://localhost",
				},
				cache: {
					url: undefined,
				},
			},
		};
		expect(() => validateConfig(config)).toThrow(ConfigValidationError);
		try {
			validateConfig(config);
		} catch (e) {
			expect(e).toBeInstanceOf(ConfigValidationError);
			expect((e as ConfigValidationError).path).toBe("databases.cache.url");
		}
	});

	it("should allow null values", () => {
		const config = {
			port: 3000,
			optional: null,
		};
		expect(() => validateConfig(config)).not.toThrow();
	});

	it("should allow arrays", () => {
		const config = {
			port: 3000,
			items: [1, 2, 3],
		};
		expect(() => validateConfig(config)).not.toThrow();
	});

	it("should allow empty objects", () => {
		const config = {
			port: 3000,
			caches: {},
		};
		expect(() => validateConfig(config)).not.toThrow();
	});

	it("should allow string values", () => {
		const config = {
			host: "localhost",
			path: "/data/uploads",
		};
		expect(() => validateConfig(config)).not.toThrow();
	});

	it("should allow boolean values", () => {
		const config = {
			enabled: true,
			debug: false,
		};
		expect(() => validateConfig(config)).not.toThrow();
	});

	it("should detect NaN in nested objects", () => {
		const config = {
			settings: {
				timeout: NaN,
			},
		};
		expect(() => validateConfig(config)).toThrow(ConfigValidationError);
		try {
			validateConfig(config);
		} catch (e) {
			expect((e as ConfigValidationError).path).toBe("settings.timeout");
			expect((e as ConfigValidationError).issue).toBe("NaN");
		}
	});
});

describe("Cloudflare initialization order", () => {
	// Save original process.env to restore after tests
	const originalProcessEnv = process.env;

	beforeEach(() => {
		// Reset platform before each test
		setCurrentPlatform(null as unknown as ConfigExpressionProvider);
	});

	it("should fail validation when platform is not set and env var is missing", () => {
		// This simulates the Cloudflare scenario:
		// 1. Config module is imported
		// 2. env("MY_VAR") is called but no platform is set
		// 3. Falls back to process.env which doesn't have MY_VAR
		// 4. validateConfig sees undefined and throws

		// Simulate config that uses env() before platform is set
		const config = {
			// env() without platform falls back to process.env
			apiKey: env("MY_SECRET_API_KEY"), // undefined - not in process.env
		};

		// This SHOULD fail because the env var is not set
		expect(() => validateConfig(config)).toThrow(ConfigValidationError);
	});

	it("should pass validation when platform provides env vars", () => {
		// This is the correct flow:
		// 1. Platform is set first
		// 2. Config module evaluates env() calls
		// 3. Platform provides the env vars
		// 4. validateConfig passes

		const mockPlatform: ConfigExpressionProvider = {
			env: (name: string) => {
				if (name === "MY_SECRET_API_KEY") return "secret123";
				return undefined;
			},
			outdir: () => ".",
			tmpdir: () => "/tmp",
			joinPath: (...segments) => segments.filter(Boolean).join("/"),
		};

		setCurrentPlatform(mockPlatform);

		const config = {
			apiKey: env("MY_SECRET_API_KEY"), // now returns "secret123"
		};

		expect(() => validateConfig(config)).not.toThrow();
	});

	it("FAILING: simulates Cloudflare import order issue", () => {
		// This test demonstrates the bug:
		// On Cloudflare, the config module is imported BEFORE initializeRuntime
		// sets up the platform. So env() calls fall back to process.env (undefined
		// on Workers), causing validateConfig to throw.
		//
		// The generated config module looks like:
		//   import { env, validateConfig } from "@b9g/platform/config";
		//   export const config = { apiKey: env("API_KEY") };
		//   validateConfig(config);  // <-- runs immediately on import!
		//
		// But the entry wrapper imports config BEFORE calling initializeRuntime:
		//   import { config } from "shovel:config";  // validateConfig runs here!
		//   import { initializeRuntime } from "@b9g/platform-cloudflare/runtime";
		//   initializeRuntime(config);  // platform is set here, too late!

		// Simulate: no platform set, process.env doesn't have the var
		const savedEnv = process.env.CLOUDFLARE_API_KEY;
		delete process.env.CLOUDFLARE_API_KEY;

		try {
			// Config is evaluated before platform is set
			const config = {
				apiKey: env("CLOUDFLARE_API_KEY"),
			};

			// This throws because apiKey is undefined
			// In a working system, this should NOT throw because
			// Cloudflare will provide the env var at runtime
			expect(() => validateConfig(config)).toThrow(ConfigValidationError);

			// TODO: The fix should make this test pass by deferring validation
			// until after the platform is set, or by having Cloudflare set
			// the platform before the config module is imported.
		} finally {
			if (savedEnv !== undefined) {
				process.env.CLOUDFLARE_API_KEY = savedEnv;
			}
		}
	});
});
