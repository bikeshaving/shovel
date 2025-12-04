/**
 * Tests for config module generation (shovel:config virtual module)
 */

import {describe, it, expect} from "bun:test";
import {
	exprToCode,
	generateConfigModule,
	BUILTIN_CACHE_PROVIDERS,
	BUILTIN_BUCKET_PROVIDERS,
} from "../src/config.js";

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
		it("converts || (or) expressions", () => {
			expect(exprToCode("PORT || 3000")).toBe("(process.env.PORT || 3000)");
			expect(exprToCode("HOST || localhost")).toBe(
				'(process.env.HOST || "localhost")',
			);
		});

		it("converts && (and) expressions", () => {
			expect(exprToCode("REDIS_ENABLED && REDIS_URL")).toBe(
				"(process.env.REDIS_ENABLED && process.env.REDIS_URL)",
			);
		});

		it("converts === equality", () => {
			expect(exprToCode("NODE_ENV === production")).toBe(
				'(process.env.NODE_ENV === "production")',
			);
		});

		it("converts !== inequality", () => {
			expect(exprToCode("NODE_ENV !== development")).toBe(
				'(process.env.NODE_ENV !== "development")',
			);
		});

		it("converts ternary expressions", () => {
			// Note: condition gets wrapped in parens
			expect(exprToCode("NODE_ENV === production ? redis : memory")).toBe(
				'((process.env.NODE_ENV === "production") ? "redis" : "memory")',
			);
		});

		it("converts negation", () => {
			expect(exprToCode("!DEBUG")).toBe("!process.env.DEBUG");
		});

		it("handles parentheses", () => {
			// Note: parens around expression are preserved
			expect(exprToCode("(PORT || 3000)")).toBe("((process.env.PORT || 3000))");
		});
	});

	describe("complex expressions", () => {
		it("handles nested ternary", () => {
			const expr =
				"NODE_ENV === production ? redis : NODE_ENV === test ? memory : memory";
			const code = exprToCode(expr);
			expect(code).toContain("process.env.NODE_ENV");
			expect(code).toContain('"production"');
			expect(code).toContain('"redis"');
			expect(code).toContain('"memory"');
		});

		it("handles combined && and ||", () => {
			expect(exprToCode("REDIS_ENABLED && REDIS_URL || memory")).toBe(
				'((process.env.REDIS_ENABLED && process.env.REDIS_URL) || "memory")',
			);
		});
	});
});

describe("generateConfigModule", () => {
	describe("basic config", () => {
		it("generates module with literal values", () => {
			const config = {
				port: 3000,
				host: "localhost",
				workers: 2,
			};

			const module = generateConfigModule(config);

			expect(module).toContain("export const config");
			expect(module).toContain("port: 3000");
			expect(module).toContain('host: "localhost"');
			expect(module).toContain("workers: 2");
		});

		it("generates module with expression values", () => {
			const config = {
				port: "PORT || 3000",
				host: "HOST || localhost",
			};

			const module = generateConfigModule(config, {
				PORT: "8080",
				HOST: undefined,
			});

			expect(module).toContain("(process.env.PORT || 3000)");
			expect(module).toContain('(process.env.HOST || "localhost")');
		});
	});

	describe("cache providers", () => {
		it("generates static import for redis provider", () => {
			const config = {
				caches: {
					"*": {
						provider: "redis",
						url: "REDIS_URL",
					},
				},
			};

			const module = generateConfigModule(config, {
				REDIS_URL: "redis://localhost",
			});

			// Should have static import for redis
			expect(module).toContain('from "@b9g/cache-redis"');
			// Should reference the imported module in config
			expect(module).toContain("provider: cache_");
		});

		it("uses inline string for memory provider (no import)", () => {
			// Memory is a special built-in, no import needed
			const config = {
				caches: {
					"*": {
						provider: "memory",
						maxEntries: 100,
					},
				},
			};

			const module = generateConfigModule(config);

			// Memory is inlined, no import
			expect(module).not.toContain('from "@b9g/cache');
			expect(module).toContain('provider: "memory"');
		});

		it("handles conditional provider expression at build time", () => {
			const config = {
				caches: {
					sessions: {
						provider: "NODE_ENV === production ? redis : memory",
					},
				},
			};

			// In production mode - evaluates to redis, imports redis module
			const prodModule = generateConfigModule(config, {NODE_ENV: "production"});
			expect(prodModule).toContain('from "@b9g/cache-redis"');
			expect(prodModule).toContain("provider: cache_sessions");

			// In development mode - evaluates to memory, no import needed
			// (memory is special-cased as built-in)
			const devModule = generateConfigModule(config, {NODE_ENV: "development"});
			expect(devModule).not.toContain('from "@b9g/cache-redis"');
			// Expression stays in output for runtime (though it evaluates to "memory")
			expect(devModule).toContain("process.env.NODE_ENV");
		});

		it("handles multiple cache patterns", () => {
			const config = {
				caches: {
					sessions: {
						provider: "redis",
						TTL: 86400,
					},
					"api-*": {
						provider: "redis",
						TTL: 300,
					},
					"*": {
						provider: "memory",
						maxEntries: 100,
					},
				},
			};

			const module = generateConfigModule(config, {});

			// Should have redis import (used by sessions and api-*)
			expect(module).toContain('from "@b9g/cache-redis"');
			// Should have all patterns in config
			expect(module).toContain("sessions");
			expect(module).toContain('"api-*"');
			expect(module).toContain('"*"');
		});

		it("handles custom provider path", () => {
			const config = {
				caches: {
					"*": {
						provider: "my-custom-cache",
						customOption: "value",
					},
				},
			};

			const module = generateConfigModule(config);

			// Should import custom provider
			expect(module).toContain('from "my-custom-cache"');
		});
	});

	describe("bucket providers", () => {
		it("generates static import for s3 provider", () => {
			const config = {
				buckets: {
					uploads: {
						provider: "s3",
						bucket: "S3_BUCKET",
						region: "AWS_REGION || us-east-1",
					},
				},
			};

			const module = generateConfigModule(config, {
				S3_BUCKET: "my-bucket",
				AWS_REGION: undefined,
			});

			expect(module).toContain('from "@b9g/filesystem-s3"');
			expect(module).toContain("provider: bucket_");
		});

		it("generates static import for node provider", () => {
			// Node is a blessed provider that gets imported
			const config = {
				buckets: {
					uploads: {
						provider: "node",
						path: "./uploads",
					},
				},
			};

			const module = generateConfigModule(config);

			// Node is a built-in provider, gets imported
			expect(module).toContain('from "@b9g/filesystem/node.js"');
			expect(module).toContain("provider: bucket_");
		});

		it("handles conditional bucket provider at build time", () => {
			const config = {
				buckets: {
					uploads: {
						provider: "S3_ENABLED ? s3 : node",
						bucket: "S3_BUCKET",
					},
				},
			};

			// With S3 enabled - evaluates to s3
			const s3Module = generateConfigModule(config, {S3_ENABLED: "true"});
			expect(s3Module).toContain('from "@b9g/filesystem-s3"');

			// Without S3 - evaluates to node
			const nodeModule = generateConfigModule(config, {S3_ENABLED: ""});
			expect(nodeModule).toContain('from "@b9g/filesystem/node.js"');
		});
	});

	describe("secrets handling", () => {
		it("keeps secrets as process.env references", () => {
			const config = {
				caches: {
					"*": {
						provider: "redis",
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
					"*": {
						provider: "redis",
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
					"*": {
						provider: "redis",
						url: "REDIS_URL",
					},
				},
				buckets: {
					files: {
						provider: "s3",
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

	describe("logging sinks", () => {
		it("includes logging config in output", () => {
			const config = {
				logging: {
					level: "info",
					sinks: [{provider: "console"}],
				},
			};

			const module = generateConfigModule(config);

			expect(module).toContain("logging:");
			expect(module).toContain('"level": "info"');
			expect(module).toContain('"provider": "console"');
		});

		it("keeps sink secrets as process.env references", () => {
			const config = {
				logging: {
					level: "info",
					sinks: [
						{provider: "console"},
						{
							provider: "sentry",
							dsn: "SENTRY_DSN",
						},
						{
							provider: "otel",
							endpoint: "OTEL_ENDPOINT",
							apiKey: "OTEL_API_KEY",
						},
					],
				},
			};

			const module = generateConfigModule(config, {
				SENTRY_DSN: "https://abc123@sentry.io/123",
				OTEL_ENDPOINT: "https://otel.example.com",
				OTEL_API_KEY: "secret-api-key-12345",
			});

			// Secrets should NOT be baked in
			expect(module).not.toContain("abc123@sentry.io");
			expect(module).not.toContain("otel.example.com");
			expect(module).not.toContain("secret-api-key-12345");

			// Should be process.env references
			expect(module).toContain("process.env.SENTRY_DSN");
			expect(module).toContain("process.env.OTEL_ENDPOINT");
			expect(module).toContain("process.env.OTEL_API_KEY");
		});

		it("handles file sink with path", () => {
			const config = {
				logging: {
					level: "debug",
					sinks: [
						{
							provider: "file",
							path: "./logs/app.log",
						},
						{
							provider: "rotating",
							path: "LOG_PATH || ./logs/rotating.log",
							maxSize: 10485760,
						},
					],
				},
			};

			const module = generateConfigModule(config);

			expect(module).toContain('"provider": "file"');
			expect(module).toContain('"provider": "rotating"');
			expect(module).toContain('"./logs/app.log"');
			expect(module).toContain("process.env.LOG_PATH");
		});

		it("handles category-specific logging", () => {
			const config = {
				logging: {
					level: "info",
					sinks: [{provider: "console"}],
					categories: {
						server: {level: "debug"},
						database: {
							level: "warning",
							sinks: [{provider: "file", path: "./logs/db.log"}],
						},
					},
				},
			};

			const module = generateConfigModule(config);

			expect(module).toContain("categories");
			expect(module).toContain('"server"');
			expect(module).toContain('"database"');
			expect(module).toContain('"level": "debug"');
			expect(module).toContain('"level": "warning"');
		});
	});
});

describe("BUILTIN_CACHE_PROVIDERS", () => {
	it("has memory provider", () => {
		expect(BUILTIN_CACHE_PROVIDERS.memory).toBe("@b9g/cache/memory.js");
	});

	it("has redis provider", () => {
		expect(BUILTIN_CACHE_PROVIDERS.redis).toBe("@b9g/cache-redis");
	});
});

describe("BUILTIN_BUCKET_PROVIDERS", () => {
	it("has node provider", () => {
		expect(BUILTIN_BUCKET_PROVIDERS.node).toBe("@b9g/filesystem/node.js");
	});

	it("has memory provider", () => {
		expect(BUILTIN_BUCKET_PROVIDERS.memory).toBe("@b9g/filesystem/memory.js");
	});

	it("has s3 provider", () => {
		expect(BUILTIN_BUCKET_PROVIDERS.s3).toBe("@b9g/filesystem-s3");
	});
});
