/**
 * Cloudflare Workers platform implementation for Shovel
 * 
 * Uses bundled adapters to avoid dynamic imports in Workers environment
 * Supports KV for caching and R2 for filesystem operations
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
} from "@b9g/platform";
import {FileSystemRegistry, getDirectoryHandle, MemoryBucket} from "@b9g/filesystem";

export interface CloudflarePlatformOptions extends PlatformConfig {
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
export class CloudflarePlatform extends BasePlatform {
	readonly name = "cloudflare";
	private options: Required<CloudflarePlatformOptions>;

	constructor(options: CloudflarePlatformOptions = {}) {
		super(options);
		this.options = {
			environment: "production",
			kvNamespaces: {},
			r2Buckets: {},
			d1Databases: {},
			durableObjects: {},
			...options,
		};

		// Register bundled filesystem adapters for Cloudflare Workers
		// We can't use dynamic imports in Workers, so we bundle what we need
		FileSystemRegistry.register("memory", new MemoryBucket());
		
		// R2 adapter registration is deferred to async initialization
		// since Cloudflare Workers don't support dynamic imports in constructors
	}

	/**
	 * Get filesystem directory handle (memory-only in Workers runtime)
	 */
	async getDirectoryHandle(name: string): Promise<FileSystemDirectoryHandle> {
		// In Cloudflare Workers, only memory filesystem is available at runtime
		// Static assets are served by Cloudflare CDN
		const adapter = new MemoryBucket();
		return await adapter.getDirectoryHandle(name);
	}

	/**
	 * Get platform-specific default cache configuration for Cloudflare Workers
	 */
	protected getDefaultCacheConfig(): CacheConfig {
		return {
			pages: { type: "cloudflare" }, // Use Cloudflare's native Cache API
			api: { type: "cloudflare" }, // Use Cloudflare's native Cache API
			static: { type: "cloudflare" }, // Static files handled by CDN
		};
	}

	/**
	 * Override cache creation to use bundled KV adapter
	 */
	async createCaches(config?: CacheConfig): Promise<CacheStorage> {
		// For Cloudflare Workers, we need to use bundled adapters
		// In production, we'd bundle the KV cache adapter
		
		// For now, return the native Cloudflare cache API
		// TODO: Implement bundled KV cache adapter
		return globalThis.caches;
	}


	/**
	 * Create "server" for Cloudflare Workers (which is really just the handler)
	 */
	createServer(handler: Handler, _options: ServerOptions = {}): Server {
		// Cloudflare Workers don't have servers - they are the handler
		// This is mainly for compatibility with the Platform interface

		return {
			async listen() {
				console.info("[Cloudflare] Worker handler ready");
			},
			async close() {
				console.info("[Cloudflare] Worker handler stopped");
			},
			address: () => ({port: 443, host: "cloudflare-workers"}),
			get url() {
				return "https://cloudflare-workers"; // Would be actual worker URL in production
			},
			get ready() {
				return true; // Cloudflare Workers are always ready
			},
		};
	}

	/**
	 * Load ServiceWorker-style entrypoint in Cloudflare Workers
	 * 
	 * Cloudflare Workers are already ServiceWorker-based, so we can use
	 * the global environment directly in production
	 */
	async loadServiceWorker(
		entrypoint: string,
		options: ServiceWorkerOptions = {},
	): Promise<ServiceWorkerInstance> {
		// Check if we're in a real Cloudflare Worker environment
		const isCloudflareWorker =
			typeof globalThis.addEventListener === "function" &&
			typeof globalThis.caches !== "undefined" &&
			typeof globalThis.FetchEvent !== "undefined";

		if (isCloudflareWorker) {
			console.info("[Cloudflare] Running in native ServiceWorker environment");

			// In a real Cloudflare Worker, we use the global environment directly
			const instance: ServiceWorkerInstance = {
				runtime: globalThis as any,
				handleRequest: async (request: Request) => {
					// Dispatch fetch event to the global handler
					const event = new FetchEvent("fetch", {request});
					globalThis.dispatchEvent(event);
					// TODO: Get response from event.respondWith() 
					return new Response("Worker handler", {status: 200});
				},
				install: () => Promise.resolve(),
				activate: () => Promise.resolve(),
				collectStaticRoutes: async () => [], // Not supported in Workers
				get ready() { return true; },
				dispose: async () => {},
			};

			// Import the entrypoint module (bundled)
			await import(entrypoint);
			return instance;
		} else {
			// Development environment - use the base platform implementation
			// This would use our ServiceWorker runtime simulation
			throw new Error("Cloudflare platform development mode not yet implemented. Use Node platform for development.");
		}
	}

	/**
	 * Get filesystem root for File System Access API
	 */
	async getFileSystemRoot(
		name = "default",
	): Promise<FileSystemDirectoryHandle> {
		// Use centralized filesystem registry (defaults to memory for Cloudflare)
		return await getDirectoryHandle(name);
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
