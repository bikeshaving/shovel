import {test, expect, describe} from "bun:test";
import {
	ShovelConfigSchema,
	CacheConfigSchema,
	DirectoryConfigSchema,
	DatabaseConfigSchema,
	LoggerConfigSchema,
	SinkConfigSchema,
} from "./config.js";

describe("config validation", () => {
	describe("ShovelConfigSchema", () => {
		test("accepts empty config", () => {
			const result = ShovelConfigSchema.parse({});
			expect(result).toEqual({});
		});

		test("accepts valid minimal config", () => {
			const result = ShovelConfigSchema.parse({
				port: 3000,
				host: "localhost",
			});
			expect(result.port).toBe(3000);
			expect(result.host).toBe("localhost");
		});

		test("accepts port as string (config expression)", () => {
			const result = ShovelConfigSchema.parse({
				port: "PORT || 3000",
			});
			expect(result.port).toBe("PORT || 3000");
		});

		test("rejects unknown top-level keys", () => {
			expect(() =>
				ShovelConfigSchema.parse({
					unknownKey: "value",
				}),
			).toThrow(/Unrecognized key/);
		});

		test("accepts full valid config", () => {
			const config = {
				platform: "bun",
				port: 8080,
				host: "0.0.0.0",
				workers: 4,
				logging: {
					loggers: [{category: "app", level: "debug"}],
				},
				caches: {
					sessions: {module: "@b9g/cache-redis", url: "redis://localhost"},
				},
				directories: {
					uploads: {module: "@b9g/filesystem/node-fs.js", path: "./uploads"},
				},
				databases: {
					main: {
						dialect: "postgresql",
						url: "postgres://localhost/db",
						schema: "./schema.ts",
					},
				},
			};

			const result = ShovelConfigSchema.parse(config);
			expect(result.platform).toBe("bun");
			expect(result.databases?.main.dialect).toBe("postgresql");
		});
	});

	describe("CacheConfigSchema", () => {
		test("accepts empty cache config", () => {
			const result = CacheConfigSchema.parse({});
			expect(result).toEqual({});
		});

		test("accepts cache with module/export", () => {
			const result = CacheConfigSchema.parse({
				module: "@b9g/cache-redis",
				export: "RedisCache",
				url: "redis://localhost:6379",
			});
			expect(result.module).toBe("@b9g/cache-redis");
		});

		test("rejects unknown keys", () => {
			expect(() =>
				CacheConfigSchema.parse({
					provider: "redis", // old key
				}),
			).toThrow(/Unrecognized key/);
		});
	});

	describe("DirectoryConfigSchema", () => {
		test("accepts directory with module/export/path", () => {
			const result = DirectoryConfigSchema.parse({
				module: "@b9g/filesystem/node-fs.js",
				export: "NodeFSDirectory",
				path: "./data/uploads",
			});
			expect(result.path).toBe("./data/uploads");
		});

		test("accepts path as number (config expression)", () => {
			const result = DirectoryConfigSchema.parse({
				path: "UPLOAD_PATH || ./uploads",
			});
			expect(result.path).toBe("UPLOAD_PATH || ./uploads");
		});

		test("rejects unknown keys", () => {
			expect(() =>
				DirectoryConfigSchema.parse({
					provider: "node-fs", // old key
				}),
			).toThrow(/Unrecognized key/);
		});
	});

	describe("DatabaseConfigSchema", () => {
		test("requires dialect, url, schema", () => {
			expect(() => DatabaseConfigSchema.parse({})).toThrow();
			expect(() =>
				DatabaseConfigSchema.parse({dialect: "postgresql"}),
			).toThrow();
		});

		test("accepts valid database config", () => {
			const result = DatabaseConfigSchema.parse({
				dialect: "postgresql",
				url: "postgres://localhost/db",
				schema: "./schema.ts",
			});
			expect(result.dialect).toBe("postgresql");
		});

		test("accepts driver with module/export", () => {
			const result = DatabaseConfigSchema.parse({
				dialect: "bun-sqlite",
				driver: {module: "bun:sqlite", export: "Database"},
				url: "./data.db",
				schema: "./schema.ts",
			});
			expect(result.driver?.module).toBe("bun:sqlite");
		});

		test("rejects invalid dialect", () => {
			expect(() =>
				DatabaseConfigSchema.parse({
					dialect: "invalid-db",
					url: "...",
					schema: "./schema.ts",
				}),
			).toThrow(/Invalid option/);
		});

		test("allows extra driver-specific options (passthrough)", () => {
			const result = DatabaseConfigSchema.parse({
				dialect: "postgresql",
				url: "postgres://localhost/db",
				schema: "./schema.ts",
				poolSize: 10,
				ssl: true,
			});
			expect((result as any).poolSize).toBe(10);
			expect((result as any).ssl).toBe(true);
		});
	});

	describe("LoggerConfigSchema", () => {
		test("accepts category as string", () => {
			const result = LoggerConfigSchema.parse({
				category: "app",
				level: "debug",
			});
			expect(result.category).toBe("app");
		});

		test("accepts category as array", () => {
			const result = LoggerConfigSchema.parse({
				category: ["app", "db"],
				level: "info",
			});
			expect(result.category).toEqual(["app", "db"]);
		});

		test("rejects invalid level", () => {
			expect(() =>
				LoggerConfigSchema.parse({
					category: "app",
					level: "invalid",
				}),
			).toThrow();
		});

		test("accepts parentSinks override", () => {
			const result = LoggerConfigSchema.parse({
				category: "app",
				sinks: ["file"],
				parentSinks: "override",
			});
			expect(result.parentSinks).toBe("override");
		});
	});

	describe("SinkConfigSchema", () => {
		test("requires module", () => {
			expect(() => SinkConfigSchema.parse({})).toThrow();
		});

		test("accepts sink with module/export", () => {
			const result = SinkConfigSchema.parse({
				module: "@logtape/file",
				export: "getFileSink",
				path: "./logs/app.log",
			});
			expect(result.module).toBe("@logtape/file");
		});

		test("allows extra sink-specific options (passthrough)", () => {
			const result = SinkConfigSchema.parse({
				module: "@logtape/file",
				export: "getRotatingFileSink",
				path: "./logs/app.log",
				maxSize: 10485760,
				maxFiles: 5,
			});
			expect((result as any).maxSize).toBe(10485760);
		});
	});
});
