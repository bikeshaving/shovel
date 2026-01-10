/**
 * Tests for config precedence: json value > canonical env var > default
 */

/* eslint-disable no-restricted-properties -- Tests need direct process.env access */

import {describe, it, expect, beforeAll, afterAll} from "bun:test";
import {loadConfig, Parser} from "../src/utils/config.js";
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

describe("Parser.parse", () => {
	describe("module path identifiers", () => {
		it("parses scoped npm package names", () => {
			const result = Parser.parse("@b9g/cache-redis", {strict: false});
			expect(result).toBe("@b9g/cache-redis");
		});

		it("parses package names with slashes", () => {
			const result = Parser.parse("@b9g/cache/memory", {strict: false});
			expect(result).toBe("@b9g/cache/memory");
		});

		it("parses package names with hyphens", () => {
			const result = Parser.parse("my-custom-cache", {strict: false});
			expect(result).toBe("my-custom-cache");
		});

		it("parses deeply nested paths", () => {
			const result = Parser.parse("@org/pkg/sub/path", {strict: false});
			expect(result).toBe("@org/pkg/sub/path");
		});
	});

	describe("ternary with module paths", () => {
		it("selects first branch when condition is true", () => {
			const result = Parser.parse(
				"$MODE === production ? @b9g/cache-redis : @b9g/cache/memory",
				{env: {MODE: "production"}, strict: false},
			);
			expect(result).toBe("@b9g/cache-redis");
		});

		it("selects second branch when condition is false", () => {
			const result = Parser.parse(
				"$MODE === production ? @b9g/cache-redis : @b9g/cache/memory",
				{env: {MODE: "development"}, strict: false},
			);
			expect(result).toBe("@b9g/cache/memory");
		});

		it("works with NODE_ENV", () => {
			const result = Parser.parse(
				"$NODE_ENV === production ? @b9g/filesystem-s3 : @b9g/filesystem/memory",
				{env: {NODE_ENV: "production"}, strict: false},
			);
			expect(result).toBe("@b9g/filesystem-s3");
		});

		it("works with undefined env var (falsy condition)", () => {
			const result = Parser.parse(
				"$USE_REDIS ? @b9g/cache-redis : @b9g/cache/memory",
				{env: {}, strict: false},
			);
			expect(result).toBe("@b9g/cache/memory");
		});

		it("works with truthy env var", () => {
			const result = Parser.parse(
				"$USE_REDIS ? @b9g/cache-redis : @b9g/cache/memory",
				{env: {USE_REDIS: "1"}, strict: false},
			);
			expect(result).toBe("@b9g/cache-redis");
		});
	});

	describe("logical operators with module paths", () => {
		it("|| returns first truthy value", () => {
			const result = Parser.parse("$CACHE_MODULE || @b9g/cache/memory", {
				env: {},
				strict: false,
			});
			expect(result).toBe("@b9g/cache/memory");
		});

		it("|| returns env var when set", () => {
			const result = Parser.parse("$CACHE_MODULE || @b9g/cache/memory", {
				env: {CACHE_MODULE: "@custom/cache"},
				strict: false,
			});
			expect(result).toBe("@custom/cache");
		});

		it("?? returns first non-nullish value", () => {
			const result = Parser.parse("$CACHE_MODULE ?? @b9g/cache/memory", {
				env: {},
				strict: false,
			});
			expect(result).toBe("@b9g/cache/memory");
		});
	});

	describe("complex expressions", () => {
		it("nested ternary", () => {
			const result = Parser.parse(
				"$ENV === prod ? @b9g/cache-redis : $ENV === staging ? @b9g/cache-redis : @b9g/cache/memory",
				{env: {ENV: "staging"}, strict: false},
			);
			expect(result).toBe("@b9g/cache-redis");
		});

		it("ternary with fallback", () => {
			const result = Parser.parse(
				"($USE_REDIS ? @b9g/cache-redis : $CACHE_MODULE) || @b9g/cache/memory",
				{env: {}, strict: false},
			);
			expect(result).toBe("@b9g/cache/memory");
		});

		it("equality with scoped package", () => {
			const result = Parser.parse("$PROVIDER === @b9g/cache-redis", {
				env: {PROVIDER: "@b9g/cache-redis"},
				strict: false,
			});
			expect(result).toBe(true);
		});

		it("inequality with scoped package", () => {
			const result = Parser.parse("$PROVIDER !== @b9g/cache/memory", {
				env: {PROVIDER: "@b9g/cache-redis"},
				strict: false,
			});
			expect(result).toBe(true);
		});
	});

	describe("export names", () => {
		it("parses PascalCase export names", () => {
			const result = Parser.parse("RedisCache", {strict: false});
			expect(result).toBe("RedisCache");
		});

		it("parses camelCase export names", () => {
			const result = Parser.parse("memoryCache", {strict: false});
			expect(result).toBe("memoryCache");
		});

		it("ternary with export names", () => {
			const result = Parser.parse(
				"$NODE_ENV === production ? RedisCache : MemoryCache",
				{env: {NODE_ENV: "development"}, strict: false},
			);
			expect(result).toBe("MemoryCache");
		});
	});

	describe("colon in identifiers (word:word patterns)", () => {
		it("parses bun:sqlite as single identifier", () => {
			const result = Parser.parse("bun:sqlite", {strict: false});
			expect(result).toBe("bun:sqlite");
		});

		it("parses node:fs as single identifier", () => {
			const result = Parser.parse("node:fs", {strict: false});
			expect(result).toBe("node:fs");
		});

		it("parses node:path as single identifier", () => {
			const result = Parser.parse("node:path", {strict: false});
			expect(result).toBe("node:path");
		});

		it("parses any word:word pattern as single identifier", () => {
			const result = Parser.parse("custom:driver", {strict: false});
			expect(result).toBe("custom:driver");
		});

		it("parses multi-colon patterns", () => {
			const result = Parser.parse("a:b:c", {strict: false});
			expect(result).toBe("a:b:c");
		});

		it("works in ternary expressions (spaces around :)", () => {
			const result = Parser.parse(
				"$PLATFORM === bun ? bun:sqlite : better-sqlite3",
				{env: {PLATFORM: "bun"}, strict: false},
			);
			expect(result).toBe("bun:sqlite");
		});

		it("ternary alternate branch with module specifier", () => {
			const result = Parser.parse(
				"$PLATFORM === bun ? bun:sqlite : node:better-sqlite3",
				{env: {PLATFORM: "node"}, strict: false},
			);
			expect(result).toBe("node:better-sqlite3");
		});

		it("works with fallback operators", () => {
			const result = Parser.parse("$DB_DRIVER || bun:sqlite", {
				env: {},
				strict: false,
			});
			expect(result).toBe("bun:sqlite");
		});

		it("distinguishes ternary colon (with spaces) from identifier colon (no spaces)", () => {
			// "a ? b:c : d" - b:c is one identifier, outer : is ternary
			const result = Parser.parse(
				"$USE_CUSTOM ? custom:driver : default:driver",
				{env: {USE_CUSTOM: "1"}, strict: false},
			);
			expect(result).toBe("custom:driver");
		});
	});

	describe("quoted strings", () => {
		it("parses double-quoted strings", () => {
			const result = Parser.parse('"hello world"', {strict: false});
			expect(result).toBe("hello world");
		});

		it("parses single-quoted strings", () => {
			const result = Parser.parse("'hello world'", {strict: false});
			expect(result).toBe("hello world");
		});

		it("allows colons in quoted strings", () => {
			const result = Parser.parse('"bun:sqlite"', {strict: false});
			expect(result).toBe("bun:sqlite");
		});

		it("allows special chars in single-quoted strings", () => {
			const result = Parser.parse("'a ? b : c'", {strict: false});
			expect(result).toBe("a ? b : c");
		});

		it("handles escape sequences in double quotes", () => {
			const result = Parser.parse('"line1\\nline2"', {strict: false});
			expect(result).toBe("line1\nline2");
		});

		it("handles escape sequences in single quotes", () => {
			const result = Parser.parse("'tab\\there'", {strict: false});
			expect(result).toBe("tab\there");
		});

		it("allows double quotes inside single quotes", () => {
			const result = Parser.parse("'say \"hello\"'", {strict: false});
			expect(result).toBe('say "hello"');
		});

		it("allows single quotes inside double quotes", () => {
			const result = Parser.parse('"it\'s fine"', {strict: false});
			expect(result).toBe("it's fine");
		});

		it("works with fallback operators", () => {
			const result = Parser.parse("$MY_VAR || 'default value'", {
				env: {},
				strict: false,
			});
			expect(result).toBe("default value");
		});

		it("works in ternary expressions", () => {
			const result = Parser.parse(
				"$MODE === prod ? 'production' : 'development'",
				{env: {MODE: "dev"}, strict: false},
			);
			expect(result).toBe("development");
		});
	});

	describe("edge cases", () => {
		it("handles @ at start of identifier", () => {
			const result = Parser.parse("@scope/pkg", {strict: false});
			expect(result).toBe("@scope/pkg");
		});

		it("handles multiple slashes", () => {
			const result = Parser.parse("@scope/pkg/sub/path/deep", {strict: false});
			expect(result).toBe("@scope/pkg/sub/path/deep");
		});

		it("handles numbers in package names", () => {
			const result = Parser.parse("@b9g/cache2", {strict: false});
			expect(result).toBe("@b9g/cache2");
		});

		it("handles underscores in package names", () => {
			const result = Parser.parse("@my_org/my_pkg", {strict: false});
			expect(result).toBe("@my_org/my_pkg");
		});

		it("distinguishes env var from package ($VAR vs mixed)", () => {
			const result = Parser.parse("$MY_VAR || @b9g/fallback", {
				env: {MY_VAR: "@b9g/from-env"},
				strict: false,
			});
			expect(result).toBe("@b9g/from-env");
		});
	});

	describe("P1: path suffix should not mask missing env vars", () => {
		it("throws in strict mode when env var with path suffix is missing", () => {
			// $DATADIR/uploads with DATADIR unset should throw, not resolve to "uploads"
			expect(() => {
				Parser.parse("$DATADIR/uploads", {env: {}, strict: true});
			}).toThrow();
		});

		it("returns undefined (not partial path) in non-strict mode when env var missing", () => {
			// In non-strict mode, missing env var should make the whole expression undefined
			// not silently drop the variable and return just the suffix
			const result = Parser.parse("$DATADIR/uploads", {env: {}, strict: false});
			expect(result).toBeUndefined();
		});

		it("works correctly when env var with path suffix is set", () => {
			const result = Parser.parse("$DATADIR/uploads", {
				env: {DATADIR: "/var/data"},
				strict: true,
			});
			expect(result).toBe("/var/data/uploads");
		});
	});
});
