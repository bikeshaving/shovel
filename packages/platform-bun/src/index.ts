/**
 * @b9g/platform-bun - Bun platform adapter for Shovel
 *
 * Provides built-in TypeScript/JSX support and simplified server setup for Bun environments.
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
	ServiceWorkerRegistration,
	ShovelGlobalScope,
	CustomBucketStorage,
	type BucketFactory,
} from "@b9g/platform";
import {WorkerPool, WorkerPoolOptions} from "@b9g/platform/worker-pool";
import {CustomCacheStorage, PostMessageCache} from "@b9g/cache";
import {FileSystemRegistry, MemoryBucket, NodeBucket} from "@b9g/filesystem";
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
	ServiceWorkerOptions,
	ServiceWorkerInstance,
} from "@b9g/platform";

// ============================================================================
// TYPES
// ============================================================================

export interface BunPlatformOptions extends PlatformConfig {
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
// IMPLEMENTATION
// ============================================================================

/**
 * Bun platform implementation
 * ServiceWorker entrypoint loader for Bun with native TypeScript/JSX support
 */
export class BunPlatform extends BasePlatform {
	readonly name = "bun";
	private options: Required<BunPlatformOptions>;
	private workerPool?: WorkerPool;
	private cacheStorage?: CustomCacheStorage;

	constructor(options: BunPlatformOptions = {}) {
		super(options);
		this.options = {
			hotReload: Bun.env.NODE_ENV !== "production",
			port: 3000,
			host: "localhost",
			cwd: process.cwd(),
			...options,
		};

		// Register filesystem adapters for Bun
		FileSystemRegistry.register("memory", new MemoryBucket());
		FileSystemRegistry.register(
			"node",
			new NodeBucket(Path.join(this.options.cwd, "dist")),
		);

		// Register standard tmp bucket using OS temp directory
		FileSystemRegistry.register("tmp", new NodeBucket(Os.tmpdir()));

		// Register Bun's native S3 adapter if available
		try {
			// Note: This is a placeholder for Bun's S3 adapter
			// The actual implementation would need to be imported from a Bun-specific package
			console.warn(
				"[Bun] S3 adapter not implemented yet, using memory filesystem",
			);
		} catch {
			console.warn("[Bun] S3Client not available, using memory filesystem");
		}
	}

	/**
	 * Build artifacts filesystem (install-time only)
	 */
	async getDirectoryHandle(name: string): Promise<FileSystemDirectoryHandle> {
		// Create dist filesystem pointing to ./dist directory
		const distPath = Path.resolve(this.options.cwd, "dist");
		const targetPath = name ? Path.join(distPath, name) : distPath;
		return new NodeBucket(targetPath);
	}

	/**
	 * Get platform-specific default cache configuration for Bun
	 */
	protected getDefaultCacheConfig(): CacheConfig {
		return {
			pages: {type: "memory"}, // PostMessage cache for coordination
			api: {type: "memory"},
			static: {type: "memory"},
		};
	}

	/**
	 * Override cache creation to use appropriate cache type for Bun
	 */
	async createCaches(config?: CacheConfig): Promise<CustomCacheStorage> {
		// Import MemoryCache for fallback
		const {MemoryCache} = await import("@b9g/cache");

		// Use platform-agnostic worker detection
		// In Bun, workers use self global while main thread doesn't
		const isWorkerThread =
			typeof self !== "undefined" && typeof window === "undefined";

		return new CustomCacheStorage((name: string) => {
			if (!isWorkerThread) {
				// Use MemoryCache in main thread
				return new MemoryCache(name, {
					maxEntries: 1000,
					maxAge: 60 * 60 * 1000, // 1 hour
				});
			} else {
				// Use PostMessageCache in worker threads
				return new PostMessageCache(name, {
					maxEntries: 1000,
					maxAge: 60 * 60 * 1000, // 1 hour
				});
			}
		});
	}

	/**
	 * Create HTTP server using Bun.serve
	 */
	createServer(handler: Handler, options: ServerOptions = {}): Server {
		const port = options.port ?? this.options.port;
		const hostname = options.host ?? this.options.host;

		// Bun.serve is much simpler than Node.js
		const server = Bun.serve({
			port,
			hostname,
			async fetch(request) {
				return handler(request);
			},
			development: this.options.hotReload,
		});

		return {
			async listen() {
				console.info(`🥖 Bun server running at http://${hostname}:${port}`);
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
		const entryPath = Path.resolve(this.options.cwd, entrypoint);

		// Create shared cache storage if not already created
		if (!this.cacheStorage) {
			this.cacheStorage = await this.createCaches(options.caches);
		}

		// Create WorkerPool using Bun's native Web Workers
		// Bun supports Web Workers natively - no shims needed!
		if (this.workerPool) {
			await this.workerPool.terminate();
		}

		const workerCount = options.workerCount || 1;
		const poolOptions: WorkerPoolOptions = {
			workerCount,
			requestTimeout: 30000,
			hotReload: this.options.hotReload,
			cwd: this.options.cwd,
		};

		// Bun has native Worker support - WorkerPool will use new Worker() directly
		this.workerPool = new WorkerPool(this.cacheStorage, poolOptions, entryPath);

		// Initialize workers (Bun has native Web Workers)
		await this.workerPool.init();

		// Load ServiceWorker in all workers
		const version = Date.now();
		await this.workerPool.reloadWorkers(version);

		const instance: ServiceWorkerInstance = {
			runtime: this.workerPool,
			handleRequest: async (request: Request) => {
				if (!this.workerPool) {
					throw new Error("WorkerPool not initialized");
				}
				return this.workerPool.handleRequest(request);
			},
			install: async () => {
				console.info("[Bun] ServiceWorker installed via native Web Workers");
			},
			activate: async () => {
				console.info("[Bun] ServiceWorker activated via native Web Workers");
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
				console.info("[Bun] ServiceWorker disposed");
			},
		};

		return instance;
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
export default BunPlatform;
