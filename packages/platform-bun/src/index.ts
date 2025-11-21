/**
 * @b9g/platform-bun - Bun platform adapter for Shovel
 *
 * Provides built-in TypeScript/JSX support and simplified server setup for Bun environments.
 */

// Runtime global declaration for platform detection
declare const window: any;

import {
	BasePlatform,
	PlatformConfig,
	Handler,
	Server,
	ServerOptions,
	ServiceWorkerOptions,
	ServiceWorkerInstance,
	ServiceWorkerPool,
	WorkerPoolOptions,
} from "@b9g/platform";
import {CustomCacheStorage} from "@b9g/cache";
import {PostMessageCache} from "@b9g/cache/postmessage.js";
import {FileSystemRegistry} from "@b9g/filesystem";
import {NodeBucket} from "@b9g/filesystem/node.js";
import * as Path from "path";
import * as Os from "os";
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
	#cacheStorage?: CustomCacheStorage;

	constructor(options: BunPlatformOptions = {}) {
		super(options);
		this.name = "bun";
		this.#options = {
			port: 3000,
			host: "localhost",
			cwd: process.cwd(),
			...options,
		};

		// Register well-known filesystem buckets
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
	 * Build artifacts filesystem (install-time only)
	 */
	async getDirectoryHandle(name: string): Promise<FileSystemDirectoryHandle> {
		// Create dist filesystem pointing to ./dist directory
		const distPath = Path.resolve(this.#options.cwd, "dist");
		const targetPath = name ? Path.join(distPath, name) : distPath;
		return new NodeBucket(targetPath);
	}

	/**
	 * Override cache creation to use appropriate cache type for Bun
	 */
	async createCaches(): Promise<CustomCacheStorage> {
		// Import MemoryCache for fallback
		const {MemoryCache} = await import("@b9g/cache/memory.js");

		// Use platform-agnostic worker detection
		// In Bun, workers use self global while main thread doesn't
		const isWorkerThread =
			typeof self !== "undefined" && typeof window === "undefined";

		return new CustomCacheStorage((name: string) => {
			if (!isWorkerThread) {
				// Use MemoryCache in main thread
				return new MemoryCache(name, {
					maxEntries: 1000,
				});
			} else {
				// Use PostMessageCache in worker threads
				return new PostMessageCache(name, {
					maxEntries: 1000,
				});
			}
		});
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
				return handler(request);
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
		const entryPath = Path.resolve(this.#options.cwd, entrypoint);

		// Create shared cache storage if not already created
		if (!this.#cacheStorage) {
			this.#cacheStorage = await this.createCaches();
		}

		// Create WorkerPool using Bun's native Web Workers
		// Bun supports Web Workers natively - no shims needed!
		if (this.#workerPool) {
			await this.#workerPool.terminate();
		}

		const workerCount = options.workerCount || 1;
		const poolOptions: WorkerPoolOptions = {
			workerCount,
			requestTimeout: 30000,
			cwd: this.#options.cwd,
		};

		// Bun has native Worker support - ServiceWorkerPool will use new Worker() directly
		this.#workerPool = new ServiceWorkerPool(
			poolOptions,
			entryPath,
			this.#cacheStorage,
		);

		// Initialize workers (Bun has native Web Workers)
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

		return instance;
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
export default BunPlatform;
