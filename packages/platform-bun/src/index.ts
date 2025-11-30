/**
 * @b9g/platform-bun - Bun platform adapter for Shovel
 *
 * Provides built-in TypeScript/JSX support and simplified server setup for Bun environments.
 */

import {
	BasePlatform,
	PlatformConfig,
	Handler,
	Server,
	ServerOptions,
	ServiceWorkerOptions,
	ServiceWorkerInstance,
	ServiceWorkerPool,
	SingleThreadedRuntime,
	WorkerPoolOptions,
	loadConfig,
	createCacheFactory,
	type ProcessedShovelConfig,
} from "@b9g/platform";
import {CustomCacheStorage} from "@b9g/cache";
import {InternalServerError, isHTTPError, HTTPError} from "@b9g/http-errors";
import * as Path from "path";
import {getLogger} from "@logtape/logtape";

const logger = getLogger(["platform-bun"]);

// Re-export common platform types
export type {
	Platform,
	Handler,
	Server,
	ServerOptions,
	ServiceWorkerOptions,
	ServiceWorkerInstance,
} from "@b9g/platform";

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
	#options: Required<BunPlatformOptions>;
	#workerPool?: ServiceWorkerPool;
	#singleThreadedRuntime?: SingleThreadedRuntime;
	#cacheStorage?: CustomCacheStorage;
	#config: ProcessedShovelConfig;

	constructor(options: BunPlatformOptions = {}) {
		super(options);
		this.name = "bun";

		const cwd = options.cwd || process.cwd();

		// Load configuration from package.json
		this.#config = loadConfig(cwd);

		// Merge options with config (options take precedence)
		this.#options = {
			port: options.port ?? this.#config.port,
			host: options.host ?? this.#config.host,
			cwd,
			...options,
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
	 * Create cache storage
	 * Uses config from package.json shovel field
	 */
	async createCaches(): Promise<CustomCacheStorage> {
		return new CustomCacheStorage(createCacheFactory({config: this.#config}));
	}

	/**
	 * Create HTTP server using Bun.serve
	 */
	createServer(handler: Handler, options: ServerOptions = {}): Server {
		const port = options.port ?? this.#options.port;
		const hostname = options.host ?? this.#options.host;

		// Bun.serve is much simpler than Node.js
		const server = Bun.serve({
			port,
			hostname,
			async fetch(request) {
				try {
					return await handler(request);
				} catch (error) {
					const err = error instanceof Error ? error : new Error(String(error));
					logger.error("Request error", {
						error: err.message,
						stack: err.stack,
					});

					// Convert to HTTPError for consistent response format
					const httpError = isHTTPError(error)
						? (error as HTTPError)
						: new InternalServerError(err.message, {cause: err});

					const isDev = import.meta.env?.MODE !== "production";
					return httpError.toResponse(isDev);
				}
			},
		});

		return {
			async listen() {
				logger.info("Bun server running", {url: `http://${hostname}:${port}`});
			},
			async close() {
				server.stop();
			},
			address: () => ({port, host: hostname}),
			get url() {
				return `http://${hostname}:${port}`;
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
		// Use worker count from: 1) options, 2) config, 3) default 1
		const workerCount = options.workerCount ?? this.#config.workers ?? 1;

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
		const entryDir = Path.dirname(entryPath);

		// Create shared cache storage if not already created
		if (!this.#cacheStorage) {
			this.#cacheStorage = await this.createCaches();
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

		// Create single-threaded runtime with baseDir
		// Bucket/cache storage created internally using factories from config.ts
		this.#singleThreadedRuntime = new SingleThreadedRuntime({
			baseDir: entryDir,
			cacheStorage: this.#cacheStorage,
			config: this.#config,
		});

		// Initialize and load entrypoint
		await this.#singleThreadedRuntime.init();
		await this.#singleThreadedRuntime.loadEntrypoint(entryPath);

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
			this.#config,
		);

		// Initialize workers (Bun has native Web Workers)
		await this.#workerPool.init();

		// Load ServiceWorker in all workers
		await this.#workerPool.reloadWorkers(entryPath);

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
			await this.#singleThreadedRuntime.reloadWorkers(entrypoint);
		}
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
	}
}

/**
 * Default export for easy importing
 */
export default BunPlatform;
