/**
 * Tests for config precedence: json value > canonical env var > default
 */

/* eslint-disable no-restricted-properties -- Tests need direct process.env access */

import {describe, it, expect, beforeAll, afterAll} from "bun:test";
import {loadConfig} from "../src/utils/config.js";
import {mkdtempSync, writeFileSync, rmSync} from "fs";
import {join} from "path";
import {tmpdir} from "os";

// Store original env values for the keys we'll modify
const savedEnv: Record<string, string | undefined> = {};
const envKeys = ["PORT", "HOST", "WORKERS", "PLATFORM"];

function saveEnv() {
	for (const key of envKeys) {
		savedEnv[key] = process.env[key];
	}
}

function restoreEnv() {
	for (const key of envKeys) {
		if (savedEnv[key] === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = savedEnv[key];
		}
	}
}

function clearEnv() {
	for (const key of envKeys) {
		delete process.env[key];
	}
}

function withTempDir(fn: (dir: string) => void) {
	const dir = mkdtempSync(join(tmpdir(), "shovel-config-test-"));
	try {
		fn(dir);
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
}

describe("loadConfig precedence", () => {
	beforeAll(() => {
		saveEnv();
	});

	afterAll(() => {
		restoreEnv();
	});

	describe("when shovel.json exists", () => {
		it("uses json value over env var", () => {
			withTempDir((testDir) => {
				clearEnv();
				writeFileSync(
					join(testDir, "shovel.json"),
					JSON.stringify({port: 8080}),
				);
				process.env.PORT = "9000";

				const config = loadConfig(testDir);

				expect(config.port).toBe(8080);
			});
		});

		it("uses json value with expression", () => {
			withTempDir((testDir) => {
				clearEnv();
				writeFileSync(
					join(testDir, "shovel.json"),
					JSON.stringify({port: "PORT || 8080"}),
				);
				process.env.PORT = "9000";

				const config = loadConfig(testDir);

				// Expression evaluates PORT env to 9000
				expect(config.port).toBe(9000);
			});
		});

		// Note: In strict mode (default), the expression parser throws if env var
		// is undefined, even with || fallback. This is a known limitation.
		// Users should either:
		// 1. Set the env var
		// 2. Use non-expression form in json and rely on canonical env fallback
		// 3. Skip the key entirely to use canonical env fallback
		it("throws in strict mode when env var in expression is undefined", () => {
			withTempDir((testDir) => {
				clearEnv();
				writeFileSync(
					join(testDir, "shovel.json"),
					JSON.stringify({port: "PORT || 8080"}),
				);
				// PORT env not set - should throw in strict mode

				expect(() => loadConfig(testDir)).toThrow(
					"Undefined environment variable: PORT",
				);
			});
		});

		it("respects all json values", () => {
			withTempDir((testDir) => {
				clearEnv();
				writeFileSync(
					join(testDir, "shovel.json"),
					JSON.stringify({
						port: 4000,
						host: "0.0.0.0",
						workers: 4,
						platform: "bun",
					}),
				);
				// Set env vars that should be ignored
				process.env.PORT = "9000";
				process.env.HOST = "127.0.0.1";
				process.env.WORKERS = "8";
				process.env.PLATFORM = "node";

				const config = loadConfig(testDir);

				expect(config.port).toBe(4000);
				expect(config.host).toBe("0.0.0.0");
				expect(config.workers).toBe(4);
				expect(config.platform).toBe("bun");
			});
		});
	});

	describe("when key missing from json", () => {
		it("falls back to canonical env var", () => {
			withTempDir((testDir) => {
				clearEnv();
				writeFileSync(join(testDir, "shovel.json"), JSON.stringify({}));
				process.env.PORT = "9000";
				process.env.HOST = "0.0.0.0";
				process.env.WORKERS = "4";

				const config = loadConfig(testDir);

				expect(config.port).toBe(9000);
				expect(config.host).toBe("0.0.0.0");
				expect(config.workers).toBe(4);
			});
		});

		it("falls back to default when env not set", () => {
			withTempDir((testDir) => {
				clearEnv();
				writeFileSync(join(testDir, "shovel.json"), JSON.stringify({}));
				// No env vars set

				const config = loadConfig(testDir);

				expect(config.port).toBe(3000); // default
				expect(config.host).toBe("localhost"); // default
				expect(config.workers).toBe(1); // default
			});
		});

		it("partial json with env fallback for missing", () => {
			withTempDir((testDir) => {
				clearEnv();
				writeFileSync(
					join(testDir, "shovel.json"),
					JSON.stringify({port: 5000}),
				);
				process.env.WORKERS = "2";
				// HOST env not set

				const config = loadConfig(testDir);

				expect(config.port).toBe(5000); // from json
				expect(config.workers).toBe(2); // from env
				expect(config.host).toBe("localhost"); // default
			});
		});
	});

	describe("when no config file exists", () => {
		it("uses env vars", () => {
			withTempDir((testDir) => {
				clearEnv();
				process.env.PORT = "4000";
				process.env.WORKERS = "2";

				const config = loadConfig(testDir);

				expect(config.port).toBe(4000);
				expect(config.workers).toBe(2);
			});
		});

		it("uses defaults when no env", () => {
			withTempDir((testDir) => {
				clearEnv();

				const config = loadConfig(testDir);

				expect(config.port).toBe(3000);
				expect(config.host).toBe("localhost");
				expect(config.workers).toBe(1);
			});
		});
	});

	describe("package.json shovel field", () => {
		it("uses package.json shovel field when no shovel.json", () => {
			withTempDir((testDir) => {
				clearEnv();
				writeFileSync(
					join(testDir, "package.json"),
					JSON.stringify({
						name: "test-app",
						shovel: {
							port: 7000,
							workers: 3,
						},
					}),
				);

				const config = loadConfig(testDir);

				expect(config.port).toBe(7000);
				expect(config.workers).toBe(3);
			});
		});

		it("shovel.json takes precedence over package.json", () => {
			withTempDir((testDir) => {
				clearEnv();
				writeFileSync(
					join(testDir, "shovel.json"),
					JSON.stringify({port: 8000}),
				);
				writeFileSync(
					join(testDir, "package.json"),
					JSON.stringify({
						name: "test-app",
						shovel: {port: 7000},
					}),
				);

				const config = loadConfig(testDir);

				expect(config.port).toBe(8000);
			});
		});
	});
});
