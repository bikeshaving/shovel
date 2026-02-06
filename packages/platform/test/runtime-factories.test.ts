import {test, expect, describe, afterEach} from "bun:test";
import {
	createCacheFactory,
	createDirectoryFactory,
	configureLogging,
	CustomLoggerStorage,
	CustomDatabaseStorage,
} from "../src/runtime.js";
import {Database} from "@b9g/zen";
import BunDriver from "@b9g/zen/bun";
import {MemoryCache} from "@b9g/cache/memory";
import {MemoryDirectory} from "@b9g/filesystem/memory";
import {NodeFSDirectory} from "@b9g/filesystem/node-fs";
import {
	getLogger,
	getConsoleSink,
	reset as resetLogtape,
} from "@logtape/logtape";
import {tmpdir} from "os";
import {join} from "path";
import {mkdtempSync, rmSync} from "fs";

describe("createCacheFactory", () => {
	test("creates cache from config with impl", async () => {
		const factory = createCacheFactory({
			configs: {
				"test-cache": {impl: MemoryCache as any},
			},
		});
		const cache = await factory("test-cache");

		expect(cache).toBeDefined();
		expect(cache.constructor.name).toBe("MemoryCache");
	});

	test("throws error when cache not configured", async () => {
		const factory = createCacheFactory({configs: {}});
		await expect(factory("test-cache")).rejects.toThrow(
			'Cache "test-cache" is not configured',
		);
	});

	test("throws error when impl is missing", async () => {
		const factory = createCacheFactory({
			configs: {
				"test-cache": {} as any, // No impl
			},
		});
		await expect(factory("test-cache")).rejects.toThrow(
			'Cache "test-cache" has no impl',
		);
	});

	test("passes options to cache constructor", async () => {
		const factory = createCacheFactory({
			configs: {
				"test-cache": {
					impl: MemoryCache as any,
					maxEntries: 100,
					TTL: 3600,
				},
			},
		});

		const cache = await factory("test-cache");
		expect(cache).toBeDefined();
	});

	test("returns PostMessageCache when usePostMessage is true", async () => {
		const factory = createCacheFactory({
			configs: {
				"test-cache": {impl: MemoryCache as any},
			},
			usePostMessage: true,
		});

		const cache = await factory("test-cache");
		expect(cache).toBeDefined();
		expect(cache.constructor.name).toBe("PostMessageCache");
	});

	// ---- Pattern matching with wildcard configs ----

	test("'*' wildcard matches any cache name", async () => {
		const factory = createCacheFactory({
			configs: {
				"*": {impl: MemoryCache as any},
			},
		});

		const kv = await factory("kv");
		const sessions = await factory("sessions");
		const anything = await factory("literally-anything");

		expect(kv.constructor.name).toBe("MemoryCache");
		expect(sessions.constructor.name).toBe("MemoryCache");
		expect(anything.constructor.name).toBe("MemoryCache");
	});

	test("exact match takes priority over wildcard", async () => {
		let lastConstructedName = "";
		class TrackingCache extends MemoryCache {
			constructor(name: string, options: any = {}) {
				super(name, options);
				lastConstructedName = name;
			}
		}

		const factory = createCacheFactory({
			configs: {
				special: {impl: TrackingCache as any, maxEntries: 50},
				"*": {impl: MemoryCache as any},
			},
		});

		// Exact match should use TrackingCache
		const special = await factory("special");
		expect(special.constructor.name).toBe("TrackingCache");
		expect(lastConstructedName).toBe("special");

		// Non-exact should fall through to wildcard
		const other = await factory("other");
		expect(other.constructor.name).toBe("MemoryCache");
	});

	test("prefix wildcard pattern like 'api-*' matches selectively", async () => {
		const factory = createCacheFactory({
			configs: {
				"api-*": {impl: MemoryCache as any},
			},
		});

		const apiUsers = await factory("api-users");
		expect(apiUsers).toBeDefined();

		const apiProducts = await factory("api-products");
		expect(apiProducts).toBeDefined();

		// Should NOT match non-api names
		await expect(factory("kv")).rejects.toThrow('Cache "kv" is not configured');
	});

	test("suffix wildcard pattern like '*-cache' matches selectively", async () => {
		const factory = createCacheFactory({
			configs: {
				"*-cache": {impl: MemoryCache as any},
			},
		});

		const userCache = await factory("user-cache");
		expect(userCache).toBeDefined();

		await expect(factory("sessions")).rejects.toThrow(
			'Cache "sessions" is not configured',
		);
	});

	test("multiple wildcard patterns with different impls", async () => {
		let constructedWith = "";
		class CacheA extends MemoryCache {
			constructor(name: string, opts: any = {}) {
				super(name, opts);
				constructedWith = "A";
			}
		}
		class CacheB extends MemoryCache {
			constructor(name: string, opts: any = {}) {
				super(name, opts);
				constructedWith = "B";
			}
		}

		const factory = createCacheFactory({
			configs: {
				"hot-*": {impl: CacheA as any},
				"cold-*": {impl: CacheB as any},
			},
		});

		await factory("hot-sessions");
		expect(constructedWith).toBe("A");

		await factory("cold-archive");
		expect(constructedWith).toBe("B");
	});

	test("wildcard with no other config acts as universal default", async () => {
		const factory = createCacheFactory({
			configs: {
				"*": {impl: MemoryCache as any, maxEntries: 1000},
			},
		});

		// Should be able to open any name without prior configuration
		const names = ["default", "kv", "sessions", "api-cache", "x-y-z"];
		for (const name of names) {
			const cache = await factory(name);
			expect(cache).toBeDefined();
		}
	});

	test("factory function (non-class) impl works with wildcard", async () => {
		function createCache(name: string, _options: any = {}) {
			return new MemoryCache(name);
		}
		// factory function has no prototype
		Object.defineProperty(createCache, "prototype", {value: undefined});

		const factory = createCacheFactory({
			configs: {
				"*": {impl: createCache as any},
			},
		});

		const cache = await factory("dynamic");
		expect(cache).toBeDefined();
	});
});

describe("createDirectoryFactory", () => {
	let tempDir: string;

	test("creates directory from config with impl", async () => {
		const factory = createDirectoryFactory({
			uploads: {impl: MemoryDirectory as any},
		});

		const dir = await factory("uploads");
		expect(dir).toBeDefined();
		// Class may be renamed by bundler/minifier
		expect(dir.constructor.name).toContain("MemoryDirectory");
	});

	test("creates NodeFSDirectory when specified", async () => {
		const factory = createDirectoryFactory({
			data: {impl: NodeFSDirectory as any},
		});

		const dir = await factory("data");
		expect(dir).toBeDefined();
		expect(dir.constructor.name).toBe("NodeFSDirectory");
	});

	test("throws error for unconfigured directories", async () => {
		const factory = createDirectoryFactory({});

		await expect(factory("unknown-dir")).rejects.toThrow(
			'Directory "unknown-dir" is not configured',
		);
	});

	test("throws error when impl is missing", async () => {
		const factory = createDirectoryFactory({
			data: {} as any, // No impl
		});

		await expect(factory("data")).rejects.toThrow(
			'Directory "data" has no impl',
		);
	});

	test("uses custom path from config", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "dir-factory-test-"));
		const customPath = join(tempDir, "custom-data");
		try {
			const factory = createDirectoryFactory({
				data: {
					impl: NodeFSDirectory as any,
					path: customPath,
				},
			});

			const dir = await factory("data");
			expect(dir).toBeDefined();
		} finally {
			rmSync(tempDir, {recursive: true, force: true});
		}
	});

	test("passes name and options to impl constructor", async () => {
		let capturedName: string | undefined;
		let capturedOptions: any;

		class TestDirectory {
			constructor(name: string, options: any) {
				capturedName = name;
				capturedOptions = options;
			}
		}

		const factory = createDirectoryFactory({
			uploads: {
				impl: TestDirectory as any,
				path: "/tmp/test",
				customOption: "value",
			},
		});

		await factory("uploads");
		expect(capturedName).toBe("uploads");
		expect(capturedOptions.path).toBe("/tmp/test");
		expect(capturedOptions.customOption).toBe("value");
	});

	test("passes pre-resolved path to impl", async () => {
		// Paths are now resolved at build time, so the factory just passes them through
		let capturedOptions: any;

		class TestDirectory {
			constructor(_name: string, options: any) {
				capturedOptions = options;
			}
		}

		// Simulate pre-resolved tmpdir path (as would be generated at build time)
		const resolvedTmpPath = tmpdir();
		const factory = createDirectoryFactory({
			tmp: {
				impl: TestDirectory as any,
				path: resolvedTmpPath,
			},
		});

		await factory("tmp");
		expect(capturedOptions.path).toBe(resolvedTmpPath);
	});

	// ---- Pattern matching with wildcard configs ----

	test("'*' wildcard matches any directory name", async () => {
		const factory = createDirectoryFactory({
			"*": {impl: MemoryDirectory as any},
		});

		const uploads = await factory("uploads");
		const media = await factory("media");
		const anything = await factory("whatever");

		expect(uploads).toBeDefined();
		expect(media).toBeDefined();
		expect(anything).toBeDefined();
	});

	test("exact directory match takes priority over wildcard", async () => {
		let capturedPath: string | undefined;

		class TrackingDirectory {
			constructor(_name: string, options: any) {
				capturedPath = options.path;
			}
		}

		const factory = createDirectoryFactory({
			public: {impl: NodeFSDirectory as any, path: "/srv/public"},
			"*": {impl: TrackingDirectory as any, path: "/srv/fallback"},
		});

		// Exact match
		const pub = await factory("public");
		expect(pub.constructor.name).toBe("NodeFSDirectory");

		// Wildcard fallback
		await factory("other");
		expect(capturedPath).toBe("/srv/fallback");
	});

	test("prefix wildcard like 'user-*' matches directory names", async () => {
		const factory = createDirectoryFactory({
			"user-*": {impl: MemoryDirectory as any},
		});

		const userUploads = await factory("user-uploads");
		expect(userUploads).toBeDefined();

		await expect(factory("system-logs")).rejects.toThrow(
			'Directory "system-logs" is not configured',
		);
	});

	test("multiple directory patterns coexist", async () => {
		let lastImpl = "";

		class DirA {
			constructor() {
				lastImpl = "A";
			}
		}
		class DirB {
			constructor() {
				lastImpl = "B";
			}
		}

		const factory = createDirectoryFactory({
			"cache-*": {impl: DirA as any},
			"data-*": {impl: DirB as any},
		});

		await factory("cache-html");
		expect(lastImpl).toBe("A");

		await factory("data-exports");
		expect(lastImpl).toBe("B");

		await expect(factory("logs")).rejects.toThrow(
			'Directory "logs" is not configured',
		);
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

	test("handles named custom sinks with impl", async () => {
		await configureLogging({
			sinks: {
				myConsole: {
					impl: getConsoleSink,
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
		await configureLogging({
			loggers: [{category: [], level: "debug", sinks: ["console"]}],
		});

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

	test("supports parentSinks override with impl", async () => {
		await configureLogging({
			sinks: {
				customSink: {
					impl: getConsoleSink,
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

	test("uses impl function when provided (build-time optimization)", async () => {
		// The `impl` option is an internal mechanism for bundled builds.
		// The CLI generates code that statically imports sink factories,
		// since dynamic import() can't resolve arbitrary paths in bundles.
		await configureLogging({
			sinks: {
				buildTimeSink: {
					impl: getConsoleSink,
				},
			},
			loggers: [{category: ["build"], sinks: ["buildTimeSink"]}],
		});

		const logger = getLogger(["build"]);
		expect(logger).toBeDefined();
	});

	test("throws error when sink has no impl", async () => {
		await expect(
			configureLogging({
				sinks: {
					badSink: {} as any, // No impl
				},
				loggers: [{category: ["test"], sinks: ["badSink"]}],
			}),
		).rejects.toThrow("Sink has no impl");
	});
});

describe("CustomLoggerStorage", () => {
	afterEach(async () => {
		await resetLogtape();
	});

	test("creates logger storage with factory function", async () => {
		// Configure logtape first
		await configureLogging({});

		const loggerStorage = new CustomLoggerStorage((categories) =>
			getLogger(categories),
		);

		expect(loggerStorage).toBeDefined();
	});

	test("get returns logger for given categories", async () => {
		await configureLogging({});

		const loggerStorage = new CustomLoggerStorage((categories) =>
			getLogger(categories),
		);

		const logger = loggerStorage.get(["app", "database"]);
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
		const loggers = new CustomLoggerStorage((cats) => getLogger(cats));

		// Simulate how user code would use self.loggers (sync)
		const dbLogger = loggers.get(["database"]);
		expect(dbLogger).toBeDefined();

		const appLogger = loggers.get(["app", "http"]);
		expect(appLogger).toBeDefined();
	});
});

describe("CustomDatabaseStorage", () => {
	// Helper to create a factory using real in-memory databases (BunDriver imported at top)
	const createFactory = (names: string[] = ["main"]) => {
		let factoryCalls = 0;
		const drivers: any[] = [];

		const factory = async (name: string) => {
			if (!names.includes(name)) {
				throw new Error(`Database "${name}" is not configured.`);
			}
			factoryCalls++;
			const driver = new BunDriver(":memory:");
			drivers.push(driver);
			return {
				db: new Database(driver),
				close: () => driver.close(),
			};
		};

		return {factory, getFactoryCalls: () => factoryCalls, drivers};
	};

	test("constructor accepts factory function", () => {
		const {factory} = createFactory();
		const storage = new CustomDatabaseStorage(factory);
		expect(storage).toBeDefined();
	});

	test("open() creates and opens Database", async () => {
		const {factory, getFactoryCalls} = createFactory();
		const storage = new CustomDatabaseStorage(factory);

		const db = await storage.open("main", 1);
		expect(db).toBeDefined();
		expect(getFactoryCalls()).toBe(1);

		await storage.closeAll();
	});

	test("get() returns opened database (sync)", async () => {
		const {factory} = createFactory();
		const storage = new CustomDatabaseStorage(factory);

		const db1 = await storage.open("main", 1);
		const db2 = storage.get("main"); // sync!
		expect(db2).toBe(db1);

		await storage.closeAll();
	});

	test("get() throws if database not opened", () => {
		const {factory} = createFactory();
		const storage = new CustomDatabaseStorage(factory);

		expect(() => storage.get("main")).toThrow(
			'Database "main" has not been opened',
		);
	});

	test("open() throws for unconfigured database", async () => {
		const {factory} = createFactory(["main"]);
		const storage = new CustomDatabaseStorage(factory);

		await expect(storage.open("unknown", 1)).rejects.toThrow(
			'Database "unknown" is not configured',
		);
	});

	test("close() removes database from cache", async () => {
		const {factory} = createFactory();
		const storage = new CustomDatabaseStorage(factory);

		await storage.open("main", 1);
		await storage.close("main");

		// get() should throw after close
		expect(() => storage.get("main")).toThrow();
	});

	test("closeAll() closes all opened databases", async () => {
		const {factory} = createFactory(["main", "secondary"]);
		const storage = new CustomDatabaseStorage(factory);

		await storage.open("main", 1);
		await storage.open("secondary", 1);

		await storage.closeAll();

		// Both should be closed - get() should throw
		expect(() => storage.get("main")).toThrow();
		expect(() => storage.get("secondary")).toThrow();
	});

	test("open() returns cached instance on subsequent calls", async () => {
		const {factory, getFactoryCalls} = createFactory();
		const storage = new CustomDatabaseStorage(factory);

		const db1 = await storage.open("main", 1);
		const db2 = await storage.open("main", 1);
		const db3 = await storage.open("main", 1);

		expect(db1).toBe(db2);
		expect(db2).toBe(db3);
		expect(getFactoryCalls()).toBe(1);

		await storage.closeAll();
	});

	test("open() returns same instance on concurrent calls", async () => {
		const {factory, getFactoryCalls} = createFactory();
		const storage = new CustomDatabaseStorage(factory);

		// Fire off multiple open calls simultaneously
		const promise1 = storage.open("main", 1);
		const promise2 = storage.open("main", 1);
		const promise3 = storage.open("main", 1);

		const [db1, db2, db3] = await Promise.all([promise1, promise2, promise3]);

		expect(db1).toBe(db2);
		expect(db2).toBe(db3);
		expect(getFactoryCalls()).toBe(1);

		await storage.closeAll();
	});

	test("open() allows retry after failure", async () => {
		let callCount = 0;
		const failingFactory = async (_name: string) => {
			callCount++;
			if (callCount === 1) {
				throw new Error("First call fails");
			}
			const driver = new BunDriver(":memory:");
			return {
				db: new Database(driver),
				close: async () => driver.close(),
			};
		};

		const storage = new CustomDatabaseStorage(failingFactory);

		await expect(storage.open("main", 1)).rejects.toThrow("First call fails");

		// Retry should work
		const db = await storage.open("main", 1);
		expect(db).toBeDefined();
		expect(callCount).toBe(2);

		await storage.closeAll();
	});

	test("open() closes driver when db.open fails", async () => {
		let closeCalls = 0;
		let callCount = 0;

		const factory = async () => {
			callCount++;
			if (callCount === 1) {
				return {
					db: {
						open: async () => {
							throw new Error("open failed");
						},
					} as unknown as Database,
					close: async () => {
						closeCalls++;
					},
				};
			}
			const driver = new BunDriver(":memory:");
			return {
				db: new Database(driver),
				close: async () => {
					closeCalls++;
					await driver.close();
				},
			};
		};

		const storage = new CustomDatabaseStorage(factory);

		await expect(storage.open("main", 1)).rejects.toThrow("open failed");
		expect(closeCalls).toBe(1);

		const db = await storage.open("main", 1);
		expect(db).toBeDefined();

		await storage.closeAll();
	});

	test("closeAll() waits for pending opens", async () => {
		let resolveCreation: () => void;
		const creationPromise = new Promise<void>((resolve) => {
			resolveCreation = resolve;
		});

		let closed = false;
		const slowFactory = async (_name: string) => {
			await creationPromise;
			const driver = new BunDriver(":memory:");
			return {
				db: new Database(driver),
				close: async () => {
					driver.close();
					closed = true;
				},
			};
		};

		const storage = new CustomDatabaseStorage(slowFactory);

		// Start open but don't await
		const openPromise = storage.open("main", 1);

		// Call closeAll while open is pending
		const closePromise = storage.closeAll();

		// Resolve the creation
		resolveCreation!();

		// Wait for both
		await openPromise;
		await closePromise;

		expect(closed).toBe(true);
	});
});
