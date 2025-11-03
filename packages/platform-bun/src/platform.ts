/**
 * Bun platform implementation - ServiceWorker entrypoint loader for Bun
 *
 * Bun has built-in TypeScript/JSX support, so this is much simpler than Node.js.
 * Uses native imports instead of complex ESBuild VM system.
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
	ServiceWorkerRuntime,
	createServiceWorkerGlobals,
	createDirectoryStorage,
} from "@b9g/platform";
import {CustomCacheStorage, PostMessageCache} from "@b9g/cache";
import {FileSystemRegistry, getFileSystemRoot, MemoryFileSystemAdapter, NodeFileSystemAdapter, BunS3FileSystemAdapter} from "@b9g/filesystem";
import * as Path from "path";

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

/**
 * Bun platform implementation
 * ServiceWorker entrypoint loader for Bun with native TypeScript/JSX support
 */
export class BunPlatform extends BasePlatform {
	readonly name = "bun";
	private options: Required<BunPlatformOptions>;
	private _dist?: FileSystemDirectoryHandle;

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
		FileSystemRegistry.register("memory", new MemoryFileSystemAdapter());
		FileSystemRegistry.register("node", new NodeFileSystemAdapter({
			rootPath: Path.join(this.options.cwd, "dist")
		}));
		
		// Register Bun's native S3 adapter
		try {
			FileSystemRegistry.register("bun-s3", new BunS3FileSystemAdapter(
				// @ts-ignore - Bun's S3Client
				new Bun.S3Client({})
			));
		} catch {
			console.warn("[Bun] S3Client not available, using memory filesystem");
		}
	}

	/**
	 * Build artifacts filesystem (install-time only)
	 */
	async getDistDir(): Promise<FileSystemDirectoryHandle> {
		if (!this._dist) {
			// Create dist filesystem pointing to ./dist directory
			const distPath = Path.resolve(this.options.cwd, "dist");
			this._dist = await new NodeFileSystemAdapter({ rootPath: distPath }).getFileSystemRoot("");
		}
		return this._dist;
	}

	/**
	 * Get platform-specific default cache configuration for Bun
	 */
	protected getDefaultCacheConfig(): CacheConfig {
		return {
			pages: { type: "memory" }, // PostMessage cache for coordination
			api: { type: "memory" },
			static: { type: "memory" },
		};
	}

	/**
	 * Override cache creation to use appropriate cache type for Bun
	 */
	async createCaches(config?: CacheConfig): Promise<CustomCacheStorage> {
		// Import MemoryCache for fallback
		const { MemoryCache } = await import("@b9g/cache");
		
		// Use MemoryCache in main thread, PostMessageCache in workers
		const { isMainThread } = await import("worker_threads");
		
		return new CustomCacheStorage((name: string) => {
			if (isMainThread) {
				// Use MemoryCache in main thread
				return new MemoryCache(name, {
					maxEntries: 1000,
					maxSize: 50 * 1024 * 1024, // 50MB
				});
			} else {
				// Use PostMessageCache in worker threads
				return new PostMessageCache(name, {
					maxEntries: 1000,
					maxSize: 50 * 1024 * 1024, // 50MB
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
			listen: () => {
				console.info(`🥖 Bun server running at http://${hostname}:${port}`);
				return Promise.resolve();
			},
			close: () => {
				server.stop();
				return Promise.resolve();
			},
			address: () => ({port, host: hostname}),
		};
	}

	/**
	 * Load and run a ServiceWorker-style entrypoint with Bun
	 */
	async loadServiceWorker(
		entrypoint: string,
		options: ServiceWorkerOptions = {},
	): Promise<ServiceWorkerInstance> {
		const runtime = new ServiceWorkerRuntime();
		const entryPath = Path.resolve(this.options.cwd, entrypoint);

		// Create cache storage using platform configuration
		const caches = await this.createCaches(options.caches);
		
		// Create directory storage using dist filesystem
		const distDir = await this.getDistDir();
		const dirs = createDirectoryStorage(distDir);

		// Create ServiceWorker instance
		const instance: ServiceWorkerInstance = {
			runtime,
			handleRequest: (request: Request) => runtime.handleRequest(request),
			install: () => runtime.install(),
			activate: () => runtime.activate(),
			collectStaticRoutes: (outDir: string, baseUrl?: string) =>
				runtime.collectStaticRoutes(outDir, baseUrl),
			get ready() {
				return runtime.ready;
			},
			dispose: async () => {
				runtime.reset();
				// Bun handles cleanup automatically
			},
		};

		if (this.options.hotReload && options.hotReload !== false) {
			// Use Bun's built-in hot reloading
			console.info("[Bun] Hot reloading enabled - native TypeScript support");

			// For hot reloading, we need to dynamically import and set up globals
			const loadModule = async () => {
				try {
					// Reset runtime for reload
					runtime.reset();

					// Create ServiceWorker globals with platform resources
					createServiceWorkerGlobals(runtime, { caches, dirs });

					// Bun can import TypeScript/JSX directly
					globalThis.self = runtime;
					globalThis.addEventListener = runtime.addEventListener.bind(runtime);
					globalThis.removeEventListener = runtime.removeEventListener.bind(runtime);
					globalThis.dispatchEvent = runtime.dispatchEvent.bind(runtime);

					// Dynamic import to get fresh module (Bun supports this natively)
					const moduleUrl = `${entryPath}?t=${Date.now()}`;
					await import(moduleUrl);


					await runtime.install();
					await runtime.activate();

					console.info("[Bun] ServiceWorker loaded successfully");
				} catch (error) {
					console.error("[Bun] Failed to load ServiceWorker:", error);
				}
			};

			await loadModule();

			// TODO: Set up file watching for hot reloading
			// For now, rely on Bun's built-in module reload capability
		} else {
			// Static loading
			createServiceWorkerGlobals(runtime, { caches, dirs });

			// Set up globals
			globalThis.self = runtime;
			globalThis.addEventListener = runtime.addEventListener.bind(runtime);
			globalThis.removeEventListener = runtime.removeEventListener.bind(runtime);
			globalThis.dispatchEvent = runtime.dispatchEvent.bind(runtime);

			// Import module
			await import(entryPath);


			await runtime.install();
			await runtime.activate();
		}

		return instance;
	}

	/**
	 * Get filesystem root for File System Access API
	 */
	async getFileSystemRoot(
		name = "default",
	): Promise<FileSystemDirectoryHandle> {
		// Use centralized filesystem registry (defaults to memory for Bun)
		return await getFileSystemRoot(name);
	}

	/**
	 * Dispose of platform resources
	 */
	async dispose(): Promise<void> {
		// Bun handles cleanup automatically
	}
}

/**
 * Create a Bun platform instance
 */
export function createBunPlatform(options?: BunPlatformOptions): BunPlatform {
	return new BunPlatform(options);
}

/**
 * Default export for easy importing
 */
export default createBunPlatform;
