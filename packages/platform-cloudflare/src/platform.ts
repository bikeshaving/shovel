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
import {CacheStorage} from "@b9g/cache/cache-storage";
import {MemoryCache} from "@b9g/cache/memory-cache";
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
 * Cloudflare Workers cache implementation using KV
 */
class CloudflareKVCache extends MemoryCache {
	constructor(
		name: string,
		private kv: any, // KVNamespace
		options: any = {},
	) {
		super(name, options);
	}

	async match(request: Request): Promise<Response | undefined> {
		const key = this.createKey(request);
		const value = await this.kv.get(key);
		return value ? new Response(value) : undefined;
	}

	async put(request: Request, response: Response): Promise<void> {
		const key = this.createKey(request);
		const value = await response.text();
		await this.kv.put(key, value, {
			expirationTtl: this.options.ttl
				? Math.floor(this.options.ttl / 1000)
				: undefined,
		});
	}

	private createKey(request: Request): string {
		return `cache:${this.name}:${new URL(request.url).pathname}`;
	}
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
	}

	/**
	 * Create cache storage using Cloudflare KV/Cache API
	 */
	createCaches(config: CacheConfig = {}): CacheStorage {
		const caches = new CacheStorage();

		// Use native Cache API if available
		if (typeof globalThis.caches !== "undefined") {
			// This should work automatically with native Cache API
			return globalThis.caches as any;
		}

		// Fallback to KV-based caching
		if (this.options.kvNamespaces) {
			for (const [name, kv] of Object.entries(this.options.kvNamespaces)) {
				caches.register(
					name,
					() => new CloudflareKVCache(name, kv, config[name]),
				);
			}
		}

		// Default memory cache for development
		caches.register(
			"memory",
			() =>
				new MemoryCache("memory", {
					maxEntries: config.maxEntries || 100, // Smaller for memory constraints
					maxSize: config.maxSize || 10 * 1024 * 1024, // 10MB
				}),
		);

		caches.setDefault("memory");
		return caches;
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
	createServer(handler: Handler, options: ServerOptions = {}): Server {
		// Cloudflare Workers don't have servers - they are the handler
		// This is mainly for compatibility with the Platform interface

		return {
			listen: () => {
				console.log("[Cloudflare] Worker handler ready");
				return Promise.resolve();
			},
			close: () => {
				console.log("[Cloudflare] Worker handler stopped");
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
			console.log("[Cloudflare] Running in native ServiceWorker environment");

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
			const globals = createServiceWorkerGlobals(runtime);
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
