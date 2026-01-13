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
	type PlatformESBuildConfig,
	type ProductionEntryPoints,
	ServiceWorkerPool,
	type WorkerPoolOptions,
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
	#cacheStorage?: CustomCacheStorage;
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
		const workerCount = options.workerCount ?? this.#options.workers;
		const entryPath = Path.resolve(this.#options.cwd, entrypoint);

		// Create shared cache storage if not already created
		if (!this.#cacheStorage) {
			this.#cacheStorage = await this.createCaches();
		}

		// Terminate any existing worker pool
		if (this.#workerPool) {
			await this.#workerPool.terminate();
		}

		const poolOptions: WorkerPoolOptions = {
			workerCount,
			requestTimeout: 30000,
			cwd: this.#options.cwd,
		};

		logger.debug("Creating ServiceWorker pool", {entryPath, workerCount});

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
				logger.debug("ServiceWorker installed", {method: "native_web_workers"});
			},
			activate: async () => {
				logger.debug("ServiceWorker activated", {method: "native_web_workers"});
			},
			get ready() {
				return workerPool?.ready ?? false;
			},
			dispose: async () => {
				if (platform.#workerPool) {
					await platform.#workerPool.terminate();
					platform.#workerPool = undefined;
				}
				logger.debug("ServiceWorker disposed", {});
			},
		};

		logger.debug("ServiceWorker loaded", {
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
		}
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
import {configureLogging, initWorkerRuntime, runLifecycle, dispatchRequest} from "@b9g/platform/runtime";
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

// Run ServiceWorker lifecycle (stage from config.lifecycle if present)
await runLifecycle(registration, config.lifecycle?.stage);

// Start server (skip in lifecycle-only mode)
if (!config.lifecycle) {
	const platform = new BunPlatform({port: config.port, host: config.host});
	server = platform.createServer(
		(request) => dispatchRequest(registration, request),
		{reusePort: config.workers > 1},
	);
	await server.listen();
}

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
