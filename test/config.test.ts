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
const envKeys = [
	"PORT",
	"HOST",
	"WORKERS",
	"PLATFORM",
	"MY_HOST",
	"DATABASE_URL",
	"REDIS_URL",
];

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

				expect(config.port).toBe(7777); // default
				expect(config.host).toBe("0.0.0.0"); // default
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
				expect(config.host).toBe("0.0.0.0"); // default
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

				expect(config.port).toBe(7777);
				expect(config.host).toBe("0.0.0.0");
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

	describe("missing env var without fallback", () => {
		it("throws when expression evaluates to undefined", () => {
			withTempDir((testDir) => {
				clearEnv();
				writeFileSync(
					join(testDir, "shovel.json"),
					JSON.stringify({
						databases: {
							main: {
								module: "@b9g/zen/postgres",
								url: "$DATABASE_URL",
							},
						},
					}),
				);
				// DATABASE_URL not set, no fallback provided

				expect(() => loadConfig(testDir)).toThrow();
			});
		});

		it("throws with helpful error message", () => {
			withTempDir((testDir) => {
				clearEnv();
				writeFileSync(
					join(testDir, "shovel.json"),
					JSON.stringify({
						caches: {
							redis: {
								module: "@b9g/cache/redis",
								url: "$REDIS_URL",
							},
						},
					}),
				);

				expect(() => loadConfig(testDir)).toThrow(/REDIS_URL|fallback/i);
			});
		});

		it("works when env var is set", () => {
			withTempDir((testDir) => {
				clearEnv();
				writeFileSync(
					join(testDir, "shovel.json"),
					JSON.stringify({
						databases: {
							main: {
								module: "@b9g/zen/postgres",
								url: "$DATABASE_URL",
							},
						},
					}),
				);
				process.env.DATABASE_URL = "postgres://localhost/mydb";

				const config = loadConfig(testDir);

				expect(config.databases.main.url).toBe("postgres://localhost/mydb");
			});
		});

		it("allows intentional null fallbacks", () => {
			withTempDir((testDir) => {
				clearEnv();
				writeFileSync(
					join(testDir, "shovel.json"),
					JSON.stringify({
						databases: {
							main: {
								module: "@b9g/zen/postgres",
								url: "$DATABASE_URL ?? null",
							},
						},
					}),
				);
				// DATABASE_URL not set, but null fallback is intentional

				const config = loadConfig(testDir);

				expect(config.databases.main.url).toBe(null);
			});
		});
	});
});

describe("Parser.parse", () => {
	describe("identifiers", () => {
		it("parses scoped npm package names", () => {
			expect(Parser.parse("@b9g/cache-redis")).toBe("@b9g/cache-redis");
		});

		it("parses package names with slashes", () => {
			expect(Parser.parse("@b9g/cache/memory")).toBe("@b9g/cache/memory");
		});

		it("parses package names with hyphens", () => {
			expect(Parser.parse("my-custom-cache")).toBe("my-custom-cache");
		});

		it("parses deeply nested paths", () => {
			expect(Parser.parse("@org/pkg/sub/path")).toBe("@org/pkg/sub/path");
		});

		it("parses PascalCase export names", () => {
			expect(Parser.parse("RedisCache")).toBe("RedisCache");
		});

		it("parses camelCase export names", () => {
			expect(Parser.parse("memoryCache")).toBe("memoryCache");
		});
	});

	describe("colon in identifiers (word:word patterns)", () => {
		it("parses bun:sqlite as single identifier", () => {
			expect(Parser.parse("bun:sqlite")).toBe("bun:sqlite");
		});

		it("parses node:fs as single identifier", () => {
			expect(Parser.parse("node:fs")).toBe("node:fs");
		});

		it("parses multi-colon patterns", () => {
			expect(Parser.parse("a:b:c")).toBe("a:b:c");
		});
	});

	describe("quoted strings", () => {
		it("parses double-quoted strings", () => {
			expect(Parser.parse('"hello world"')).toBe("hello world");
		});

		it("parses single-quoted strings", () => {
			expect(Parser.parse("'hello world'")).toBe("hello world");
		});

		it("handles escape sequences", () => {
			expect(Parser.parse('"line1\\nline2"')).toBe("line1\nline2");
			expect(Parser.parse("'tab\\there'")).toBe("tab\there");
		});

		it("allows quotes inside different quotes", () => {
			expect(Parser.parse("'say \"hello\"'")).toBe('say "hello"');
			expect(Parser.parse('"it\'s fine"')).toBe("it's fine");
		});
	});

	describe("ternary expressions", () => {
		it("selects first branch when condition is true", () => {
			const result = Parser.parse(
				"$MODE === production ? @b9g/cache-redis : @b9g/cache/memory",
				{MODE: "production"},
			);
			expect(result).toBe("@b9g/cache-redis");
		});

		it("selects second branch when condition is false", () => {
			const result = Parser.parse(
				"$MODE === production ? @b9g/cache-redis : @b9g/cache/memory",
				{MODE: "development"},
			);
			expect(result).toBe("@b9g/cache/memory");
		});

		it("works with undefined env var (falsy condition)", () => {
			const result = Parser.parse(
				"$USE_REDIS ? @b9g/cache-redis : @b9g/cache/memory",
				{},
			);
			expect(result).toBe("@b9g/cache/memory");
		});

		it("works with truthy env var", () => {
			const result = Parser.parse(
				"$USE_REDIS ? @b9g/cache-redis : @b9g/cache/memory",
				{USE_REDIS: "1"},
			);
			expect(result).toBe("@b9g/cache-redis");
		});

		it("distinguishes ternary colon from identifier colon", () => {
			const result = Parser.parse(
				"$PLATFORM === bun ? bun:sqlite : better-sqlite3",
				{PLATFORM: "bun"},
			);
			expect(result).toBe("bun:sqlite");
		});
	});

	describe("logical operators", () => {
		it("|| returns first truthy value", () => {
			expect(Parser.parse("$CACHE || @b9g/cache/memory", {})).toBe(
				"@b9g/cache/memory",
			);
		});

		it("|| returns env var when set", () => {
			expect(
				Parser.parse("$CACHE || @b9g/cache/memory", {CACHE: "@custom/cache"}),
			).toBe("@custom/cache");
		});

		it("?? returns first non-nullish value", () => {
			expect(Parser.parse("$CACHE ?? @b9g/cache/memory", {})).toBe(
				"@b9g/cache/memory",
			);
		});
	});

	describe("equality operators", () => {
		it("=== compares values", () => {
			expect(
				Parser.parse("$PROVIDER === @b9g/cache-redis", {
					PROVIDER: "@b9g/cache-redis",
				}),
			).toBe(true);
		});

		it("!== compares values", () => {
			expect(
				Parser.parse("$PROVIDER !== @b9g/cache/memory", {
					PROVIDER: "@b9g/cache-redis",
				}),
			).toBe(true);
		});
	});

	describe("path expressions", () => {
		it("joins env var with path suffix", () => {
			expect(Parser.parse("$DATADIR/uploads", {DATADIR: "/var/data"})).toBe(
				"/var/data/uploads",
			);
		});

		it("returns undefined when env var missing", () => {
			expect(Parser.parse("$DATADIR/uploads", {})).toBeUndefined();
		});
	});
});
