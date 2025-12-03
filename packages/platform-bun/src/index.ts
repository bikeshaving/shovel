/**
 * @b9g/platform-bun - Bun platform adapter for Shovel
 *
 * Provides built-in TypeScript/JSX support and simplified server setup for Bun environments.
 */

import {
	BasePlatform,
	type PlatformConfig,
	type Handler,
	type Server,
	type ServerOptions,
	type ServiceWorkerOptions,
	type ServiceWorkerInstance,
	type EntryWrapperOptions,
	type PlatformEsbuildConfig,
} from "@b9g/platform";
import {
	ServiceWorkerPool,
	type WorkerPoolOptions,
} from "@b9g/platform/worker-pool";
import {SingleThreadedRuntime} from "@b9g/platform/single-threaded";
import {CustomCacheStorage} from "@b9g/cache";
import {CustomBucketStorage} from "@b9g/filesystem";
import {MemoryCache} from "@b9g/cache/memory";
import {NodeBucket} from "@b9g/filesystem/node";
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
	/** Number of worker threads (default: 1) */
	workers?: number;
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
	#bucketStorage?: CustomBucketStorage;

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
	 * Create cache storage (in-memory by default)
	 */
	async createCaches(): Promise<CustomCacheStorage> {
		return new CustomCacheStorage((name: string) => new MemoryCache(name));
	}

	/**
	 * Create bucket storage for the given base directory
	 */
	createBuckets(baseDir: string): CustomBucketStorage {
		return new CustomBucketStorage((name: string) => {
			// Well-known bucket paths
			let bucketPath: string;
			if (name === "static") {
				bucketPath = Path.resolve(baseDir, "../static");
			} else if (name === "server") {
				bucketPath = baseDir;
			} else {
				bucketPath = Path.resolve(baseDir, `../${name}`);
			}
			return Promise.resolve(new NodeBucket(bucketPath));
		});
	}

	/**
	 * Create HTTP server using Bun.serve
	 */
	createServer(handler: Handler, options: ServerOptions = {}): Server {
		const requestedPort = options.port ?? this.#options.port;
		const hostname = options.host ?? this.#options.host;

		// Bun.serve is much simpler than Node.js
		const server = Bun.serve({
			port: requestedPort,
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

		// Get the actual port (important when port 0 was requested)
		const actualPort = server.port;

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
		const entryDir = Path.dirname(entryPath);

		// Create shared cache storage if not already created
		if (!this.#cacheStorage) {
			this.#cacheStorage = await this.createCaches();
		}

		// Create shared bucket storage if not already created
		if (!this.#bucketStorage) {
			this.#bucketStorage = this.createBuckets(entryDir);
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

		// Create single-threaded runtime with caches and buckets
		this.#singleThreadedRuntime = new SingleThreadedRuntime({
			caches: this.#cacheStorage,
			buckets: this.#bucketStorage,
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
			{}, // Empty config - use defaults
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
			await this.#singleThreadedRuntime.load(entrypoint);
		}
	}

	/**
	 * Get virtual entry wrapper for Bun
	 *
	 * Returns production server entry template that:
	 * 1. Imports @b9g/platform-bun
	 * 2. Loads the user's ServiceWorker code
	 * 3. Creates HTTP server with platform.createServer()
	 *
	 * Note: Bun natively supports import.meta.env, so no define alias is needed.
	 */
	getEntryWrapper(_entryPath: string, _options?: EntryWrapperOptions): string {
		// Note: entryPath is not used in the wrapper because Node/Bun load
		// user code at runtime via loadServiceWorker("./server.js")
		// The CLI builds user code separately to dist/server/server.js
		return `// Bun Production Server Entry
import {getLogger} from "@logtape/logtape";
import Platform from "@b9g/platform-bun";

const logger = getLogger(["worker"]);

// Configuration from environment
const PORT = parseInt(import.meta.env.PORT || "8080", 10);
const HOST = import.meta.env.HOST || "0.0.0.0";
const WORKER_COUNT = parseInt(import.meta.env.WORKERS || "1", 10);

logger.info("Starting production server", {});
logger.info("Workers", {count: WORKER_COUNT});

// Create platform instance
const platform = new Platform();

// Get the path to the user's ServiceWorker code
const userCodeURL = new URL("./server.js", import.meta.url);
const userCodePath = userCodeURL.pathname;

// Load ServiceWorker with worker pool
const serviceWorker = await platform.loadServiceWorker(userCodePath, {
	workerCount: WORKER_COUNT,
});

// Create HTTP server
const server = platform.createServer(serviceWorker.handleRequest, {
	port: PORT,
	host: HOST,
});

await server.listen();
logger.info("Server running", {url: \`http://\${HOST}:\${PORT}\`});
logger.info("Load balancing", {workers: WORKER_COUNT});

// Graceful shutdown
const shutdown = async () => {
	logger.info("Shutting down server", {});
	await serviceWorker.dispose();
	await platform.dispose();
	await server.close();
	logger.info("Server stopped", {});
	process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
`;
	}

	/**
	 * Get Bun-specific esbuild configuration
	 *
	 * Note: Bun natively supports import.meta.env, so no define alias is needed.
	 * We use platform: "node" since Bun is Node-compatible for module resolution.
	 */
	getEsbuildConfig(): PlatformEsbuildConfig {
		return {
			platform: "node",
			external: ["node:*"],
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
	}
}

/**
 * Default export for easy importing
 */
export default BunPlatform;
