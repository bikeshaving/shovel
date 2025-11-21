/**
 * @b9g/platform-node - Node.js platform adapter for Shovel
 *
 * Provides hot reloading, ESBuild integration, and optimized caching for Node.js environments.
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
} from "@b9g/platform";
import {CustomCacheStorage} from "@b9g/cache";
import {MemoryCache} from "@b9g/cache/memory.js";
import {PostMessageCache} from "@b9g/cache/postmessage.js";
import {FileSystemRegistry, getDirectoryHandle} from "@b9g/filesystem";
import {NodeBucket} from "@b9g/filesystem/node.js";
import * as Http from "http";
import * as Path from "path";
import * as Os from "os";
import {getLogger} from "@logtape/logtape";

const logger = getLogger(["platform-node"]);

// Re-export common platform types
export type {
	Platform,
	Handler,
	Server,
	ServerOptions,
} from "@b9g/platform";

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
	#cacheStorage?: CustomCacheStorage;

	constructor(options: NodePlatformOptions = {}) {
		super(options);
		this.name = "node";
		this.#options = {
			port: 3000,
			host: "localhost",
			cwd: process.cwd(),
			...options,
		};

		// Register standard well-known buckets
		FileSystemRegistry.register("tmp", new NodeBucket(Os.tmpdir()));
		FileSystemRegistry.register(
			"dist",
			new NodeBucket(Path.join(this.#options.cwd, "dist")),
		);
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
	 * Get filesystem directory handle
	 */
	async getDirectoryHandle(name: string): Promise<FileSystemDirectoryHandle> {
		// Create dist filesystem pointing to ./dist directory
		const distPath = Path.resolve(this.#options.cwd, "dist");
		const targetPath = name ? Path.join(distPath, name) : distPath;
		return new NodeBucket(targetPath);
	}

	/**
	 * THE MAIN JOB - Load and run a ServiceWorker-style entrypoint in Node.js
	 * Uses Worker threads with coordinated cache storage for isolation and standards compliance
	 */
	async loadServiceWorker(
		entrypoint: string,
		options: ServiceWorkerOptions = {},
	): Promise<ServiceWorkerInstance> {
		const entryPath = Path.resolve(this.#options.cwd, entrypoint);

		// Create shared cache storage if not already created
		if (!this.#cacheStorage) {
			this.#cacheStorage = await this.createCaches();
		}

		// Create bucket storage for dist/ directory access
		const {CustomBucketStorage} = await import("@b9g/filesystem");
		const distPath = Path.resolve(this.#options.cwd, "dist");
		const bucketStorage = new CustomBucketStorage(async (name: string) => {
			const bucketPath = Path.join(distPath, name);
			return new NodeBucket(bucketPath);
		});

		// Create ServiceWorkerPool with shared cache and bucket storage
		// Always create a new WorkerPool to ensure correct entrypoint
		if (this.#workerPool) {
			await this.#workerPool.terminate();
		}
		const workerCount = options.workerCount || 1;
		logger.info("Creating ServiceWorker pool", {
			entryPath,
		});
		this.#workerPool = new ServiceWorkerPool(
			{
				workerCount,
				requestTimeout: 30000,
				cwd: this.#options.cwd,
			},
			entryPath,
			this.#cacheStorage,
			bucketStorage,
		);

		// Initialize workers with dynamic import handling
		await this.#workerPool.init();

		// Load ServiceWorker in all workers
		const version = Date.now();
		await this.#workerPool.reloadWorkers(version);

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
	 * SUPPORTING UTILITY - Create cache storage optimized for Node.js
	 * Uses MemoryCache in main thread, PostMessageCache in workers
	 */
	async createCaches(): Promise<CustomCacheStorage> {
		// Return CustomCacheStorage with thread-appropriate cache
		// Factory checks thread context dynamically on each call
		return new CustomCacheStorage((name: string) => {
			// Standard Web Worker detection using WorkerGlobalScope
			// WorkerGlobalScope is only defined in worker contexts (installed by ShovelGlobalScope.install())
			const isWorkerThread =
				typeof (globalThis as any).WorkerGlobalScope !== "undefined";

			if (isWorkerThread) {
				// Worker thread: Use PostMessageCache that coordinates with main thread
				return new PostMessageCache(name, {
					maxEntries: 1000,
				});
			} else {
				// Main thread: Use MemoryCache directly
				return new MemoryCache(name, {
					maxEntries: 1000,
				});
			}
		});
	}

	/**
	 * SUPPORTING UTILITY - Create HTTP server for Node.js
	 */
	createServer(handler: Handler, options: ServerOptions = {}): Server {
		const port = options.port ?? this.#options.port;
		const host = options.host ?? this.#options.host;

		// Create HTTP server with Web API Request/Response conversion
		const httpServer = Http.createServer(async (req, res) => {
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
				logger.error("Request error", {
					error: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined,
				});
				res.statusCode = 500;
				res.setHeader("Content-Type", "text/plain");
				res.end("Internal Server Error");
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
	 * Get filesystem root for File System Access API
	 */
	async getFileSystemRoot(
		name = "default",
	): Promise<FileSystemDirectoryHandle> {
		// Use centralized filesystem registry
		return await getDirectoryHandle(name);
	}

	/**
	 * Reload workers for hot reloading (called by CLI)
	 */
	async reloadWorkers(version?: number | string): Promise<void> {
		if (this.#workerPool) {
			await this.#workerPool.reloadWorkers(version);
		}
	}

	/**
	 * Dispose of platform resources
	 */
	async dispose(): Promise<void> {
		if (this.#workerPool) {
			await this.#workerPool.terminate();
			this.#workerPool = undefined;
		}
	}
}

/**
 * Default export for easy importing
 */
export default NodePlatform;
