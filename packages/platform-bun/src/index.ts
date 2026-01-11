/**
 * @b9g/platform-bun - Bun platform adapter for Shovel
 *
 * Provides built-in TypeScript/JSX support and simplified server setup for Bun environments.
 */

import {builtinModules} from "node:module";
import {tmpdir} from "node:os";
import {
	BasePlatform,
	type PlatformConfig,
	type PlatformDefaults,
	type Handler,
	type Server,
	type ServerOptions,
	type ServiceWorkerOptions,
	type ServiceWorkerInstance,
	type EntryWrapperOptions,
	type PlatformESBuildConfig,
	type ProductionEntryPoints,
	ServiceWorkerPool,
	type WorkerPoolOptions,
	SingleThreadedRuntime,
	CustomLoggerStorage,
	CustomDatabaseStorage,
	createDatabaseFactory,
} from "@b9g/platform";
import {
	createCacheFactory,
	createDirectoryFactory,
	type ShovelConfig,
} from "@b9g/platform/runtime";
import {CustomCacheStorage} from "@b9g/cache";
import {MemoryCache} from "@b9g/cache/memory";
import {CustomDirectoryStorage} from "@b9g/filesystem";
import {NodeFSDirectory} from "@b9g/filesystem/node-fs";
import {InternalServerError, isHTTPError, HTTPError} from "@b9g/http-errors";
import {getLogger} from "@logtape/logtape";
import * as Path from "path";

// Entry template embedded as string
const entryTemplate = `// Bun Production Server Entry
import {tmpdir} from "os"; // For [tmpdir] config expressions
import {getLogger} from "@logtape/logtape";
import {configureLogging} from "@b9g/platform/runtime";
import {config} from "shovel:config"; // Virtual module - resolved at build time
import BunPlatform from "@b9g/platform-bun";

// Configure logging before anything else
await configureLogging(config.logging);

const logger = getLogger(["shovel", "platform"]);

// Configuration from shovel:config
const PORT = config.port;
const HOST = config.host;
const WORKERS = config.workers;

// Use explicit marker instead of Bun.isMainThread
// This handles the edge case where Shovel's build output is embedded in another worker
const isShovelWorker = process.env.SHOVEL_SPAWNED_WORKER === "1";

if (isShovelWorker) {
	// Worker thread: runs BOTH server AND ServiceWorker
	const platform = new BunPlatform({port: PORT, host: HOST, workers: 1});
	const userCodePath = new URL("./server.js", import.meta.url).pathname;
	const serviceWorker = await platform.loadServiceWorker(userCodePath);

	Bun.serve({
		port: PORT,
		hostname: HOST,
		// Only need reusePort for multi-worker (multiple listeners on same port)
		reusePort: WORKERS > 1,
		fetch: serviceWorker.handleRequest,
	});

	// Signal ready to main thread
	postMessage({type: "ready", thread: Bun.threadId});
	logger.info("Worker started", {port: PORT, thread: Bun.threadId});
} else {
	// Main thread: supervisor only - ALWAYS spawn workers (even for workers:1)
	// This ensures ServiceWorker code always runs in a worker thread for dev/prod parity

	// Port availability check - fail fast if port is in use
	// Prevents accidental port sharing with other processes
	const checkPort = async () => {
		try {
			const testServer = Bun.serve({port: PORT, hostname: HOST, fetch: () => new Response()});
			testServer.stop();
		} catch (err) {
			logger.error("Port unavailable", {port: PORT, host: HOST, error: err});
			process.exit(1);
		}
	};
	await checkPort();

	let shuttingDown = false;
	const workers = [];
	let readyCount = 0;

	for (let i = 0; i < WORKERS; i++) {
		const worker = new Worker(import.meta.path, {
			env: {...process.env, SHOVEL_SPAWNED_WORKER: "1"},
		});

		worker.onmessage = (event) => {
			if (event.data.type === "ready") {
				readyCount++;
				if (readyCount === WORKERS) {
					logger.info("All workers ready", {count: WORKERS, port: PORT});
				}
			}
		};

		worker.onerror = (error) => {
			logger.error("Worker error", {error: error.message});
		};

		// If a worker crashes, fail fast - let process supervisor handle restarts
		worker.addEventListener("close", () => {
			if (shuttingDown) return;
			logger.error("Worker crashed, exiting");
			process.exit(1);
		});

		workers.push(worker);
	}

	logger.info("Spawned workers", {count: WORKERS, port: PORT});

	// Graceful shutdown
	const shutdown = async () => {
		shuttingDown = true;
		logger.info("Shutting down workers");
		for (const worker of workers) {
			worker.terminate();
		}
		process.exit(0);
	};

	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
}
`;

// Worker entry template - platform defaults are merged at build time into config
// Paths are resolved at build time by the path syntax parser
const workerEntryTemplate = `// Worker Entry for ServiceWorkerPool
// This file sets up the ServiceWorker runtime and message loop
import {tmpdir} from "os"; // For [tmpdir] config expressions
import {config} from "shovel:config";
import {initWorkerRuntime, startWorkerMessageLoop, configureLogging} from "@b9g/platform/runtime";

// Configure logging before anything else
await configureLogging(config.logging);

// Initialize the worker runtime (installs ServiceWorker globals)
// Platform defaults and paths are already resolved at build time
const {registration, databases} = await initWorkerRuntime({config});

// Import user code (registers event handlers via addEventListener)
// Must use dynamic import to ensure globals are installed first
await import("__USER_ENTRY__");

// Run ServiceWorker lifecycle
await registration.install();
await registration.activate();

// Start the message loop (handles request/response messages from main thread)
// Pass databases so they can be closed on graceful shutdown
startWorkerMessageLoop({registration, databases});
`;

const logger = getLogger(["shovel", "platform"]);

// ============================================================================
// TYPES
// ============================================================================

export interface BunPlatformOptions extends PlatformConfig {
	/** Port for development server (default: 3000) */
	port?: number;
	/** Host for development server (default: localhost) */
	host?: string;
	/** Working directory for file resolution */
	cwd?: string;
	/** Number of worker threads (default: 1) */
	workers?: number;
	/** Shovel configuration (caches, directories, etc.) */
	config?: ShovelConfig;
}

// ============================================================================
// IMPLEMENTATION
// ============================================================================

/**
 * Bun platform implementation
 * ServiceWorker entrypoint loader for Bun with native TypeScript/JSX support
 */
export class BunPlatform extends BasePlatform {
	readonly name: string;
	#options: {
		port: number;
		host: string;
		cwd: string;
		workers: number;
		config?: ShovelConfig;
	};
	#workerPool?: ServiceWorkerPool;
	#singleThreadedRuntime?: SingleThreadedRuntime;
	#cacheStorage?: CustomCacheStorage;
	#directoryStorage?: CustomDirectoryStorage;
	#databaseStorage?: CustomDatabaseStorage;

	constructor(options: BunPlatformOptions = {}) {
		super(options);
		this.name = "bun";

		// eslint-disable-next-line no-restricted-properties -- Platform adapter entry point
		const cwd = options.cwd || process.cwd();

		this.#options = {
			port: options.port ?? 3000,
			host: options.host ?? "localhost",
			workers: options.workers ?? 1,
			cwd,
			config: options.config,
		};
	}

	/**
	 * Get options for testing
	 */
	get options() {
		return this.#options;
	}

	/**
	 * Get/set worker pool for testing
	 */
	get workerPool() {
		return this.#workerPool;
	}

	set workerPool(pool: ServiceWorkerPool | undefined) {
		this.#workerPool = pool;
	}

	/**
	 * Create cache storage using config from shovel.json
	 * Merges with runtime defaults (actual class references) for fallback behavior
	 */
	async createCaches(): Promise<CustomCacheStorage> {
		// Runtime defaults with actual class references (not module/export strings)
		const runtimeDefaults: Record<string, {impl: any}> = {
			default: {impl: MemoryCache},
		};
		const userCaches = this.#options.config?.caches ?? {};
		// Deep merge per entry so user can override options without losing impl
		const configs: Record<string, any> = {};
		const allNames = new Set([
			...Object.keys(runtimeDefaults),
			...Object.keys(userCaches),
		]);
		for (const name of allNames) {
			configs[name] = {...runtimeDefaults[name], ...userCaches[name]};
		}
		return new CustomCacheStorage(createCacheFactory({configs}));
	}

	/**
	 * Create directory storage using config from shovel.json
	 * Merges with runtime defaults (actual class references) for fallback behavior
	 */
	async createDirectories(): Promise<CustomDirectoryStorage> {
		// Runtime defaults with actual class references (not module/export strings)
		// Note: These are test-time defaults - production uses build-time resolved paths
		const runtimeDefaults: Record<string, {impl: any; path: string}> = {
			server: {impl: NodeFSDirectory, path: this.#options.cwd},
			public: {impl: NodeFSDirectory, path: this.#options.cwd},
			tmp: {impl: NodeFSDirectory, path: tmpdir()},
		};
		const userDirs = this.#options.config?.directories ?? {};
		// Deep merge per entry so user can override options without losing impl
		const configs: Record<string, any> = {};
		const allNames = new Set([
			...Object.keys(runtimeDefaults),
			...Object.keys(userDirs),
		]);
		for (const name of allNames) {
			configs[name] = {...runtimeDefaults[name], ...userDirs[name]};
		}
		return new CustomDirectoryStorage(createDirectoryFactory(configs));
	}

	/**
	 * Create logger storage using config from shovel.json
	 */
	async createLoggers(): Promise<CustomLoggerStorage> {
		return new CustomLoggerStorage((categories) => getLogger(categories));
	}

	/**
	 * Create database storage from declarative config in shovel.json
	 */
	createDatabases(
		configOverride?: BunPlatformOptions["config"],
	): CustomDatabaseStorage | undefined {
		const config = configOverride ?? this.#options.config;
		if (config?.databases && Object.keys(config.databases).length > 0) {
			const factory = createDatabaseFactory(config.databases);
			return new CustomDatabaseStorage(factory);
		}
		return undefined;
	}

	/**
	 * Create HTTP server using Bun.serve
	 */
	createServer(handler: Handler, options: ServerOptions = {}): Server {
		const requestedPort = options.port ?? this.#options.port;
		const hostname = options.host ?? this.#options.host;
		const reusePort = options.reusePort ?? false;

		// Bun.serve is much simpler than Node.js
		const server = Bun.serve({
			port: requestedPort,
			hostname,
			reusePort,
			async fetch(request) {
				try {
					return await handler(request);
				} catch (error) {
					const err = error instanceof Error ? error : new Error(String(error));
					logger.error("Request error: {error}", {error: err});

					// Convert to HTTPError for consistent response format
					const httpError = isHTTPError(error)
						? (error as HTTPError)
						: new InternalServerError(err.message, {cause: err});

					const isDev = import.meta.env?.MODE !== "production";
					return httpError.toResponse(isDev);
				}
			},
		});

		// Get the actual port (important when port 0 was requested)
		// server.port is always defined after Bun.serve() returns
		const actualPort = server.port as number;

		return {
			async listen() {
				logger.info("Bun server running", {
					url: `http://${hostname}:${actualPort}`,
				});
			},
			async close() {
				server.stop();
			},
			address: () => ({port: actualPort, host: hostname}),
			get url() {
				return `http://${hostname}:${actualPort}`;
			},
			get ready() {
				return true; // Bun.serve starts immediately
			},
		};
	}

	/**
	 * Load and run a ServiceWorker-style entrypoint with Bun
	 * Uses native Web Workers with the common WorkerPool
	 */
	async loadServiceWorker(
		entrypoint: string,
		options: ServiceWorkerOptions = {},
	): Promise<ServiceWorkerInstance> {
		// Use worker count from: 1) options, 2) platform options, 3) default 1
		const workerCount = options.workerCount ?? this.#options.workers;

		// Single-threaded mode: skip workers entirely for maximum performance
		// BUT: Use workers in dev mode (hotReload) for reliable hot reload
		if (workerCount === 1 && !options.hotReload) {
			return this.#loadServiceWorkerDirect(entrypoint, options);
		}

		// Multi-worker mode OR dev mode: use WorkerPool
		return this.#loadServiceWorkerWithPool(entrypoint, options, workerCount);
	}

	/**
	 * Load ServiceWorker directly in main thread (single-threaded mode)
	 * No postMessage overhead - maximum performance for production
	 */
	async #loadServiceWorkerDirect(
		entrypoint: string,
		_options: ServiceWorkerOptions,
	): Promise<ServiceWorkerInstance> {
		const entryPath = Path.resolve(this.#options.cwd, entrypoint);

		// Try to import the generated config module (built alongside the worker entry)
		// Falls back to platform config if config.js doesn't exist (e.g., for tests)
		let config = this.#options.config;
		const configPath = Path.join(Path.dirname(entryPath), "config.js");
		try {
			// eslint-disable-next-line no-restricted-syntax -- Import generated config at runtime
			const configModule = await import(configPath);
			config = configModule.config ?? config;
		} catch (err) {
			// config.js doesn't exist - use platform config instead
			logger.debug`Using platform config (no config.js): ${err}`;
		}

		// Create shared cache storage from config (with runtime defaults)
		if (!this.#cacheStorage) {
			// Runtime defaults with actual class references
			const runtimeCacheDefaults: Record<string, {impl: any}> = {
				default: {impl: MemoryCache},
			};
			const userCaches = config?.caches ?? {};
			// Deep merge per entry so user can override options without losing impl
			const cacheConfigs: Record<string, any> = {};
			const allCacheNames = new Set([
				...Object.keys(runtimeCacheDefaults),
				...Object.keys(userCaches),
			]);
			for (const name of allCacheNames) {
				cacheConfigs[name] = {
					...runtimeCacheDefaults[name],
					...userCaches[name],
				};
			}
			this.#cacheStorage = new CustomCacheStorage(
				createCacheFactory({configs: cacheConfigs}),
			);
		}

		// Create shared directory storage from config (with runtime defaults)
		if (!this.#directoryStorage) {
			// Runtime defaults provide impl for platform-provided directories
			// Paths come from the generated config (resolved at build time)
			const runtimeDirDefaults: Record<string, {impl: any}> = {
				server: {impl: NodeFSDirectory},
				public: {impl: NodeFSDirectory},
				tmp: {impl: NodeFSDirectory},
			};
			const userDirs = config?.directories ?? {};
			// Deep merge per entry
			const dirConfigs: Record<string, any> = {};
			const allDirNames = new Set([
				...Object.keys(runtimeDirDefaults),
				...Object.keys(userDirs),
			]);
			for (const name of allDirNames) {
				dirConfigs[name] = {...runtimeDirDefaults[name], ...userDirs[name]};
			}
			this.#directoryStorage = new CustomDirectoryStorage(
				createDirectoryFactory(dirConfigs),
			);
		}

		// Create shared database storage from generated config
		if (!this.#databaseStorage) {
			this.#databaseStorage = this.createDatabases(config);
		}

		// Terminate any existing runtime
		if (this.#singleThreadedRuntime) {
			await this.#singleThreadedRuntime.terminate();
		}
		if (this.#workerPool) {
			await this.#workerPool.terminate();
			this.#workerPool = undefined;
		}

		logger.info("Creating single-threaded ServiceWorker runtime", {entryPath});

		// Create single-threaded runtime with caches, directories, databases, and loggers
		this.#singleThreadedRuntime = new SingleThreadedRuntime({
			caches: this.#cacheStorage,
			directories: this.#directoryStorage,
			databases: this.#databaseStorage,
			loggers: new CustomLoggerStorage((cats) => getLogger(cats)),
		});

		// Initialize and load entrypoint
		await this.#singleThreadedRuntime.init();
		await this.#singleThreadedRuntime.load(entryPath);

		// Capture reference for closures
		const runtime = this.#singleThreadedRuntime;
		const platform = this;

		const instance: ServiceWorkerInstance = {
			runtime,
			handleRequest: async (request: Request) => {
				if (!platform.#singleThreadedRuntime) {
					throw new Error("SingleThreadedRuntime not initialized");
				}
				return platform.#singleThreadedRuntime.handleRequest(request);
			},
			install: async () => {
				logger.info("ServiceWorker installed", {method: "single_threaded"});
			},
			activate: async () => {
				logger.info("ServiceWorker activated", {method: "single_threaded"});
			},
			get ready() {
				return runtime?.ready ?? false;
			},
			dispose: async () => {
				if (platform.#singleThreadedRuntime) {
					await platform.#singleThreadedRuntime.terminate();
					platform.#singleThreadedRuntime = undefined;
				}
				logger.info("ServiceWorker disposed", {});
			},
		};

		logger.info("ServiceWorker loaded", {
			features: ["single_threaded", "no_postmessage_overhead"],
		});
		return instance;
	}

	/**
	 * Load ServiceWorker using worker pool (multi-threaded mode or dev mode)
	 */
	async #loadServiceWorkerWithPool(
		entrypoint: string,
		_options: ServiceWorkerOptions,
		workerCount: number,
	): Promise<ServiceWorkerInstance> {
		const entryPath = Path.resolve(this.#options.cwd, entrypoint);

		// Create shared cache storage if not already created
		if (!this.#cacheStorage) {
			this.#cacheStorage = await this.createCaches();
		}

		// Terminate any existing runtime
		if (this.#singleThreadedRuntime) {
			await this.#singleThreadedRuntime.terminate();
			this.#singleThreadedRuntime = undefined;
		}
		if (this.#workerPool) {
			await this.#workerPool.terminate();
		}

		const poolOptions: WorkerPoolOptions = {
			workerCount,
			requestTimeout: 30000,
			cwd: this.#options.cwd,
		};

		logger.info("Creating ServiceWorker pool", {entryPath, workerCount});

		// Bun has native Worker support - ServiceWorkerPool will use new Worker() directly
		this.#workerPool = new ServiceWorkerPool(
			poolOptions,
			entryPath,
			this.#cacheStorage,
		);

		// Initialize workers (Bun has native Web Workers)
		// init() creates workers and loads the ServiceWorker code
		await this.#workerPool.init();

		// Capture references for closures
		const workerPool = this.#workerPool;
		const platform = this;

		const instance: ServiceWorkerInstance = {
			runtime: workerPool,
			handleRequest: async (request: Request) => {
				if (!platform.#workerPool) {
					throw new Error("WorkerPool not initialized");
				}
				return platform.#workerPool.handleRequest(request);
			},
			install: async () => {
				logger.info("ServiceWorker installed", {method: "native_web_workers"});
			},
			activate: async () => {
				logger.info("ServiceWorker activated", {method: "native_web_workers"});
			},
			get ready() {
				return workerPool?.ready ?? false;
			},
			dispose: async () => {
				if (platform.#workerPool) {
					await platform.#workerPool.terminate();
					platform.#workerPool = undefined;
				}
				logger.info("ServiceWorker disposed", {});
			},
		};

		logger.info("ServiceWorker loaded", {
			features: ["native_web_workers", "coordinated_caches"],
		});
		return instance;
	}

	/**
	 * Reload workers for hot reloading (called by CLI)
	 * @param entrypoint - Path to the new entrypoint (hashed filename)
	 */
	async reloadWorkers(entrypoint: string): Promise<void> {
		if (this.#workerPool) {
			await this.#workerPool.reloadWorkers(entrypoint);
		} else if (this.#singleThreadedRuntime) {
			await this.#singleThreadedRuntime.load(entrypoint);
		}
	}

	/**
	 * Get virtual entry wrapper for Bun
	 *
	 * @param entryPath - Absolute path to user's entrypoint file
	 * @param options - Entry wrapper options
	 * @param options.type - "production" (default) or "worker"
	 * @param options.outDir - Output directory (required for "worker" type)
	 *
	 * Returns:
	 * - "production": Server entry with Bun.serve and reusePort
	 * - "worker": Worker entry that sets up runtime and message loop
	 */
	getEntryWrapper(entryPath: string, options?: EntryWrapperOptions): string {
		if (options?.type === "worker") {
			// Return worker entry template with user code path substituted
			return workerEntryTemplate.replace("__USER_ENTRY__", entryPath);
		}
		// Default to production entry template
		return entryTemplate;
	}

	/**
	 * Get production entry points for bundling.
	 *
	 * Bun produces two files:
	 * - index.js: Supervisor that spawns workers and handles signals
	 * - worker.js: Worker with its own HTTP server (uses reusePort for multi-worker)
	 *
	 * Unlike Node.js, Bun workers each bind their own server with reusePort,
	 * allowing the OS to load-balance across workers without message passing overhead.
	 */
	getProductionEntryPoints(userEntryPath: string): ProductionEntryPoints {
		const safePath = JSON.stringify(userEntryPath);

		// Supervisor: uses runtime utilities for worker management (no HTTP server)
		const supervisorCode = `// Bun Production Supervisor
import {getLogger} from "@logtape/logtape";
import {configureLogging, initSupervisorRuntime} from "@b9g/platform/runtime";
import {config} from "shovel:config";

await configureLogging(config.logging);
const logger = getLogger(["shovel", "platform"]);

logger.info("Starting production server", {port: config.port, workers: config.workers});

// Initialize supervisor with worker pool (workers handle their own HTTP via reusePort)
const {shutdown, waitForReady} = initSupervisorRuntime({
	workerCount: config.workers,
	createWorker: () => new Worker(new URL("./worker.js", import.meta.url).href),
	onWorkerCrash: (exitCode) => {
		logger.error("Worker crashed, exiting", {exitCode});
		process.exit(1);
	},
});

await waitForReady();

// Graceful shutdown
const handleShutdown = async () => {
	logger.info("Shutting down");
	await shutdown();
	process.exit(0);
};
process.on("SIGINT", handleShutdown);
process.on("SIGTERM", handleShutdown);
`;

		// Worker: each worker has its own HTTP server with reusePort
		const workerCode = `// Bun Production Worker
import BunPlatform from "@b9g/platform-bun";
import {getLogger} from "@logtape/logtape";
import {configureLogging, initWorkerRuntime, ShovelFetchEvent} from "@b9g/platform/runtime";
import {config} from "shovel:config";

await configureLogging(config.logging);
const logger = getLogger(["shovel", "platform"]);

// Track resources for shutdown
let server;
let databases;

// Register shutdown handler before async startup
self.onmessage = async (event) => {
	if (event.data.type === "shutdown") {
		logger.info("Worker shutting down");
		if (server) await server.close();
		if (databases) await databases.closeAll();
		postMessage({type: "shutdown-complete"});
	}
};

// Initialize worker runtime (installs ServiceWorker globals)
const result = await initWorkerRuntime({config});
const registration = result.registration;
databases = result.databases;

// Import user code (registers event handlers)
await import(${safePath});

// Run ServiceWorker lifecycle
await registration.install();
await registration.activate();

// Create server with reusePort for multi-worker support
const platform = new BunPlatform({port: config.port, host: config.host});
const handleRequest = (request) => {
	const event = new ShovelFetchEvent(request);
	return registration.handleRequest(event);
};
server = platform.createServer(handleRequest, {reusePort: config.workers > 1});
await server.listen();

postMessage({type: "ready"});
logger.info("Worker started", {port: config.port});
`;

		return {
			index: supervisorCode,
			worker: workerCode,
		};
	}

	/**
	 * Get Bun-specific esbuild configuration
	 *
	 * Note: Bun natively supports import.meta.env, so no define alias is needed.
	 * We use platform: "node" since Bun is Node-compatible for module resolution.
	 */
	getESBuildConfig(): PlatformESBuildConfig {
		return {
			platform: "node",
			external: ["node:*", "bun", "bun:*", ...builtinModules],
		};
	}

	/**
	 * Get Bun-specific defaults for config generation
	 *
	 * Provides default directories (server, public, tmp) that work
	 * out of the box for Bun deployments.
	 */
	getDefaults(): PlatformDefaults {
		return {
			caches: {
				default: {
					module: "@b9g/cache/memory",
					export: "MemoryCache",
				},
			},
			directories: {
				server: {
					module: "@b9g/filesystem/node-fs",
					export: "NodeFSDirectory",
					path: "[outdir]/server",
				},
				public: {
					module: "@b9g/filesystem/node-fs",
					export: "NodeFSDirectory",
					path: "[outdir]/public",
				},
				tmp: {
					module: "@b9g/filesystem/node-fs",
					export: "NodeFSDirectory",
					path: "[tmpdir]",
				},
			},
		};
	}

	/**
	 * Dispose of platform resources
	 */
	async dispose(): Promise<void> {
		// Dispose single-threaded runtime
		if (this.#singleThreadedRuntime) {
			await this.#singleThreadedRuntime.terminate();
			this.#singleThreadedRuntime = undefined;
		}

		// Dispose worker pool
		if (this.#workerPool) {
			await this.#workerPool.terminate();
			this.#workerPool = undefined;
		}

		// Dispose cache storage (closes Redis connections, etc.)
		if (this.#cacheStorage) {
			await this.#cacheStorage.dispose();
			this.#cacheStorage = undefined;
		}

		// Dispose database storage (closes database connections)
		if (this.#databaseStorage) {
			await this.#databaseStorage.closeAll();
			this.#databaseStorage = undefined;
		}
	}

	// =========================================================================
	// Config Expression Method Overrides
	// =========================================================================

	/**
	 * Get the OS temp directory (Bun-specific implementation using node:os)
	 */
	tmpdir(): string {
		return tmpdir();
	}
}

/**
 * Default export for easy importing
 */
export default BunPlatform;

/**
 * Platform's default cache implementation.
 * Re-exported so config can reference: { module: "@b9g/platform-bun", export: "DefaultCache" }
 */
export {MemoryCache as DefaultCache} from "@b9g/cache/memory";
