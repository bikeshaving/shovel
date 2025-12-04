/**
 * @b9g/platform-node - Node.js platform adapter for Shovel
 *
 * Provides hot reloading, ESBuild integration, and optimized caching for Node.js environments.
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
	ServiceWorkerPool,
	SingleThreadedRuntime,
} from "@b9g/platform";
import {CustomCacheStorage} from "@b9g/cache";
import {CustomBucketStorage} from "@b9g/filesystem";
import {MemoryCache} from "@b9g/cache/memory";
import {NodeBucket} from "@b9g/filesystem/node";
import {InternalServerError, isHTTPError, HTTPError} from "@b9g/http-errors";
import * as HTTP from "http";
import * as Path from "path";
import {getLogger} from "@logtape/logtape";

// Entry template embedded as string
const entryTemplate = `// Node.js Production Server Entry
// This file is imported as text and used as the entry wrapper template
import {getLogger} from "@logtape/logtape";
import {config} from "shovel:config"; // Virtual module - resolved at build time
import Platform from "@b9g/platform-node";

const logger = getLogger(["server"]);

// Configuration from shovel:config (with process.env fallbacks baked in)
const PORT = config.port;
const HOST = config.host;
const WORKER_COUNT = config.workers;

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

const logger = getLogger(["server"]);

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

	#options: Required<NodePlatformOptions>;
	#workerPool?: ServiceWorkerPool;
	#singleThreadedRuntime?: SingleThreadedRuntime;
	#cacheStorage?: CustomCacheStorage;
	#bucketStorage?: CustomBucketStorage;

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

		// Note: Bucket storage is handled in runtime.ts using import.meta.url
		// Workers calculate bucket paths relative to their script location

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
			{}, // Empty config - use defaults
		);

		// Initialize workers with dynamic import handling
		await this.#workerPool.init();

		// Load ServiceWorker in all workers using entrypoint path
		await this.#workerPool.reloadWorkers(entryPath);

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
				logger.error("Request error", {
					error: err.message,
					stack: err.stack,
				});

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
	 * Returns production server entry template that uses:
	 * - shovel:config virtual module for configuration
	 * - Worker threads via ServiceWorkerPool for multi-worker scaling
	 * - Platform's loadServiceWorker and createServer methods
	 *
	 * The template is a real .ts file (entry-template.ts) for better
	 * IDE support and linting. It's imported with {type: "text"}.
	 */
	getEntryWrapper(_entryPath: string, _options?: EntryWrapperOptions): string {
		return entryTemplate;
	}

	/**
	 * Get Node.js-specific esbuild configuration
	 *
	 * Note: Node.js doesn't support import.meta.env natively, so we alias it
	 * to process.env for compatibility with code that uses Vite-style env access.
	 */
	getEsbuildConfig(): PlatformEsbuildConfig {
		return {
			platform: "node",
			external: ["node:*"],
			define: {
				// Node.js doesn't support import.meta.env, alias to process.env
				"import.meta.env": "process.env",
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
	}
}

/**
 * Default export for easy importing
 */
export default NodePlatform;
