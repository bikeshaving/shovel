/**
 * Tests for config module generation (shovel:config virtual module)
 */

import {describe, it, expect} from "bun:test";
import {
	exprToCode,
	generateConfigModule as _generateConfigModule,
	generateStorageTypes,
	type ShovelConfig,
} from "../src/utils/config.js";

// Helper to provide default projectDir and outDir for tests
function generateConfigModule(
	config: ShovelConfig,
	options?: {
		platformDefaults?: {
			directories?: Record<
				string,
				{module: string; export?: string; [key: string]: unknown}
			>;
			caches?: Record<
				string,
				{module: string; export?: string; [key: string]: unknown}
			>;
		};
	},
) {
	return _generateConfigModule(config, {
		projectDir: "/test/project",
		outDir: "/test/project/dist",
		...options,
	});
}

describe("exprToCode", () => {
	describe("literals", () => {
		// Note: exprToCode treats plain strings as literals (including ALL_CAPS)
		// Env vars now require $ prefix
		it("converts plain strings to string literals", () => {
			expect(exprToCode("3000").code).toBe('"3000"');
			expect(exprToCode("redis").code).toBe('"redis"');
			expect(exprToCode("memory").code).toBe('"memory"');
			expect(exprToCode("localhost").code).toBe('"localhost"');
		});

		it("treats ALL_CAPS without $ as string literals", () => {
			// Breaking change: bare ALL_CAPS is now literal, not env var
			expect(exprToCode("PORT").code).toBe('"PORT"');
			expect(exprToCode("MY_KV_BINDING").code).toBe('"MY_KV_BINDING"');
		});

		it("converts kebab-case to string literals", () => {
			expect(exprToCode("my-bucket").code).toBe('"my-bucket"');
			expect(exprToCode("api-v1").code).toBe('"api-v1"');
		});

		it("converts URLs to string literals", () => {
			expect(exprToCode("redis://localhost:6379").code).toBe(
				'"redis://localhost:6379"',
			);
			expect(exprToCode("https://example.com").code).toBe(
				'"https://example.com"',
			);
		});
	});

	describe("environment variables with $ prefix", () => {
		it("converts $VAR to env() call", () => {
			expect(exprToCode("$PORT").code).toBe('env("PORT")');
			expect(exprToCode("$REDIS_URL").code).toBe('env("REDIS_URL")');
			expect(exprToCode("$NODE_ENV").code).toBe('env("NODE_ENV")');
		});

		it("tracks used functions", () => {
			expect(exprToCode("$PORT").usedFunctions).toContain("env");
		});
	});

	describe("operators", () => {
		it("handles || fallback", () => {
			// env() returns undefined if not set, so || works naturally
			expect(exprToCode("$PORT || 3000").code).toBe('(env("PORT") || 3000)');
			expect(exprToCode("$HOST || localhost").code).toBe(
				'(env("HOST") || "localhost")',
			);
		});

		it("handles ?? nullish coalescing", () => {
			expect(exprToCode("$PORT ?? 3000").code).toBe('(env("PORT") ?? 3000)');
		});

		it("handles === comparison", () => {
			expect(exprToCode("$NODE_ENV === production").code).toBe(
				'(env("NODE_ENV") === "production")',
			);
		});

		it("handles ternary expressions", () => {
			expect(exprToCode("$NODE_ENV === production ? redis : memory").code).toBe(
				'((env("NODE_ENV") === "production") ? "redis" : "memory")',
			);
		});

		it("handles complex expressions", () => {
			const result = exprToCode("$REDIS_URL || redis://localhost:6379");
			expect(result.code).toBe('(env("REDIS_URL") || "redis://localhost:6379")');
		});
	});

	describe("dunders", () => {
		it("converts __outdir__ to outdir() call", () => {
			expect(exprToCode("__outdir__").code).toBe("outdir()");
			expect(exprToCode("__outdir__").usedFunctions).toContain("outdir");
		});

		it("converts __tmpdir__ to tmpdir() call", () => {
			expect(exprToCode("__tmpdir__").code).toBe("tmpdir()");
			expect(exprToCode("__tmpdir__").usedFunctions).toContain("tmpdir");
		});
	});

	describe("path joining", () => {
		it("joins env var with path suffix", () => {
			const result = exprToCode("$DATADIR/uploads");
			expect(result.code).toBe('joinPath(env("DATADIR"), "uploads")');
			expect(result.usedFunctions).toContain("env");
			expect(result.usedFunctions).toContain("joinPath");
		});

		it("joins dunder with path suffix", () => {
			expect(exprToCode("__outdir__/server").code).toBe(
				'joinPath(outdir(), "server")',
			);
			expect(exprToCode("__tmpdir__/cache").code).toBe(
				'joinPath(tmpdir(), "cache")',
			);
		});

		it("joins multiple path segments", () => {
			expect(exprToCode("$DATADIR/uploads/images").code).toBe(
				'joinPath(env("DATADIR"), "uploads", "images")',
			);
		});

		it("joins fallback expression with suffix", () => {
			const result = exprToCode("($CACHE || __tmpdir__)/myapp");
			expect(result.code).toBe(
				'joinPath(((env("CACHE") || tmpdir())), "myapp")',
			);
		});
	});

	describe("quoted strings", () => {
		it("preserves quoted strings literally", () => {
			// exprToCode escapes double quotes within the output
			expect(exprToCode('"literal string"').code).toBe(
				'"' + '\\"literal string\\"' + '"',
			);
			// Single quotes are not escaped since output uses double quotes
			expect(exprToCode("'single quoted'").code).toBe("\"'single quoted'\"");
		});
	});
});

describe("generateConfigModule", () => {
	describe("basic config", () => {
		it("generates module with default port/host placeholders", () => {
			const module = generateConfigModule({});

			expect(module).toContain("export const config");
			// Default port/host still use process.env for backwards compatibility
			expect(module).toContain("process.env.PORT");
			expect(module).toContain("process.env.HOST");
		});

		it("includes explicit port/host values", () => {
			const config = {
				port: 8080,
				host: "0.0.0.0",
			};

			const module = generateConfigModule(config);

			expect(module).toContain("port: 8080");
			expect(module).toContain('host: "0.0.0.0"');
		});

		it("handles port/host as expressions with $ prefix", () => {
			const config = {
				port: "$PORT || 3000",
				host: "$HOST || localhost",
			};

			const module = generateConfigModule(config);

			// Should import env and validateConfig from platform/config
			expect(module).toContain("env");
			expect(module).toContain("validateConfig");
			expect(module).toContain('@b9g/platform/config"');
			expect(module).toContain('(env("PORT") || 3000)');
			expect(module).toContain('(env("HOST") || "localhost")');
		});
	});

	describe("cache config with module", () => {
		it("generates static import for cache module", () => {
			const config = {
				caches: {
					sessions: {
						module: "@b9g/cache-redis",
						url: "REDIS_URL",
					},
				},
			};

			const module = generateConfigModule(config);

			// Should have static import for the module
			expect(module).toContain('from "@b9g/cache-redis"');
			// Should reference the imported module via CacheClass
			expect(module).toContain("CacheClass: cache_");
		});

		it("generates import with named export", () => {
			const config = {
				caches: {
					sessions: {
						module: "@b9g/cache",
						export: "createMemoryCache",
						maxEntries: 100,
					},
				},
			};

			const module = generateConfigModule(config);

			expect(module).toContain(
				"import { createMemoryCache as cache_sessions }",
			);
			expect(module).toContain('from "@b9g/cache"');
		});

		it("handles cache without module (passthrough)", () => {
			const config = {
				caches: {
					sessions: {
						maxEntries: 100,
						TTL: 3600,
					},
				},
			};

			const module = generateConfigModule(config);

			// Only validateConfig import needed (no provider imports)
			expect(module).toContain("validateConfig");
			expect(module).not.toContain("cache_");
			// Config should be passed through
			expect(module).toContain("sessions:");
			expect(module).toContain("maxEntries: 100");
		});

		it("handles multiple caches", () => {
			const config = {
				caches: {
					sessions: {
						module: "@b9g/cache-redis",
						TTL: 86400,
					},
					api: {
						module: "@b9g/cache/memory",
						maxEntries: 1000,
					},
				},
			};

			const module = generateConfigModule(config);

			expect(module).toContain('from "@b9g/cache-redis"');
			expect(module).toContain('from "@b9g/cache/memory"');
			expect(module).toContain("sessions:");
			expect(module).toContain("api:");
		});
	});

	describe("directory config with module", () => {
		it("generates static import for directory module", () => {
			const config = {
				directories: {
					uploads: {
						module: "@b9g/filesystem-s3",
						bucket: "S3_BUCKET",
						region: "AWS_REGION || us-east-1",
					},
				},
			};

			const module = generateConfigModule(config);

			expect(module).toContain('from "@b9g/filesystem-s3"');
			expect(module).toContain("DirectoryClass: directory_");
		});

		it("generates import for node-fs module", () => {
			const config = {
				directories: {
					uploads: {
						module: "@b9g/filesystem/node-fs",
						path: "./uploads",
					},
				},
			};

			const module = generateConfigModule(config);

			expect(module).toContain('from "@b9g/filesystem/node-fs"');
		});
	});

	describe("platform defaults deep merge", () => {
		it("preserves module/export when user only overrides path", () => {
			// User wants to change tmp path but keep the default NodeFSDirectory
			const module = generateConfigModule(
				{
					directories: {
						tmp: {path: "./my-tmp"}, // Only override path, not module
					},
				},
				{
					platformDefaults: {
						directories: {
							tmp: {
								module: "@b9g/filesystem/node-fs",
								export: "NodeFSDirectory",
								path: "tmpdir",
							},
						},
					},
				},
			);

			// Should still have the import from platform defaults
			expect(module).toContain('from "@b9g/filesystem/node-fs"');
			expect(module).toContain("DirectoryClass: directory_");
			// User's path override should be present as literal
			expect(module).toContain('path: "./my-tmp"');
		});

		it("preserves module/export when user only overrides cache options", () => {
			// User wants to change cache options but keep the default cache class
			const module = generateConfigModule(
				{
					caches: {
						sessions: {TTL: 3600}, // Only override TTL, not module
					},
				},
				{
					platformDefaults: {
						caches: {
							sessions: {
								module: "@b9g/cache/memory",
								export: "MemoryCache",
							},
						},
					},
				},
			);

			// Should still have the import from platform defaults
			expect(module).toContain('from "@b9g/cache/memory"');
			expect(module).toContain("CacheClass: cache_");
			// User's ttl override should be present
			expect(module).toContain("3600");
		});

		it("allows user to fully override module if specified", () => {
			// User provides their own module - should use user's module
			const module = generateConfigModule(
				{
					directories: {
						tmp: {
							module: "@b9g/filesystem/memory",
							export: "MemoryDirectory",
						},
					},
				},
				{
					platformDefaults: {
						directories: {
							tmp: {
								module: "@b9g/filesystem/node-fs",
								export: "NodeFSDirectory",
								path: "tmpdir",
							},
						},
					},
				},
			);

			// Should use user's module, not platform default
			expect(module).toContain('from "@b9g/filesystem/memory"');
			expect(module).not.toContain('from "@b9g/filesystem/node-fs"');
		});
	});

	describe("secrets handling", () => {
		it("keeps secrets as env() references", () => {
			const config = {
				caches: {
					sessions: {
						module: "@b9g/cache-redis",
						url: "$REDIS_URL",
						password: "$REDIS_PASSWORD",
					},
				},
			};

			const module = generateConfigModule(config, {});

			// Secrets should NOT be baked in
			expect(module).not.toContain("secret123");
			expect(module).not.toContain("redis://localhost");
			// Should be env() references
			expect(module).toContain('env("REDIS_URL")');
			expect(module).toContain('env("REDIS_PASSWORD")');
		});

		it("keeps URL with credentials as env reference", () => {
			const config = {
				caches: {
					sessions: {
						module: "@b9g/cache-redis",
						url: "$REDIS_URL || redis://localhost:6379",
					},
				},
			};

			const module = generateConfigModule(config, {});

			// Should have env reference with fallback using || operator
			expect(module).toContain('(env("REDIS_URL") || "redis://localhost:6379")');
		});

		it("never exposes env var values in output", () => {
			const config = {
				port: "$PORT || 3000",
				host: "$HOST",
				caches: {
					sessions: {
						module: "@b9g/cache-redis",
						url: "$REDIS_URL",
					},
				},
				directories: {
					files: {
						module: "@b9g/filesystem-s3",
						bucket: "$S3_BUCKET",
						accessKey: "$AWS_ACCESS_KEY",
						secretKey: "$AWS_SECRET_KEY",
					},
				},
			};

			const module = generateConfigModule(config, {});

			// None of the actual env values should appear
			expect(module).not.toContain("8080");
			expect(module).not.toContain("0.0.0.0");
			expect(module).not.toContain("password");
			expect(module).not.toContain("redis.example.com");
			expect(module).not.toContain("production-bucket");
			expect(module).not.toContain("AKIAIOSFODNN7EXAMPLE");
			expect(module).not.toContain("wJalrXUtnFEMI");

			// Only env() references should appear
			expect(module).toContain('env("PORT")'); // has fallback via ||
			expect(module).toContain('env("HOST")'); // no fallback
			expect(module).toContain('env("REDIS_URL")');
			expect(module).toContain('env("S3_BUCKET")');
			expect(module).toContain('env("AWS_ACCESS_KEY")');
			expect(module).toContain('env("AWS_SECRET_KEY")');
		});
	});

	describe("logging config", () => {
		it("includes logging config in output", () => {
			const config = {
				logging: {
					sinks: {
						console: {module: "@logtape/logtape", export: "getConsoleSink"},
					},
					loggers: [{category: [], level: "info" as const, sinks: ["console"]}],
				},
			};

			const module = generateConfigModule(config);

			expect(module).toContain("logging:");
			expect(module).toContain("sinks:");
			expect(module).toContain("console:");
		});

		it("generates empty logging config when not specified", () => {
			const config = {
				port: 3000,
			};

			const module = generateConfigModule(config);

			expect(module).toContain("logging:");
		});

		it("generates imports for sink modules", () => {
			const config = {
				logging: {
					sinks: {
						console: {module: "@logtape/logtape", export: "getConsoleSink"},
						file: {module: "@logtape/logtape", export: "getFileSink"},
					},
					loggers: [
						{category: [], level: "info" as const, sinks: ["console", "file"]},
					],
				},
			};

			const module = generateConfigModule(config);

			expect(module).toContain('from "@logtape/logtape"');
			expect(module).toContain("factory: sink_console");
			expect(module).toContain("factory: sink_file");
		});

		it("includes logger config with categories", () => {
			const config = {
				logging: {
					sinks: {
						dbFile: {module: "@logtape/logtape", export: "getFileSink"},
					},
					loggers: [
						{
							category: ["app"],
							level: "debug" as const,
							sinks: ["dbFile"],
						},
						{
							category: ["app", "db"],
							level: "warning" as const,
							sinks: ["dbFile"],
						},
					],
				},
			};

			const module = generateConfigModule(config);

			expect(module).toContain("loggers:");
			expect(module).toContain('"app"');
			expect(module).toContain('"db"');
			expect(module).toContain('"debug"');
			expect(module).toContain('"warning"');
		});

		it("handles parentSinks override", () => {
			const config = {
				logging: {
					sinks: {
						customSink: {module: "@logtape/logtape", export: "getConsoleSink"},
					},
					loggers: [
						{
							category: ["lib"],
							sinks: ["customSink"],
						},
						{
							category: ["lib", "internal"],
							sinks: ["customSink"],
							parentSinks: "override" as const,
						},
					],
				},
			};

			const module = generateConfigModule(config);

			expect(module).toContain('parentSinks: "override"');
		});
	});

	describe("database config", () => {
		it("generates import for database module", () => {
			const config = {
				databases: {
					main: {
						module: "@b9g/zen/bun",
						url: "DATABASE_URL || sqlite://./data/app.db",
					},
				},
			};

			const module = generateConfigModule(config);

			expect(module).toContain('from "@b9g/zen/bun"');
			// databases uses a getter because url contains joinPath (a platform function)
			expect(module).toContain("get databases()");
			expect(module).toContain("get main()");
		});
	});
});

describe("generateStorageTypes", () => {
	it("returns empty string when no storage configured", () => {
		const result = generateStorageTypes({});
		expect(result).toBe("");
	});

	it("includes database and directory overloads when configured", () => {
		const result = generateStorageTypes({
			databases: {
				main: {module: "@b9g/zen/bun", url: "sqlite://./db.sqlite"},
			},
			directories: {
				uploads: {module: "@b9g/filesystem/node-fs", path: "./uploads"},
			},
		});

		expect(result).toContain('import type {Database} from "@b9g/zen";');
		expect(result).toContain(
			'import type {DatabaseUpgradeEvent} from "@b9g/platform";',
		);
		expect(result).toContain('type ValidDatabaseName = "main";');
		expect(result).toContain('type ValidDirectoryName = "uploads";');
	});

	it("includes platform defaults in directory types", () => {
		const result = generateStorageTypes(
			{}, // No user config
			{
				platformDefaults: {
					directories: {
						server: {module: "@b9g/filesystem/node-fs", path: "."},
						public: {module: "@b9g/filesystem/node-fs", path: "../public"},
						tmp: {module: "@b9g/filesystem/node-fs", path: "tmpdir"},
					},
				},
			},
		);

		expect(result).toContain(
			'type ValidDirectoryName = "server" | "public" | "tmp";',
		);
	});

	it("includes platform defaults in cache types", () => {
		const result = generateStorageTypes(
			{}, // No user config
			{
				platformDefaults: {
					caches: {
						default: {module: "@b9g/cache/memory"},
					},
				},
			},
		);

		expect(result).toContain('type ValidCacheName = "default";');
		expect(result).toContain("interface CacheStorage");
	});

	it("merges user config with platform defaults (user wins)", () => {
		const result = generateStorageTypes(
			{
				directories: {
					uploads: {module: "@b9g/filesystem/memory"},
					// User overrides 'tmp' from platform defaults
					tmp: {module: "@b9g/filesystem/memory"},
				},
			},
			{
				platformDefaults: {
					directories: {
						server: {module: "@b9g/filesystem/node-fs", path: "."},
						tmp: {module: "@b9g/filesystem/node-fs", path: "tmpdir"},
					},
				},
			},
		);

		// Should include both platform defaults and user config
		expect(result).toContain('"server"');
		expect(result).toContain('"uploads"');
		expect(result).toContain('"tmp"');
		// All should be in the union
		expect(result).toContain("type ValidDirectoryName =");
	});
});
