/**
 * @b9g/platform-node - Node.js platform adapter for Shovel
 *
 * Provides hot reloading, ESBuild integration, and optimized caching for Node.js environments.
 */

import {
	BasePlatform,
	PlatformConfig,
	CacheConfig,
	Handler,
	Server,
	ServerOptions,
	ServiceWorkerOptions,
	ServiceWorkerInstance,
	createDirectoryStorage as _createDirectoryStorage,
} from "@b9g/platform";
import {WorkerPool, WorkerPoolOptions} from "@b9g/platform/worker-pool";
import {
	CustomCacheStorage,
	MemoryCache,
	MemoryCacheManager,
	PostMessageCache,
} from "@b9g/cache";
import {
	FileSystemRegistry,
	getDirectoryHandle,
	NodeBucket,
	MemoryBucket as _MemoryBucket,
} from "@b9g/filesystem";
import * as Http from "http";
import * as Path from "path";
import * as Os from "os";

// Re-export common platform types
export type {
	Platform,
	CacheConfig,
	StaticConfig,
	Handler,
	Server,
	ServerOptions,
} from "@b9g/platform";

// ============================================================================
// TYPES
// ============================================================================

export interface NodePlatformOptions extends PlatformConfig {
	/** Enable hot reloading (default: true in development) */
	hotReload?: boolean;
	/** Port for development server (default: 3000) */
	port?: number;
	/** Host for development server (default: localhost) */
	host?: string;
	/** Working directory for file resolution */
	cwd?: string;
}

// ============================================================================
// NODE-SPECIFIC WORKER POOL
// ============================================================================

/**
 * Node.js-specific WorkerPool with MemoryCache coordination
 * Extends the common WorkerPool with Node.js-specific cache handling
 */
class NodeWorkerPool extends WorkerPool {
	private memoryCacheManager: MemoryCacheManager;

	constructor(
		cacheStorage: CustomCacheStorage,
		poolOptions: WorkerPoolOptions,
		appEntrypoint?: string,
	) {
		super(cacheStorage, poolOptions, appEntrypoint);

		// Initialize Node.js-specific memory cache manager
		this.memoryCacheManager = new MemoryCacheManager();
		console.info(
			"[NodeWorkerPool] Initialized with entrypoint:",
			appEntrypoint,
		);
	}

	/**
	 * Handle Node.js-specific cache coordination
	 */
	protected handleCacheMessage(message: any): void {
		// Handle memory cache operations (only MemoryCache needs coordination)
		if (message.type?.startsWith("cache:")) {
			// Note: We need access to the raw Node.js Worker for cache coordination
			// This is a limitation of the current abstraction that we'll need to address
			console.warn(
				"[NodeWorkerPool] Cache coordination not fully implemented in abstraction",
			);
		}
	}

	/**
	 * Enhanced termination with memory cache cleanup
	 */
	async terminate(): Promise<void> {
		await super.terminate();
		await this.memoryCacheManager.dispose();
	}
}

// ============================================================================
// PLATFORM IMPLEMENTATION
// ============================================================================

/**
 * Node.js platform implementation
 * ServiceWorker entrypoint loader for Node.js with ESBuild VM system
 */
export class NodePlatform extends BasePlatform {
	readonly name = "node";

	private options: Required<NodePlatformOptions>;
	private workerPool?: NodeWorkerPool;
	private cacheStorage?: CustomCacheStorage;

	constructor(options: NodePlatformOptions = {}) {
		super(options);
		this.options = {
			hotReload: process.env.NODE_ENV !== "production",
			port: 3000,
			host: "localhost",
			cwd: process.cwd(),
			...options,
		};

		// Register standard well-known buckets
		FileSystemRegistry.register("tmp", new NodeBucket(Os.tmpdir()));
		FileSystemRegistry.register(
			"dist",
			new NodeBucket(Path.join(this.options.cwd, "dist")),
		);
	}

	/**
	 * Get filesystem directory handle
	 */
	async getDirectoryHandle(name: string): Promise<FileSystemDirectoryHandle> {
		// Create dist filesystem pointing to ./dist directory
		const distPath = Path.resolve(this.options.cwd, "dist");
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
		const entryPath = Path.resolve(this.options.cwd, entrypoint);

		// Create shared cache storage if not already created
		if (!this.cacheStorage) {
			this.cacheStorage = await this.createCaches(options.caches);
		}

		// Create NodeWorkerPool with shared cache storage
		// Always create a new WorkerPool to ensure correct entrypoint
		if (this.workerPool) {
			await this.workerPool.terminate();
		}
		const workerCount = options.workerCount || 1;
		console.info(
			"[Platform-Node] Creating NodeWorkerPool with entryPath:",
			entryPath,
		);
		this.workerPool = new NodeWorkerPool(
			this.cacheStorage,
			{
				workerCount,
				requestTimeout: 30000,
				hotReload: this.options.hotReload,
				cwd: this.options.cwd,
			},
			entryPath,
		);

		// Initialize workers with dynamic import handling
		await this.workerPool.init();

		// Load ServiceWorker in all workers
		const version = Date.now();
		await this.workerPool.reloadWorkers(version);

		const instance: ServiceWorkerInstance = {
			runtime: this.workerPool,
			handleRequest: async (request: Request) => {
				if (!this.workerPool) {
					throw new Error("NodeWorkerPool not initialized");
				}
				return this.workerPool.handleRequest(request);
			},
			install: async () => {
				console.info(
					"[Platform-Node] ServiceWorker installed via Worker threads",
				);
			},
			activate: async () => {
				console.info(
					"[Platform-Node] ServiceWorker activated via Worker threads",
				);
			},
			collectStaticRoutes: async () => {
				// TODO: Implement static route collection
				return [];
			},
			get ready() {
				return this.workerPool?.ready ?? false;
			},
			dispose: async () => {
				if (this.workerPool) {
					await this.workerPool.terminate();
					this.workerPool = undefined;
				}
				console.info("[Platform-Node] ServiceWorker disposed");
			},
		};

		console.info(
			"[Platform-Node] ServiceWorker loaded with Worker threads and coordinated caches",
		);
		return instance;
	}

	/**
	 * Get platform-specific default cache configuration for Node.js
	 */
	protected getDefaultCacheConfig(): CacheConfig {
		return {
			pages: {type: "memory"}, // PostMessage cache for worker coordination
			api: {type: "memory"},
			static: {type: "memory"},
		};
	}

	/**
	 * SUPPORTING UTILITY - Create cache storage optimized for Node.js
	 * Uses MemoryCache in main thread, PostMessageCache in workers
	 */
	async createCaches(_config?: CacheConfig): Promise<CustomCacheStorage> {
		// Import Node.js worker_threads to detect thread type
		const {isMainThread} = await import("worker_threads");

		// Return CustomCacheStorage with thread-appropriate cache
		return new CustomCacheStorage((name: string) => {
			if (isMainThread) {
				// Main thread: Use MemoryCache directly
				return new MemoryCache(name, {
					maxEntries: 1000,
					maxAge: 60 * 60 * 1000, // 1 hour
				});
			} else {
				// Worker thread: Use PostMessageCache that coordinates with main thread
				return new PostMessageCache(name, {
					maxEntries: 1000,
					maxAge: 60 * 60 * 1000, // 1 hour
				});
			}
		});
	}

	/**
	 * SUPPORTING UTILITY - Create HTTP server for Node.js
	 */
	createServer(handler: Handler, options: ServerOptions = {}): Server {
		const port = options.port ?? this.options.port;
		const host = options.host ?? this.options.host;

		// Create HTTP server with Web API Request/Response conversion
		const httpServer = Http.createServer(async (req, res) => {
			try {
				// Convert Node.js request to Web API Request
				const url = `http://${req.headers.host}${req.url}`;
				const request = new Request(url, {
					method: req.method,
					headers: req.headers as HeadersInit,
					body: req.method !== "GET" && req.method !== "HEAD" ? req : undefined,
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
				console.error("[Platform-Node] Request error:", error);
				res.statusCode = 500;
				res.setHeader("Content-Type", "text/plain");
				res.end("Internal Server Error");
			}
		});

		let isListening = false;

		return {
			async listen() {
				return new Promise<void>((resolve) => {
					httpServer.listen(port, host, () => {
						console.info(`🚀 Server running at http://${host}:${port}`);
						isListening = true;
						resolve();
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
			address: () => ({port, host}),
			get url() {
				return `http://${host}:${port}`;
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
		if (this.workerPool) {
			await this.workerPool.reloadWorkers(version);
		}
	}

	/**
	 * Dispose of platform resources
	 */
	async dispose(): Promise<void> {
		if (this.workerPool) {
			await this.workerPool.terminate();
			this.workerPool = undefined;
		}
	}
}

/**
 * Default export for easy importing
 */
export default NodePlatform;
