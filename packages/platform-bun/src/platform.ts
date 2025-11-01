/**
 * Bun platform implementation - ServiceWorker entrypoint loader for Bun
 *
 * Bun has built-in TypeScript/JSX support, so this is much simpler than Node.js.
 * Uses native imports instead of complex ESBuild VM system.
 */

import {
	Platform,
	CacheConfig,
	Handler,
	Server,
	ServerOptions,
	ServiceWorkerOptions,
	ServiceWorkerInstance,
	ServiceWorkerRuntime,
	createServiceWorkerGlobals,
} from "@b9g/platform";
import {CustomCacheStorage, PostMessageCache} from "@b9g/cache";
import {FileSystemRegistry, getFileSystemRoot, MemoryFileSystemAdapter} from "@b9g/filesystem";
// import {createStaticFilesHandler} from "@b9g/staticfiles"; // TODO: implement static files
import * as Path from "path";

export interface BunPlatformOptions {
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
export class BunPlatform implements Platform {
	readonly name = "bun";
	readonly capabilities = {
		hotReload: true,
		sourceMaps: true,
		filesystem: true,
		serverSideRendering: true,
		staticGeneration: true,
		s3Storage: true, // Bun's unique capability
	};

	private options: Required<BunPlatformOptions>;

	constructor(options: BunPlatformOptions = {}) {
		this.options = {
			hotReload: Bun.env.NODE_ENV !== "production",
			port: 3000,
			host: "localhost",
			cwd: process.cwd(),
			...options,
		};

		// Register memory filesystem adapter as default for Bun
		FileSystemRegistry.register("memory", new MemoryFileSystemAdapter());
	}

	/**
	 * Create cache storage optimized for Bun
	 */
	createCaches(config: CacheConfig = {}): CustomCacheStorage {
		// Use CustomCacheStorage with PostMessage coordination for Bun workers
		return new CustomCacheStorage((name: string) => {
			return new PostMessageCache(name, {
				maxEntries: config.maxEntries || 1000,
				maxSize: config.maxSize || 50 * 1024 * 1024, // 50MB
			});
		});
	}

	// TODO: Implement static files handler when @b9g/staticfiles is ready

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
			console.info(
				"[Bun] Hot reloading enabled - Bun will handle file watching",
			);

			// For hot reloading, we need to dynamically import and set up globals
			const loadModule = async () => {
				try {
					// Reset runtime for reload
					runtime.reset();

					// Create ServiceWorker globals
					createServiceWorkerGlobals(runtime);

					// Bun can import TypeScript/JSX directly
					globalThis.self = runtime;
					globalThis.addEventListener = runtime.addEventListener.bind(runtime);
					globalThis.removeEventListener =
						runtime.removeEventListener.bind(runtime);
					globalThis.dispatchEvent = runtime.dispatchEvent.bind(runtime);

					// Dynamic import to get fresh module
					const moduleUrl = `${entryPath}?t=${Date.now()}`;
					await import(moduleUrl);

					// Emit platform event
					const caches = options.caches
						? this.createCaches(options.caches)
						: undefined;
					runtime.emitPlatformEvent({
						platform: this.name,
						capabilities: this.capabilities,
						caches,
					});

					await runtime.install();
					await runtime.activate();

					console.info("[Bun] ServiceWorker loaded successfully");
				} catch (error) {
					console.error("[Bun] Failed to load ServiceWorker:", error);
				}
			};

			await loadModule();

			// TODO: Set up file watching for hot reloading
			// Bun doesn't have a built-in file watcher API like Node.js
			// We might need to use chokidar or similar
		} else {
			// Static loading
			createServiceWorkerGlobals(runtime);

			// Set up globals
			globalThis.self = runtime;
			globalThis.addEventListener = runtime.addEventListener.bind(runtime);
			globalThis.removeEventListener =
				runtime.removeEventListener.bind(runtime);
			globalThis.dispatchEvent = runtime.dispatchEvent.bind(runtime);

			// Import module
			await import(entryPath);

			// Emit platform event
			const caches = options.caches
				? this.createCaches(options.caches)
				: undefined;
			runtime.emitPlatformEvent({
				platform: this.name,
				capabilities: this.capabilities,
				caches,
			});

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
