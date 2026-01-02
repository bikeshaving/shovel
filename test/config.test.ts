/**
 * Tests for config precedence: json value > canonical env var > default
 */

/* eslint-disable no-restricted-properties -- Tests need direct process.env access */

import {describe, it, expect, beforeAll, afterAll} from "bun:test";
import {loadConfig, parseConfigExpr} from "../src/utils/config.js";
import {mkdtempSync, writeFileSync, rmSync} from "fs";
import {join} from "path";
import {tmpdir} from "os";

// Store original env values for the keys we'll modify
const savedEnv: Record<string, string | undefined> = {};
const envKeys = ["PORT", "HOST", "WORKERS", "PLATFORM", "MY_HOST"];

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
					JSON.stringify({port: "$PORT || 8080"}),
				);
				process.env.PORT = "9000";

				const config = loadConfig(testDir);

				// Expression evaluates $PORT env to 9000
				expect(config.port).toBe(9000);
			});
		});

		it("uses fallback when env var undefined with ||", () => {
			withTempDir((testDir) => {
				clearEnv();
				writeFileSync(
					join(testDir, "shovel.json"),
					JSON.stringify({port: "$PORT || 8080"}),
				);
				// PORT env not set - should use fallback

				const config = loadConfig(testDir);
				expect(config.port).toBe(8080);
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

	describe("nullish coalescing operator (??)", () => {
		it("uses ?? to fallback only on null/undefined", () => {
			withTempDir((testDir) => {
				clearEnv();
				writeFileSync(
					join(testDir, "shovel.json"),
					JSON.stringify({host: "$MY_HOST ?? default-host"}),
				);
				process.env.MY_HOST = "custom-host";

				const config = loadConfig(testDir);

				expect(config.host).toBe("custom-host");
			});
		});

		it("?? keeps empty string (unlike ||)", () => {
			withTempDir((testDir) => {
				clearEnv();
				writeFileSync(
					join(testDir, "shovel.json"),
					JSON.stringify({host: '$MY_HOST ?? "default-host"'}),
				);
				// Empty string is NOT nullish, so ?? should keep it
				process.env.MY_HOST = "";

				const config = loadConfig(testDir);

				expect(config.host).toBe("");
			});
		});

		it("|| falls back on empty string", () => {
			withTempDir((testDir) => {
				clearEnv();
				writeFileSync(
					join(testDir, "shovel.json"),
					JSON.stringify({host: '$MY_HOST || "default-host"'}),
				);
				// Empty string is falsy, so || should use fallback
				process.env.MY_HOST = "";

				const config = loadConfig(testDir);

				expect(config.host).toBe("default-host");
			});
		});

		it("?? falls back when env var undefined", () => {
			withTempDir((testDir) => {
				clearEnv();
				writeFileSync(
					join(testDir, "shovel.json"),
					JSON.stringify({host: "$MY_HOST ?? default-host"}),
				);
				// MY_HOST not set - should use fallback

				const config = loadConfig(testDir);

				expect(config.host).toBe("default-host");
			});
		});
	});
});

describe("parseConfigExpr", () => {
	describe("module path identifiers", () => {
		it("parses scoped npm package names", () => {
			const result = parseConfigExpr("@b9g/cache-redis", {}, {strict: false});
			expect(result).toBe("@b9g/cache-redis");
		});

		it("parses package names with slashes", () => {
			const result = parseConfigExpr("@b9g/cache/memory", {}, {strict: false});
			expect(result).toBe("@b9g/cache/memory");
		});

		it("parses package names with hyphens", () => {
			const result = parseConfigExpr("my-custom-cache", {}, {strict: false});
			expect(result).toBe("my-custom-cache");
		});

		it("parses deeply nested paths", () => {
			const result = parseConfigExpr("@org/pkg/sub/path", {}, {strict: false});
			expect(result).toBe("@org/pkg/sub/path");
		});
	});

	describe("ternary with module paths", () => {
		it("selects first branch when condition is true", () => {
			const result = parseConfigExpr(
				"$MODE === production ? @b9g/cache-redis : @b9g/cache/memory",
				{MODE: "production"},
				{strict: false},
			);
			expect(result).toBe("@b9g/cache-redis");
		});

		it("selects second branch when condition is false", () => {
			const result = parseConfigExpr(
				"$MODE === production ? @b9g/cache-redis : @b9g/cache/memory",
				{MODE: "development"},
				{strict: false},
			);
			expect(result).toBe("@b9g/cache/memory");
		});

		it("works with NODE_ENV", () => {
			const result = parseConfigExpr(
				"$NODE_ENV === production ? @b9g/filesystem-s3 : @b9g/filesystem/memory",
				{NODE_ENV: "production"},
				{strict: false},
			);
			expect(result).toBe("@b9g/filesystem-s3");
		});

		it("works with undefined env var (falsy condition)", () => {
			const result = parseConfigExpr(
				"$USE_REDIS ? @b9g/cache-redis : @b9g/cache/memory",
				{},
				{strict: false},
			);
			expect(result).toBe("@b9g/cache/memory");
		});

		it("works with truthy env var", () => {
			const result = parseConfigExpr(
				"$USE_REDIS ? @b9g/cache-redis : @b9g/cache/memory",
				{USE_REDIS: "1"},
				{strict: false},
			);
			expect(result).toBe("@b9g/cache-redis");
		});
	});

	describe("logical operators with module paths", () => {
		it("|| returns first truthy value", () => {
			const result = parseConfigExpr(
				"$CACHE_MODULE || @b9g/cache/memory",
				{},
				{strict: false},
			);
			expect(result).toBe("@b9g/cache/memory");
		});

		it("|| returns env var when set", () => {
			const result = parseConfigExpr(
				"$CACHE_MODULE || @b9g/cache/memory",
				{CACHE_MODULE: "@custom/cache"},
				{strict: false},
			);
			expect(result).toBe("@custom/cache");
		});

		it("?? returns first non-nullish value", () => {
			const result = parseConfigExpr(
				"$CACHE_MODULE ?? @b9g/cache/memory",
				{},
				{strict: false},
			);
			expect(result).toBe("@b9g/cache/memory");
		});
	});

	describe("complex expressions", () => {
		it("nested ternary", () => {
			const result = parseConfigExpr(
				"$ENV === prod ? @b9g/cache-redis : $ENV === staging ? @b9g/cache-redis : @b9g/cache/memory",
				{ENV: "staging"},
				{strict: false},
			);
			expect(result).toBe("@b9g/cache-redis");
		});

		it("ternary with fallback", () => {
			const result = parseConfigExpr(
				"($USE_REDIS ? @b9g/cache-redis : $CACHE_MODULE) || @b9g/cache/memory",
				{},
				{strict: false},
			);
			expect(result).toBe("@b9g/cache/memory");
		});

		it("equality with scoped package", () => {
			const result = parseConfigExpr(
				"$PROVIDER === @b9g/cache-redis",
				{PROVIDER: "@b9g/cache-redis"},
				{strict: false},
			);
			expect(result).toBe(true);
		});

		it("inequality with scoped package", () => {
			const result = parseConfigExpr(
				"$PROVIDER !== @b9g/cache/memory",
				{PROVIDER: "@b9g/cache-redis"},
				{strict: false},
			);
			expect(result).toBe(true);
		});
	});

	describe("export names", () => {
		it("parses PascalCase export names", () => {
			const result = parseConfigExpr("RedisCache", {}, {strict: false});
			expect(result).toBe("RedisCache");
		});

		it("parses camelCase export names", () => {
			const result = parseConfigExpr("memoryCache", {}, {strict: false});
			expect(result).toBe("memoryCache");
		});

		it("ternary with export names", () => {
			const result = parseConfigExpr(
				"$NODE_ENV === production ? RedisCache : MemoryCache",
				{NODE_ENV: "development"},
				{strict: false},
			);
			expect(result).toBe("MemoryCache");
		});
	});

	describe("colon in identifiers (word:word patterns)", () => {
		it("parses bun:sqlite as single identifier", () => {
			const result = parseConfigExpr("bun:sqlite", {}, {strict: false});
			expect(result).toBe("bun:sqlite");
		});

		it("parses node:fs as single identifier", () => {
			const result = parseConfigExpr("node:fs", {}, {strict: false});
			expect(result).toBe("node:fs");
		});

		it("parses node:path as single identifier", () => {
			const result = parseConfigExpr("node:path", {}, {strict: false});
			expect(result).toBe("node:path");
		});

		it("parses any word:word pattern as single identifier", () => {
			const result = parseConfigExpr("custom:driver", {}, {strict: false});
			expect(result).toBe("custom:driver");
		});

		it("parses multi-colon patterns", () => {
			const result = parseConfigExpr("a:b:c", {}, {strict: false});
			expect(result).toBe("a:b:c");
		});

		it("works in ternary expressions (spaces around :)", () => {
			const result = parseConfigExpr(
				"$PLATFORM === bun ? bun:sqlite : better-sqlite3",
				{PLATFORM: "bun"},
				{strict: false},
			);
			expect(result).toBe("bun:sqlite");
		});

		it("ternary alternate branch with module specifier", () => {
			const result = parseConfigExpr(
				"$PLATFORM === bun ? bun:sqlite : node:better-sqlite3",
				{PLATFORM: "node"},
				{strict: false},
			);
			expect(result).toBe("node:better-sqlite3");
		});

		it("works with fallback operators", () => {
			const result = parseConfigExpr(
				"$DB_DRIVER || bun:sqlite",
				{},
				{strict: false},
			);
			expect(result).toBe("bun:sqlite");
		});

		it("distinguishes ternary colon (with spaces) from identifier colon (no spaces)", () => {
			// "a ? b:c : d" - b:c is one identifier, outer : is ternary
			const result = parseConfigExpr(
				"$USE_CUSTOM ? custom:driver : default:driver",
				{USE_CUSTOM: "1"},
				{strict: false},
			);
			expect(result).toBe("custom:driver");
		});
	});

	describe("quoted strings", () => {
		it("parses double-quoted strings", () => {
			const result = parseConfigExpr('"hello world"', {}, {strict: false});
			expect(result).toBe("hello world");
		});

		it("parses single-quoted strings", () => {
			const result = parseConfigExpr("'hello world'", {}, {strict: false});
			expect(result).toBe("hello world");
		});

		it("allows colons in quoted strings", () => {
			const result = parseConfigExpr('"bun:sqlite"', {}, {strict: false});
			expect(result).toBe("bun:sqlite");
		});

		it("allows special chars in single-quoted strings", () => {
			const result = parseConfigExpr("'a ? b : c'", {}, {strict: false});
			expect(result).toBe("a ? b : c");
		});

		it("handles escape sequences in double quotes", () => {
			const result = parseConfigExpr('"line1\\nline2"', {}, {strict: false});
			expect(result).toBe("line1\nline2");
		});

		it("handles escape sequences in single quotes", () => {
			const result = parseConfigExpr("'tab\\there'", {}, {strict: false});
			expect(result).toBe("tab\there");
		});

		it("allows double quotes inside single quotes", () => {
			const result = parseConfigExpr("'say \"hello\"'", {}, {strict: false});
			expect(result).toBe('say "hello"');
		});

		it("allows single quotes inside double quotes", () => {
			const result = parseConfigExpr('"it\'s fine"', {}, {strict: false});
			expect(result).toBe("it's fine");
		});

		it("works with fallback operators", () => {
			const result = parseConfigExpr(
				"$MY_VAR || 'default value'",
				{},
				{strict: false},
			);
			expect(result).toBe("default value");
		});

		it("works in ternary expressions", () => {
			const result = parseConfigExpr(
				"$MODE === prod ? 'production' : 'development'",
				{MODE: "dev"},
				{strict: false},
			);
			expect(result).toBe("development");
		});
	});

	describe("edge cases", () => {
		it("handles @ at start of identifier", () => {
			const result = parseConfigExpr("@scope/pkg", {}, {strict: false});
			expect(result).toBe("@scope/pkg");
		});

		it("handles multiple slashes", () => {
			const result = parseConfigExpr(
				"@scope/pkg/sub/path/deep",
				{},
				{strict: false},
			);
			expect(result).toBe("@scope/pkg/sub/path/deep");
		});

		it("handles numbers in package names", () => {
			const result = parseConfigExpr("@b9g/cache2", {}, {strict: false});
			expect(result).toBe("@b9g/cache2");
		});

		it("handles underscores in package names", () => {
			const result = parseConfigExpr("@my_org/my_pkg", {}, {strict: false});
			expect(result).toBe("@my_org/my_pkg");
		});

		it("distinguishes env var from package ($VAR vs mixed)", () => {
			const result = parseConfigExpr(
				"$MY_VAR || @b9g/fallback",
				{MY_VAR: "@b9g/from-env"},
				{strict: false},
			);
			expect(result).toBe("@b9g/from-env");
		});
	});

	describe("P1: path suffix should not mask missing env vars", () => {
		it("throws in strict mode when env var with path suffix is missing", () => {
			// $DATADIR/uploads with DATADIR unset should throw, not resolve to "uploads"
			expect(() => {
				parseConfigExpr("$DATADIR/uploads", {}, {strict: true});
			}).toThrow();
		});

		it("returns undefined (not partial path) in non-strict mode when env var missing", () => {
			// In non-strict mode, missing env var should make the whole expression undefined
			// not silently drop the variable and return just the suffix
			const result = parseConfigExpr("$DATADIR/uploads", {}, {strict: false});
			expect(result).toBeUndefined();
		});

		it("works correctly when env var with path suffix is set", () => {
			const result = parseConfigExpr(
				"$DATADIR/uploads",
				{DATADIR: "/var/data"},
				{strict: true},
			);
			expect(result).toBe("/var/data/uploads");
		});
	});
});

describe("P1: tmpdir expressions should resolve synchronously", () => {
	it("__tmpdir__ resolves to actual path, not Promise", async () => {
		// This tests the runtime behavior - tmpdir() should be usable synchronously
		// Config expressions are now methods on platform instances
		const {default: NodePlatform} = await import(
			"../packages/platform-node/src/index.js"
		);
		const platform = new NodePlatform();
		const result = platform.tmpdir();

		// Should not be a Promise - should be the actual path
		expect(typeof result).toBe("string");
		expect(result).not.toBe("[object Promise]");
		expect(result.length).toBeGreaterThan(0);
	});

	it("joinPath with tmpdir should produce valid path, not Promise string", async () => {
		// Config expressions are now methods on platform instances
		const {default: NodePlatform} = await import(
			"../packages/platform-node/src/index.js"
		);
		const platform = new NodePlatform();
		const result = platform.joinPath(platform.tmpdir(), "myapp", "cache");

		// Should be a valid path, not "[object Promise]/myapp/cache"
		expect(result).not.toContain("[object Promise]");
		expect(result).toMatch(/myapp/);
		expect(result).toMatch(/cache/);
	});
});
