/**
 * Tests for config validation
 */

import {describe, it, expect} from "bun:test";
import {validateConfig, ConfigValidationError} from "../src/config.js";

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
