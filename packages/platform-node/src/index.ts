/**
 * @b9g/platform-node - Node.js platform adapter for Shovel
 *
 * Provides hot reloading, ESBuild integration, and optimized caching for Node.js environments.
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
	ServiceWorkerPool,
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
import * as HTTP from "http";
import * as Path from "path";
import {getLogger} from "@logtape/logtape";

// Entry template embedded as string
const entryTemplate = `// Node.js Production Server Entry
import {tmpdir} from "os"; // For [tmpdir] config expressions
import * as HTTP from "http";
import {parentPort} from "worker_threads";
import {Worker} from "@b9g/node-webworker";
import {getLogger} from "@logtape/logtape";
import {configureLogging} from "@b9g/platform/runtime";
import {config} from "shovel:config"; // Virtual module - resolved at build time
import Platform from "@b9g/platform-node";

// Configure logging before anything else
await configureLogging(config.logging);

const logger = getLogger(["shovel", "platform"]);

// Configuration from shovel:config
const PORT = config.port;
const HOST = config.host;
const WORKERS = config.workers;

// Use explicit marker instead of isMainThread
// This handles the edge case where Shovel's build output is embedded in another worker
const isShovelWorker = process.env.SHOVEL_SPAWNED_WORKER === "1";

if (WORKERS === 1) {
	// Single worker mode: worker owns server (same as Bun)
	// No reusePort needed since there's only one listener
	if (isShovelWorker) {
		// Worker thread: runs BOTH server AND ServiceWorker
		const platform = new Platform({port: PORT, host: HOST, workers: 1});
		const userCodePath = new URL("./server.js", import.meta.url).pathname;
		const serviceWorker = await platform.loadServiceWorker(userCodePath);

		const server = platform.createServer(serviceWorker.handleRequest, {
			port: PORT,
			host: HOST,
		});
		await server.listen();

		// Signal ready to main thread
		postMessage({type: "ready"});
		logger.info("Worker started with server", {port: PORT});

		// Graceful shutdown on message from main
		self.onmessage = async (event) => {
			if (event.data.type === "shutdown") {
				logger.info("Worker shutting down");
				await server.close();
				await serviceWorker.dispose();
				await platform.dispose();
				postMessage({type: "shutdown-complete"});
			}
		};
	} else {
		// Main thread: supervisor only - spawn single worker
		logger.info("Starting production server (single worker)", {port: PORT});

		// Port availability check - fail fast if port is in use
		const checkPort = () => new Promise((resolve, reject) => {
			const testServer = HTTP.createServer();
			testServer.once("error", reject);
			testServer.listen(PORT, HOST, () => {
				testServer.close(() => resolve(undefined));
			});
		});
		try {
			await checkPort();
		} catch (err) {
			logger.error("Port unavailable", {port: PORT, host: HOST, error: err});
			process.exit(1);
		}

		let shuttingDown = false;

		const worker = new Worker(new URL(import.meta.url), {
			env: {SHOVEL_SPAWNED_WORKER: "1"},
		});

		worker.onmessage = (event) => {
			if (event.data.type === "ready") {
				logger.info("Worker ready", {port: PORT});
			} else if (event.data.type === "shutdown-complete") {
				logger.info("Worker shutdown complete");
				process.exit(0);
			}
		};

		worker.onerror = (event) => {
			logger.error("Worker error", {error: event.error});
		};

		// If a worker crashes, fail fast - let process supervisor handle restarts
		worker.addEventListener("close", (event) => {
			if (shuttingDown) return;
			if (event.code === 0) return; // Clean exit
			logger.error("Worker crashed", {exitCode: event.code});
			process.exit(1);
		});

		// Graceful shutdown
		const shutdown = () => {
			shuttingDown = true;
			logger.info("Shutting down");
			worker.postMessage({type: "shutdown"});
		};

		process.on("SIGINT", shutdown);
		process.on("SIGTERM", shutdown);
	}
} else {
	// Multi-worker mode: main thread owns server (no reusePort in Node.js)
	// Workers handle ServiceWorker code via postMessage
	if (isShovelWorker) {
		// Worker: ServiceWorker only, respond via message loop
		// This path uses the workerEntryTemplate, not this template
		throw new Error("Multi-worker mode uses workerEntryTemplate, not entryTemplate");
	} else {
		// Main thread: HTTP server + dispatch to worker pool
		const platform = new Platform({port: PORT, host: HOST, workers: WORKERS});
		const userCodePath = new URL("./server.js", import.meta.url).pathname;

		logger.info("Starting production server (multi-worker)", {workers: WORKERS, port: PORT});

		// Load ServiceWorker with worker pool
		const serviceWorker = await platform.loadServiceWorker(userCodePath, {
			workerCount: WORKERS,
		});

		// Create HTTP server
		const server = platform.createServer(serviceWorker.handleRequest, {
			port: PORT,
			host: HOST,
		});

		await server.listen();
		logger.info("Server running", {url: \`http://\${HOST}:\${PORT}\`, workers: WORKERS});

		// Graceful shutdown
		const shutdown = async () => {
			logger.info("Shutting down server");
			await serviceWorker.dispose();
			await platform.dispose();
			await server.close();
			logger.info("Server stopped");
			process.exit(0);
		};

		process.on("SIGINT", shutdown);
		process.on("SIGTERM", shutdown);
	}
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
// Pass databases for graceful shutdown (close connections before termination)
startWorkerMessageLoop({registration, databases});
`;

const logger = getLogger(["shovel", "platform"]);

// ============================================================================
// TYPES
// ============================================================================

export interface NodePlatformOptions extends PlatformConfig {
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
// PLATFORM IMPLEMENTATION
// ============================================================================

/**
 * Node.js platform implementation
 * ServiceWorker entrypoint loader for Node.js with ESBuild VM system
 */
export class NodePlatform extends BasePlatform {
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

	constructor(options: NodePlatformOptions = {}) {
		super(options);
		this.name = "node";

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
	 * THE MAIN JOB - Load and run a ServiceWorker-style entrypoint in Node.js
	 * Uses Worker threads with coordinated cache storage for isolation and standards compliance
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

		// Multi-worker mode OR dev mode: use ServiceWorkerPool
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

		// Create shared cache storage from config
		if (!this.#cacheStorage) {
			this.#cacheStorage = new CustomCacheStorage(
				createCacheFactory({
					configs: config?.caches ?? {},
				}),
			);
		}

		// Note: Directory storage is handled in runtime.ts using import.meta.url
		// Workers calculate directory paths relative to their script location

		// Terminate any existing runtime
		if (this.#singleThreadedRuntime) {
			await this.#singleThreadedRuntime.terminate();
			this.#singleThreadedRuntime = undefined;
		}
		if (this.#workerPool) {
			await this.#workerPool.terminate();
		}

		logger.info("Creating ServiceWorker pool", {
			entryPath,
			workerCount,
		});
		this.#workerPool = new ServiceWorkerPool(
			{
				workerCount,
				requestTimeout: 30000,
				cwd: this.#options.cwd,
			},
			entryPath,
			this.#cacheStorage,
		);

		// Initialize workers with dynamic import handling
		// init() creates workers and loads the ServiceWorker code
		await this.#workerPool.init();

		// Capture references for closures
		const workerPool = this.#workerPool;
		const platform = this;

		const instance: ServiceWorkerInstance = {
			runtime: workerPool,
			handleRequest: async (request: Request) => {
				if (!platform.#workerPool) {
					throw new Error("ServiceWorkerPool not initialized");
				}
				return platform.#workerPool.handleRequest(request);
			},
			install: async () => {
				logger.info("ServiceWorker installed", {
					method: "worker_threads",
				});
			},
			activate: async () => {
				logger.info("ServiceWorker activated", {
					method: "worker_threads",
				});
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
			features: ["worker_threads", "coordinated_caches"],
		});
		return instance;
	}

	/**
	 * Create cache storage using config from shovel.json
	 * Used for testing - production uses the generated config module
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
	 * Used for testing - production uses the generated config module
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
		configOverride?: NodePlatformOptions["config"],
	): CustomDatabaseStorage | undefined {
		const config = configOverride ?? this.#options.config;
		if (config?.databases && Object.keys(config.databases).length > 0) {
			const factory = createDatabaseFactory(config.databases);
			return new CustomDatabaseStorage(factory);
		}
		return undefined;
	}

	/**
	 * SUPPORTING UTILITY - Create HTTP server for Node.js
	 */
	createServer(handler: Handler, options: ServerOptions = {}): Server {
		const port = options.port ?? this.#options.port;
		const host = options.host ?? this.#options.host;

		// Create HTTP server with Web API Request/Response conversion
		const httpServer = HTTP.createServer(async (req, res) => {
			try {
				// Convert Node.js request to Web API Request
				const url = `http://${req.headers.host}${req.url}`;
				const request = new Request(url, {
					method: req.method,
					headers: req.headers as HeadersInit,
					// Node.js IncomingMessage can be used as body (it's a readable stream)
					body:
						req.method !== "GET" && req.method !== "HEAD"
							? (req as any)
							: undefined,
				});

				// Handle request via provided handler
				const response = await handler(request);

				// Convert Web API Response to Node.js response
				res.statusCode = response.status;
				res.statusMessage = response.statusText;

				// Set headers
				response.headers.forEach((value, key) => {
					res.setHeader(key, value);
				});

				// Stream response body
				if (response.body) {
					const reader = response.body.getReader();
					const pump = async () => {
						const {done, value} = await reader.read();
						if (done) {
							res.end();
						} else {
							res.write(value);
							await pump();
						}
					};
					await pump();
				} else {
					res.end();
				}
			} catch (error) {
				const err = error instanceof Error ? error : new Error(String(error));
				logger.error("Request error: {error}", {error: err});

				// Convert to HTTPError for consistent response format
				const httpError = isHTTPError(error)
					? (error as HTTPError)
					: new InternalServerError(err.message, {cause: err});

				// import.meta.env is aliased to process.env for Node.js builds
				const isDev = import.meta.env?.MODE !== "production";
				const response = httpError.toResponse(isDev);

				// Write response to Node.js res
				res.statusCode = response.status;
				response.headers.forEach((value, key) => {
					res.setHeader(key, value);
				});
				res.end(await response.text());
			}
		});

		let isListening = false;
		let actualPort = port;

		return {
			async listen() {
				return new Promise<void>((resolve, reject) => {
					httpServer.listen(port, host, () => {
						// Get actual assigned port (important when port is 0)
						const addr = httpServer.address();
						if (addr && typeof addr === "object") {
							actualPort = addr.port;
						}
						logger.info("Server started", {
							host,
							port: actualPort,
							url: `http://${host}:${actualPort}`,
						});
						isListening = true;
						resolve();
					});

					httpServer.on("error", (error) => {
						reject(error);
					});
				});
			},
			async close() {
				return new Promise<void>((resolve) => {
					httpServer.close(() => {
						isListening = false;
						resolve();
					});
				});
			},
			address: () => ({port: actualPort, host}),
			get url() {
				return `http://${host}:${actualPort}`;
			},
			get ready() {
				return isListening;
			},
		};
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
	 * Get virtual entry wrapper for Node.js
	 *
	 * @param entryPath - Absolute path to user's entrypoint file
	 * @param options - Entry wrapper options
	 * @param options.type - "production" (default) or "worker"
	 *
	 * Returns:
	 * - "production": Server entry that loads ServiceWorkerPool
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
	 * Get Node.js-specific esbuild configuration
	 *
	 * Note: Node.js doesn't support import.meta.env natively, so we alias it
	 * to process.env for compatibility with code that uses Vite-style env access.
	 */
	getESBuildConfig(): PlatformESBuildConfig {
		return {
			platform: "node",
			external: ["node:*", ...builtinModules],
			define: {
				// Node.js doesn't support import.meta.env, alias to process.env
				"import.meta.env": "process.env",
			},
		};
	}

	/**
	 * Get Node.js-specific defaults for config generation
	 *
	 * Provides default directories (server, public, tmp) that work
	 * out of the box for Node.js deployments.
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
	 * Get the OS temp directory (Node.js-specific implementation)
	 */
	tmpdir(): string {
		return tmpdir();
	}
}

/**
 * Default export for easy importing
 */
export default NodePlatform;

/**
 * Platform's default cache implementation.
 * Re-exported so config can reference: { module: "@b9g/platform-node", export: "DefaultCache" }
 */
export {MemoryCache as DefaultCache} from "@b9g/cache/memory";
