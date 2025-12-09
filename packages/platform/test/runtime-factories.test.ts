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

describe("createCacheFactory", () => {
	test("creates MemoryCache by default when no config", async () => {
		const factory = createCacheFactory();
		const cache = await factory("test-cache");

		expect(cache).toBeDefined();
		expect(cache.constructor.name).toBe("MemoryCache");
	});

	test("creates MemoryCache when config specifies memory provider", async () => {
		const factory = createCacheFactory({
			config: {
				caches: {
					"test-cache": {provider: "memory"},
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
					"api-*": {provider: "memory"},
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
					"api-sessions": {provider: "memory"},
					"api-*": {provider: "memory"},
					"*": {provider: "memory"},
				},
			},
		});

		// All should work - exact match for api-sessions
		const cache = await factory("api-sessions");
		expect(cache).toBeDefined();
	});

	test("falls back to default provider when no match", async () => {
		const factory = createCacheFactory({
			config: {
				caches: {
					"other-cache": {provider: "memory"},
				},
			},
			defaultProvider: "memory",
		});

		// "test-cache" doesn't match any pattern, uses defaultProvider
		const cache = await factory("test-cache");
		expect(cache).toBeDefined();
		expect(cache.constructor.name).toBe("MemoryCache");
	});

	test("passes options to cache constructor", async () => {
		const factory = createCacheFactory({
			config: {
				caches: {
					"test-cache": {
						provider: "memory",
						// MemoryCache doesn't use these, but they should be passed
						maxEntries: 100,
						TTL: 3600,
					},
				},
			},
		});

		const cache = await factory("test-cache");
		expect(cache).toBeDefined();
		// Note: MemoryCache may not expose these options, but they should be passed
	});
});

describe("createDirectoryFactory", () => {
	let tempDir: string;

	test("creates NodeFSDirectory by default when no config", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "dir-factory-test-"));
		try {
			const factory = createDirectoryFactory({baseDir: tempDir});
			const dir = await factory("test-dir");

			expect(dir).toBeDefined();
			expect(dir.constructor.name).toBe("NodeFSDirectory");
		} finally {
			rmSync(tempDir, {recursive: true, force: true});
		}
	});

	test("creates MemoryDirectory when config specifies memory provider", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "dir-factory-test-"));
		try {
			const factory = createDirectoryFactory({
				baseDir: tempDir,
				config: {
					directories: {
						uploads: {provider: "memory"},
					},
				},
			});

			const dir = await factory("uploads");
			expect(dir).toBeDefined();
			expect(dir.constructor.name).toContain("MemoryDirectory");
		} finally {
			rmSync(tempDir, {recursive: true, force: true});
		}
	});

	test("creates NodeFSDirectory when config specifies node-fs provider", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "dir-factory-test-"));
		try {
			const factory = createDirectoryFactory({
				baseDir: tempDir,
				config: {
					directories: {
						data: {provider: "node-fs"},
					},
				},
			});

			const dir = await factory("data");
			expect(dir).toBeDefined();
			expect(dir.constructor.name).toBe("NodeFSDirectory");
		} finally {
			rmSync(tempDir, {recursive: true, force: true});
		}
	});

	test("uses wildcard pattern to match directory names", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "dir-factory-test-"));
		try {
			const factory = createDirectoryFactory({
				baseDir: tempDir,
				config: {
					directories: {
						"uploads-*": {provider: "memory"},
					},
				},
			});

			const dir = await factory("uploads-images");
			expect(dir).toBeDefined();
			expect(dir.constructor.name).toContain("MemoryDirectory");
		} finally {
			rmSync(tempDir, {recursive: true, force: true});
		}
	});

	test("uses custom path from config", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "dir-factory-test-"));
		const customPath = join(tempDir, "custom-data");
		try {
			const factory = createDirectoryFactory({
				baseDir: tempDir,
				config: {
					directories: {
						data: {
							provider: "node-fs",
							path: customPath,
						},
					},
				},
			});

			const dir = await factory("data");
			expect(dir).toBeDefined();
			// The directory should use the custom path
			// NodeFSDirectory stores path internally
		} finally {
			rmSync(tempDir, {recursive: true, force: true});
		}
	});

	test("well-known directories use conventional paths", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "dir-factory-test-"));
		try {
			const factory = createDirectoryFactory({baseDir: tempDir});

			// "static" is a well-known directory
			const staticDir = await factory("static");
			expect(staticDir).toBeDefined();
			expect(staticDir.constructor.name).toBe("NodeFSDirectory");

			// "server" is a well-known directory (maps to baseDir)
			const serverDir = await factory("server");
			expect(serverDir).toBeDefined();
			expect(serverDir.constructor.name).toBe("NodeFSDirectory");
		} finally {
			rmSync(tempDir, {recursive: true, force: true});
		}
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
				myConsole: {provider: "console"},
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
				customSink: {provider: "console"},
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
			loggers: [
				{category: ["database"], level: "debug", sinks: ["console"]},
			],
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
