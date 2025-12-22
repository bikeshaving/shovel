/**
 * Tests for config module generation (shovel:config virtual module)
 */

import {describe, it, expect} from "bun:test";
import {exprToCode, generateConfigModule} from "../src/utils/config.js";

describe("exprToCode", () => {
	describe("literals", () => {
		// Note: exprToCode treats plain strings as literals, not as numbers/booleans
		// It only parses as expressions if they contain operators or are ALL_CAPS
		it("converts plain strings to string literals", () => {
			expect(exprToCode("3000")).toBe('"3000"');
			expect(exprToCode("redis")).toBe('"redis"');
			expect(exprToCode("memory")).toBe('"memory"');
			expect(exprToCode("localhost")).toBe('"localhost"');
		});

		it("converts kebab-case to string literals", () => {
			expect(exprToCode("my-bucket")).toBe('"my-bucket"');
			expect(exprToCode("api-v1")).toBe('"api-v1"');
		});

		it("converts URLs to string literals", () => {
			expect(exprToCode("redis://localhost:6379")).toBe(
				'"redis://localhost:6379"',
			);
			expect(exprToCode("https://example.com")).toBe('"https://example.com"');
		});

		it("converts paths to string literals", () => {
			expect(exprToCode("./uploads")).toBe('"./uploads"');
			expect(exprToCode("/var/data")).toBe('"/var/data"');
		});
	});

	describe("environment variables", () => {
		it("converts ALL_CAPS to process.env reference", () => {
			expect(exprToCode("PORT")).toBe("process.env.PORT");
			expect(exprToCode("REDIS_URL")).toBe("process.env.REDIS_URL");
			expect(exprToCode("NODE_ENV")).toBe("process.env.NODE_ENV");
		});

		it("handles env vars with numbers", () => {
			expect(exprToCode("AWS_S3_BUCKET")).toBe("process.env.AWS_S3_BUCKET");
		});
	});

	describe("operators", () => {
		it("handles || fallback", () => {
			// exprToCode wraps expressions in parentheses and treats numbers as numbers
			expect(exprToCode("PORT || 3000")).toBe("(process.env.PORT || 3000)");
			expect(exprToCode("HOST || localhost")).toBe(
				'(process.env.HOST || "localhost")',
			);
		});

		it("handles ?? nullish coalescing", () => {
			expect(exprToCode("PORT ?? 3000")).toBe("(process.env.PORT ?? 3000)");
		});

		it("handles === comparison", () => {
			expect(exprToCode("NODE_ENV === production")).toBe(
				'(process.env.NODE_ENV === "production")',
			);
		});

		it("handles ternary expressions", () => {
			expect(exprToCode("NODE_ENV === production ? redis : memory")).toBe(
				'((process.env.NODE_ENV === "production") ? "redis" : "memory")',
			);
		});

		it("handles complex expressions", () => {
			const result = exprToCode("REDIS_URL || redis://localhost:6379");
			expect(result).toBe(
				'(process.env.REDIS_URL || "redis://localhost:6379")',
			);
		});
	});

	describe("quoted strings", () => {
		it("preserves quoted strings literally", () => {
			// exprToCode escapes double quotes within the output
			expect(exprToCode('"literal string"')).toBe(
				'"' + '\\"literal string\\"' + '"',
			);
			// Single quotes are not escaped since output uses double quotes
			expect(exprToCode("'single quoted'")).toBe("\"'single quoted'\"");
		});
	});
});

describe("generateConfigModule", () => {
	describe("basic config", () => {
		it("generates module with default port/host placeholders", () => {
			const module = generateConfigModule({});

			expect(module).toContain("export const config");
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

		it("handles port/host as expressions", () => {
			const config = {
				port: "PORT || 3000",
				host: "HOST || localhost",
			};

			const module = generateConfigModule(config);

			expect(module).toContain("process.env.PORT");
			expect(module).toContain("process.env.HOST");
			expect(module).toContain('(process.env.HOST || "localhost")');
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

			const module = generateConfigModule(config, {
				REDIS_URL: "redis://localhost",
			});

			// Should have static import for the module
			expect(module).toContain('from "@b9g/cache-redis"');
			// Should reference the imported module via factory
			expect(module).toContain("factory: cache_");
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

			// No import needed
			expect(module).not.toContain("import");
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

			const module = generateConfigModule(config, {
				S3_BUCKET: "my-bucket",
			});

			expect(module).toContain('from "@b9g/filesystem-s3"');
			expect(module).toContain("factory: directory_");
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

	describe("secrets handling", () => {
		it("keeps secrets as process.env references", () => {
			const config = {
				caches: {
					sessions: {
						module: "@b9g/cache-redis",
						url: "REDIS_URL",
						password: "REDIS_PASSWORD",
					},
				},
			};

			const module = generateConfigModule(config, {
				REDIS_URL: "redis://localhost",
				REDIS_PASSWORD: "secret123",
			});

			// Secrets should NOT be baked in
			expect(module).not.toContain("secret123");
			expect(module).not.toContain("redis://localhost");
			// Should be process.env references
			expect(module).toContain("process.env.REDIS_URL");
			expect(module).toContain("process.env.REDIS_PASSWORD");
		});

		it("keeps URL with credentials as env reference", () => {
			const config = {
				caches: {
					sessions: {
						module: "@b9g/cache-redis",
						url: "REDIS_URL || redis://localhost:6379",
					},
				},
			};

			const module = generateConfigModule(config, {REDIS_URL: undefined});

			// Should have env reference with fallback
			expect(module).toContain("process.env.REDIS_URL");
			expect(module).toContain('"redis://localhost:6379"');
		});

		it("never exposes env var values in output", () => {
			const config = {
				port: "PORT || 3000",
				host: "HOST",
				caches: {
					sessions: {
						module: "@b9g/cache-redis",
						url: "REDIS_URL",
					},
				},
				directories: {
					files: {
						module: "@b9g/filesystem-s3",
						bucket: "S3_BUCKET",
						accessKey: "AWS_ACCESS_KEY",
						secretKey: "AWS_SECRET_KEY",
					},
				},
			};

			const module = generateConfigModule(config, {
				PORT: "8080",
				HOST: "0.0.0.0",
				REDIS_URL: "redis://:password@redis.example.com:6379",
				S3_BUCKET: "production-bucket",
				AWS_ACCESS_KEY: "AKIAIOSFODNN7EXAMPLE",
				AWS_SECRET_KEY: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
			});

			// None of the actual env values should appear
			expect(module).not.toContain("8080");
			expect(module).not.toContain("0.0.0.0");
			expect(module).not.toContain("password");
			expect(module).not.toContain("redis.example.com");
			expect(module).not.toContain("production-bucket");
			expect(module).not.toContain("AKIAIOSFODNN7EXAMPLE");
			expect(module).not.toContain("wJalrXUtnFEMI");

			// Only process.env references should appear
			expect(module).toContain("process.env.PORT");
			expect(module).toContain("process.env.HOST");
			expect(module).toContain("process.env.REDIS_URL");
			expect(module).toContain("process.env.S3_BUCKET");
			expect(module).toContain("process.env.AWS_ACCESS_KEY");
			expect(module).toContain("process.env.AWS_SECRET_KEY");
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
			expect(module).toContain("databases:");
			expect(module).toContain("main:");
		});
	});
});
