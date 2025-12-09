import {test, expect, describe, afterEach} from "bun:test";
import {
	createCacheFactory,
	createDirectoryFactory,
	configureLogging,
	CustomLoggerStorage,
} from "../src/runtime.js";
import {getLogger, reset as resetLogtape} from "@logtape/logtape";
import {tmpdir} from "os";
import {join} from "path";
import {mkdtempSync, rmSync} from "fs";

// Default cache for tests (same as platform-bun/platform-node)
const TEST_CACHE_DEFAULT = {
	module: "@b9g/cache/memory",
	export: "MemoryCache",
};

describe("createCacheFactory", () => {
	test("creates cache from default when no config", async () => {
		const factory = createCacheFactory({default: TEST_CACHE_DEFAULT});
		const cache = await factory("test-cache");

		expect(cache).toBeDefined();
		expect(cache.constructor.name).toBe("MemoryCache");
	});

	test("throws error when no config and no default provided", async () => {
		const factory = createCacheFactory();
		await expect(factory("test-cache")).rejects.toThrow(
			'No cache configured for "test-cache" and no platform default provided.',
		);
	});

	test("creates MemoryCache when config specifies memory module", async () => {
		const factory = createCacheFactory({
			config: {
				caches: {
					"test-cache": {
						module: "@b9g/cache/memory",
						export: "MemoryCache",
					},
				},
			},
		});
		const cache = await factory("test-cache");

		expect(cache).toBeDefined();
		expect(cache.constructor.name).toBe("MemoryCache");
	});

	test("uses wildcard pattern to match cache names", async () => {
		const factory = createCacheFactory({
			config: {
				caches: {
					"api-*": {
						module: "@b9g/cache/memory",
						export: "MemoryCache",
					},
				},
			},
		});

		const cache = await factory("api-sessions");
		expect(cache).toBeDefined();
		expect(cache.constructor.name).toBe("MemoryCache");
	});

	test("exact match takes precedence over wildcard", async () => {
		const factory = createCacheFactory({
			config: {
				caches: {
					"api-sessions": {
						module: "@b9g/cache/memory",
						export: "MemoryCache",
					},
					"api-*": {
						module: "@b9g/cache/memory",
						export: "MemoryCache",
					},
					"*": {
						module: "@b9g/cache/memory",
						export: "MemoryCache",
					},
				},
			},
		});

		// All should work - exact match for api-sessions
		const cache = await factory("api-sessions");
		expect(cache).toBeDefined();
	});

	test("falls back to default when no match", async () => {
		const factory = createCacheFactory({
			default: TEST_CACHE_DEFAULT,
			config: {
				caches: {
					"other-cache": {
						module: "@b9g/cache/memory",
						export: "MemoryCache",
					},
				},
			},
		});

		// "test-cache" doesn't match any pattern, uses default
		const cache = await factory("test-cache");
		expect(cache).toBeDefined();
		expect(cache.constructor.name).toBe("MemoryCache");
	});

	test("passes options to cache constructor", async () => {
		const factory = createCacheFactory({
			config: {
				caches: {
					"test-cache": {
						module: "@b9g/cache/memory",
						export: "MemoryCache",
						// MemoryCache doesn't use these, but they should be passed
						maxEntries: 100,
						TTL: 3600,
					},
				},
			},
		});

		const cache = await factory("test-cache");
		expect(cache).toBeDefined();
	});

	test("uses named export when specified", async () => {
		const factory = createCacheFactory({
			config: {
				caches: {
					"test-cache": {
						module: "@b9g/cache/memory",
						export: "MemoryCache",
					},
				},
			},
		});

		const cache = await factory("test-cache");
		expect(cache).toBeDefined();
		expect(cache.constructor.name).toBe("MemoryCache");
	});

	test("throws error for invalid module", async () => {
		const factory = createCacheFactory({
			config: {
				caches: {
					"bad-cache": {module: "./nonexistent-cache-module.js"},
				},
			},
		});

		await expect(factory("bad-cache")).rejects.toThrow();
	});

	test("throws error for invalid export", async () => {
		const factory = createCacheFactory({
			config: {
				caches: {
					"bad-cache": {
						module: "@b9g/cache/memory",
						export: "NonExistentExport",
					},
				},
			},
		});

		await expect(factory("bad-cache")).rejects.toThrow();
	});
});

describe("createDirectoryFactory", () => {
	let tempDir: string;

	const nodeDefaults = {
		server: {
			module: "@b9g/filesystem/node-fs",
			export: "NodeFSDirectory",
			path: "dist/server",
		},
		public: {
			module: "@b9g/filesystem/node-fs",
			export: "NodeFSDirectory",
			path: "dist/public",
		},
		tmp: {
			module: "@b9g/filesystem/node-fs",
			export: "NodeFSDirectory",
			path: tmpdir, // function reference, called lazily
		},
	};

	test("creates NodeFSDirectory for directories in defaults", async () => {
		const factory = createDirectoryFactory({defaults: nodeDefaults});
		const dir = await factory("server");

		expect(dir).toBeDefined();
		expect(dir.constructor.name).toBe("NodeFSDirectory");
	});

	test("throws error for unconfigured directories without defaults", async () => {
		const factory = createDirectoryFactory();

		await expect(factory("unknown-dir")).rejects.toThrow(
			'No directory configured for "unknown-dir"',
		);
	});

	test("throws error for directories not in defaults", async () => {
		const factory = createDirectoryFactory({defaults: nodeDefaults});

		await expect(factory("unknown-dir")).rejects.toThrow(
			'No directory configured for "unknown-dir"',
		);
	});

	test("creates MemoryDirectory when config specifies memory module", async () => {
		const factory = createDirectoryFactory({
			config: {
				directories: {
					uploads: {
						module: "@b9g/filesystem/memory",
						export: "MemoryDirectory",
					},
				},
			},
		});

		const dir = await factory("uploads");
		expect(dir).toBeDefined();
		expect(dir.constructor.name).toContain("MemoryDirectory");
	});

	test("creates NodeFSDirectory when config specifies node-fs module", async () => {
		const factory = createDirectoryFactory({
			config: {
				directories: {
					data: {
						module: "@b9g/filesystem/node-fs",
						export: "NodeFSDirectory",
					},
				},
			},
		});

		const dir = await factory("data");
		expect(dir).toBeDefined();
		expect(dir.constructor.name).toBe("NodeFSDirectory");
	});

	test("uses wildcard pattern to match directory names", async () => {
		const factory = createDirectoryFactory({
			config: {
				directories: {
					"uploads-*": {
						module: "@b9g/filesystem/memory",
						export: "MemoryDirectory",
					},
				},
			},
		});

		const dir = await factory("uploads-images");
		expect(dir).toBeDefined();
		expect(dir.constructor.name).toContain("MemoryDirectory");
	});

	test("uses custom path from config", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "dir-factory-test-"));
		const customPath = join(tempDir, "custom-data");
		try {
			const factory = createDirectoryFactory({
				config: {
					directories: {
						data: {
							module: "@b9g/filesystem/node-fs",
							export: "NodeFSDirectory",
							path: customPath,
						},
					},
				},
			});

			const dir = await factory("data");
			expect(dir).toBeDefined();
		} finally {
			rmSync(tempDir, {recursive: true, force: true});
		}
	});

	test("defaults support all configured directories including tmp", async () => {
		const factory = createDirectoryFactory({defaults: nodeDefaults});

		// server directory
		const serverDir = await factory("server");
		expect(serverDir).toBeDefined();
		expect(serverDir.constructor.name).toBe("NodeFSDirectory");

		// public directory
		const publicDir = await factory("public");
		expect(publicDir).toBeDefined();
		expect(publicDir.constructor.name).toBe("NodeFSDirectory");

		// tmp directory (path resolved from function)
		const tmpDir = await factory("tmp");
		expect(tmpDir).toBeDefined();
		expect(tmpDir.constructor.name).toBe("NodeFSDirectory");
	});

	test("path function is called lazily for tmp directory", async () => {
		let called = false;
		const factory = createDirectoryFactory({
			defaults: {
				tmp: {
					module: "@b9g/filesystem/node-fs",
					export: "NodeFSDirectory",
					path: () => {
						called = true;
						return tmpdir();
					},
				},
			},
		});

		expect(called).toBe(false);
		await factory("tmp");
		expect(called).toBe(true);
	});

	test("throws error for invalid module", async () => {
		const factory = createDirectoryFactory({
			config: {
				directories: {
					"bad-dir": {module: "./nonexistent-directory-module.js"},
				},
			},
		});

		await expect(factory("bad-dir")).rejects.toThrow();
	});

	test("throws error for invalid export", async () => {
		const factory = createDirectoryFactory({
			config: {
				directories: {
					"bad-dir": {
						module: "@b9g/filesystem/memory",
						export: "NonExistentExport",
					},
				},
			},
		});

		await expect(factory("bad-dir")).rejects.toThrow();
	});
});

describe("configureLogging", () => {
	afterEach(async () => {
		await resetLogtape();
	});

	test("configures with implicit console sink", async () => {
		// Console sink is implicit - no need to specify it
		await configureLogging({});

		// Logger should be available after configuration
		const logger = getLogger(["test"]);
		expect(logger).toBeDefined();
	});

	test("configures custom log level via loggers", async () => {
		await configureLogging({
			loggers: [{category: [], level: "debug", sinks: ["console"]}],
		});

		const logger = getLogger(["test"]);
		expect(logger).toBeDefined();
	});

	test("configures per-category log levels", async () => {
		await configureLogging({
			loggers: [
				{category: ["database"], level: "debug", sinks: ["console"]},
				{category: ["http"], level: "warning", sinks: ["console"]},
			],
		});

		// Category-specific loggers should work
		const dbLogger = getLogger(["database"]);
		const httpLogger = getLogger(["http"]);
		expect(dbLogger).toBeDefined();
		expect(httpLogger).toBeDefined();
	});

	test("handles empty config", async () => {
		// Should not throw when config is empty - uses Shovel defaults
		await configureLogging({});

		const logger = getLogger(["test"]);
		expect(logger).toBeDefined();
	});

	test("handles named custom sinks", async () => {
		await configureLogging({
			sinks: {
				myConsole: {
					module: "@logtape/logtape",
					export: "getConsoleSink",
				},
			},
			loggers: [{category: ["app"], sinks: ["myConsole"]}],
		});

		const logger = getLogger(["app"]);
		expect(logger).toBeDefined();
	});

	test("can be reset and reconfigured", async () => {
		// First configuration
		await configureLogging({
			loggers: [{category: [], level: "info", sinks: ["console"]}],
		});

		// Second configuration should reset and reconfigure
		await configureLogging(
			{
				loggers: [{category: [], level: "debug", sinks: ["console"]}],
			},
			{reset: true},
		);

		const logger = getLogger(["test"]);
		expect(logger).toBeDefined();
	});

	test("provides default Shovel loggers", async () => {
		// Empty config should still set up Shovel default loggers
		await configureLogging({});

		// Shovel internal loggers should be available
		const shovelLogger = getLogger(["shovel"]);
		expect(shovelLogger).toBeDefined();

		// LogTape meta logger should be configured (but suppressed)
		const metaLogger = getLogger(["logtape", "meta"]);
		expect(metaLogger).toBeDefined();
	});

	test("user loggers can override Shovel defaults", async () => {
		await configureLogging({
			loggers: [
				// Override the default ["shovel"] logger
				{category: ["shovel"], level: "debug", sinks: ["console"]},
			],
		});

		const shovelLogger = getLogger(["shovel"]);
		expect(shovelLogger).toBeDefined();
	});

	test("supports parentSinks override", async () => {
		await configureLogging({
			sinks: {
				customSink: {
					module: "@logtape/logtape",
					export: "getConsoleSink",
				},
			},
			loggers: [
				{category: ["app"], sinks: ["console"]},
				// This logger replaces parent sinks instead of inheriting
				{
					category: ["app", "db"],
					sinks: ["customSink"],
					parentSinks: "override",
				},
			],
		});

		const dbLogger = getLogger(["app", "db"]);
		expect(dbLogger).toBeDefined();
	});

	test("supports sink via module and export", async () => {
		await configureLogging({
			sinks: {
				customConsole: {
					module: "@logtape/logtape",
					export: "getConsoleSink",
				},
			},
			loggers: [{category: ["custom"], sinks: ["customConsole"]}],
		});

		const logger = getLogger(["custom"]);
		expect(logger).toBeDefined();
	});

	test("uses factory function when provided (build-time optimization)", async () => {
		// The `factory` option is an internal mechanism for bundled builds.
		// The CLI generates code that statically imports sink factories,
		// since dynamic import() can't resolve arbitrary paths in bundles.
		const {getConsoleSink} = await import("@logtape/logtape");

		await configureLogging({
			sinks: {
				buildTimeSink: {
					module: "ignored-when-factory-present",
					factory: getConsoleSink,
				},
			},
			loggers: [{category: ["build"], sinks: ["buildTimeSink"]}],
		});

		const logger = getLogger(["build"]);
		expect(logger).toBeDefined();
	});

	test("throws error for invalid module", async () => {
		await expect(
			configureLogging({
				sinks: {
					badSink: {module: "./nonexistent-sink-module.js"},
				},
				loggers: [{category: ["test"], sinks: ["badSink"]}],
			}),
		).rejects.toThrow();
	});

	test("throws error for invalid export", async () => {
		await expect(
			configureLogging({
				sinks: {
					badSink: {
						module: "@logtape/logtape",
						export: "nonExistentExport",
					},
				},
				loggers: [{category: ["test"], sinks: ["badSink"]}],
			}),
		).rejects.toThrow();
	});
});

describe("CustomLoggerStorage", () => {
	afterEach(async () => {
		await resetLogtape();
	});

	test("creates logger storage with factory function", async () => {
		// Configure logtape first
		await configureLogging({});

		const loggerStorage = new CustomLoggerStorage((...categories) =>
			getLogger(categories),
		);

		expect(loggerStorage).toBeDefined();
	});

	test("open returns logger for given categories", async () => {
		await configureLogging({});

		const loggerStorage = new CustomLoggerStorage((...categories) =>
			getLogger(categories),
		);

		const logger = await loggerStorage.open("app", "database");
		expect(logger).toBeDefined();
		// Logger should have standard methods
		expect(typeof logger.info).toBe("function");
		expect(typeof logger.debug).toBe("function");
		expect(typeof logger.warn).toBe("function");
		expect(typeof logger.error).toBe("function");
	});

	test("self.loggers pattern works with configured logging", async () => {
		await configureLogging({
			loggers: [{category: ["database"], level: "debug", sinks: ["console"]}],
		});

		// This is how self.loggers is typically set up
		const loggers = new CustomLoggerStorage((...cats) => getLogger(cats));

		// Simulate how user code would use self.loggers
		const dbLogger = await loggers.open("database");
		expect(dbLogger).toBeDefined();

		const appLogger = await loggers.open("app", "http");
		expect(appLogger).toBeDefined();
	});
});
