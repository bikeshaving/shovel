/**
 * Cloudflare Workers platform implementation for Shovel
 *
 * This is interesting - Cloudflare Workers are already ServiceWorker-based!
 * So our ServiceWorker-style apps might run with minimal adaptation.
 */

import {
	Platform,
	CacheConfig,
	StaticConfig,
	Handler,
	Server,
	ServerOptions,
	ServiceWorkerOptions,
	ServiceWorkerInstance,
	ServiceWorkerRuntime,
	createServiceWorkerGlobals,
} from "@b9g/platform";
import {FileSystemRegistry, getFileSystemRoot, MemoryFileSystemAdapter} from "@b9g/filesystem";
import {createStaticFilesHandler} from "@b9g/staticfiles";

export interface CloudflarePlatformOptions {
	/** Cloudflare Workers environment (production, preview, dev) */
	environment?: "production" | "preview" | "dev";
	/** KV namespace bindings */
	kvNamespaces?: Record<string, any>;
	/** R2 bucket bindings */
	r2Buckets?: Record<string, any>;
	/** D1 database bindings */
	d1Databases?: Record<string, any>;
	/** Durable Object bindings */
	durableObjects?: Record<string, any>;
}


/**
 * Cloudflare Workers platform implementation
 */
export class CloudflarePlatform implements Platform {
	readonly name = "cloudflare";
	readonly capabilities = {
		hotReload: false, // Not available in Workers
		sourceMaps: true,
		filesystem: false, // No filesystem access
		serverSideRendering: true,
		staticGeneration: false, // Workers are for dynamic content
	};

	private options: CloudflarePlatformOptions;

	constructor(options: CloudflarePlatformOptions = {}) {
		this.options = {
			environment: "production",
			...options,
		};

		// Register R2 filesystem adapter if R2 bucket is available
		if (this.options.r2Buckets?.default) {
			// Dynamically import R2 adapter to avoid unnecessary dependency
			import("@b9g/filesystem-r2").then(({R2FileSystemAdapter}) => {
				FileSystemRegistry.register("r2", new R2FileSystemAdapter(this.options.r2Buckets!.default));
			}).catch(() => {
				// R2 filesystem package not available, fall back to memory
				FileSystemRegistry.register("memory", new MemoryFileSystemAdapter());
			});
		} else {
			// No R2 bucket available, use memory filesystem
			FileSystemRegistry.register("memory", new MemoryFileSystemAdapter());
		}
	}

	/**
	 * Create cache storage using Cloudflare's native Cache API
	 */
	createCaches(config: CacheConfig = {}): CacheStorage {
		// Return native CacheStorage directly - it already implements the interface
		return globalThis.caches;
	}

	/**
	 * Create static files handler for Cloudflare Workers
	 */
	createStaticHandler(config: StaticConfig = {}): Handler {
		// In Cloudflare Workers, static files are usually handled by the CDN
		// or served from R2/KV, not from a filesystem
		return createStaticFilesHandler({
			outputDir: config.outputDir || "dist/static",
			publicPath: config.publicPath || "/static/",
			manifest: config.manifest || "dist/static-manifest.json",
			dev: false, // Always production in Workers
			cache: {
				name: config.cacheName || "memory",
				ttl: config.cacheTtl || 86400,
			},
		});
	}

	/**
	 * Create "server" for Cloudflare Workers (which is really just the handler)
	 */
	createServer(handler: Handler, _options: ServerOptions = {}): Server {
		// Cloudflare Workers don't have servers - they are the handler
		// This is mainly for compatibility with the Platform interface

		return {
			listen: () => {
				console.info("[Cloudflare] Worker handler ready");
				return Promise.resolve();
			},
			close: () => {
				console.info("[Cloudflare] Worker handler stopped");
				return Promise.resolve();
			},
			address: () => ({port: 0, host: "cloudflare-workers"}),
		};
	}

	/**
	 * Load ServiceWorker-style entrypoint in Cloudflare Workers
	 *
	 * This is interesting - Cloudflare Workers are already ServiceWorker-based,
	 * so we might not need much adaptation!
	 */
	async loadServiceWorker(
		entrypoint: string,
		options: ServiceWorkerOptions = {},
	): Promise<ServiceWorkerInstance> {
		// In Cloudflare Workers, we ARE the ServiceWorker!
		// The global environment already has addEventListener, etc.

		// Check if we're actually in a Cloudflare Worker environment
		const isCloudflareWorker =
			typeof globalThis.addEventListener === "function" &&
			typeof globalThis.caches !== "undefined";

		if (isCloudflareWorker) {
			// We're in a real Cloudflare Worker - just use the global environment
			console.info("[Cloudflare] Running in native ServiceWorker environment");

			const instance: ServiceWorkerInstance = {
				runtime: globalThis as any, // The global is already the ServiceWorker runtime
				handleRequest: async (request: Request) => {
					// In Cloudflare Workers, we dispatch fetch events to the global
					const event = new FetchEvent("fetch", {request});
					globalThis.dispatchEvent(event);
					return event.response || new Response("No handler", {status: 500});
				},
				install: () => Promise.resolve(), // Already installed
				activate: () => Promise.resolve(), // Already activated
				collectStaticRoutes: async () => [], // Not supported in Workers
				get ready() {
					return true;
				},
				dispose: async () => {}, // Nothing to dispose
			};

			// Load the entrypoint module
			await import(entrypoint);

			return instance;
		} else {
			// We're in development/build environment - use our ServiceWorker runtime
			const runtime = new ServiceWorkerRuntime();

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
				},
			};

			// Set up ServiceWorker globals
			createServiceWorkerGlobals(runtime);
			globalThis.self = runtime;
			globalThis.addEventListener = runtime.addEventListener.bind(runtime);
			globalThis.removeEventListener =
				runtime.removeEventListener.bind(runtime);
			globalThis.dispatchEvent = runtime.dispatchEvent.bind(runtime);

			// Import the entrypoint
			await import(entrypoint);

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

			return instance;
		}
	}

	/**
	 * Get filesystem root for File System Access API
	 */
	async getFileSystemRoot(
		name = "default",
	): Promise<FileSystemDirectoryHandle> {
		// Use centralized filesystem registry (defaults to memory for Cloudflare)
		return await getFileSystemRoot(name);
	}

	/**
	 * Dispose of platform resources
	 */
	async dispose(): Promise<void> {
		// Nothing to dispose in Cloudflare Workers
	}
}

/**
 * Create a Cloudflare platform instance
 */
export function createCloudflarePlatform(
	options?: CloudflarePlatformOptions,
): CloudflarePlatform {
	return new CloudflarePlatform(options);
}

/**
 * Default export for easy importing
 */
export default createCloudflarePlatform;
