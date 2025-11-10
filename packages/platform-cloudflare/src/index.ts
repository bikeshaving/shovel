/**
 * @b9g/platform-cloudflare - Cloudflare Workers platform adapter for Shovel
 *
 * Provides ServiceWorker-native deployment for Cloudflare Workers with KV/R2/D1 integration.
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
import {
	FileSystemRegistry,
	getDirectoryHandle,
	MemoryBucket,
} from "@b9g/filesystem";

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

// ============================================================================
// PLATFORM IMPLEMENTATION
// ============================================================================

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
		return new MemoryBucket(name || "root");
	}

	/**
	 * Get platform-specific default cache configuration for Cloudflare Workers
	 */
	protected getDefaultCacheConfig(): CacheConfig {
		return {
			pages: {type: "cloudflare"}, // Use Cloudflare's native Cache API
			api: {type: "cloudflare"}, // Use Cloudflare's native Cache API
			static: {type: "cloudflare"}, // Static files handled by CDN
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
				get ready() {
					return true;
				},
				dispose: async () => {},
			};

			// Import the entrypoint module (bundled)
			await import(entrypoint);
			return instance;
		} else {
			// Development environment - use the base platform implementation
			// This would use our ServiceWorker runtime simulation
			throw new Error(
				"Cloudflare platform development mode not yet implemented. Use Node platform for development.",
			);
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

// ============================================================================
// WRANGLER INTEGRATION UTILITIES
// ============================================================================

/**
 * Create platform options from Wrangler environment
 */
export function createOptionsFromEnv(env: any): CloudflarePlatformOptions {
	return {
		environment: env.ENVIRONMENT || "production",
		kvNamespaces: extractKVNamespaces(env),
		r2Buckets: extractR2Buckets(env),
		d1Databases: extractD1Databases(env),
		durableObjects: extractDurableObjects(env),
	};
}

/**
 * Extract KV namespace bindings from environment
 */
function extractKVNamespaces(env: any): Record<string, any> {
	const kvNamespaces: Record<string, any> = {};

	// Look for common KV binding patterns
	for (const [key, value] of Object.entries(env)) {
		if (key.endsWith("_KV") || key.includes("KV")) {
			kvNamespaces[key] = value;
		}
	}

	return kvNamespaces;
}

/**
 * Extract R2 bucket bindings from environment
 */
function extractR2Buckets(env: any): Record<string, any> {
	const r2Buckets: Record<string, any> = {};

	for (const [key, value] of Object.entries(env)) {
		if (key.endsWith("_R2") || key.includes("R2")) {
			r2Buckets[key] = value;
		}
	}

	return r2Buckets;
}

/**
 * Extract D1 database bindings from environment
 */
function extractD1Databases(env: any): Record<string, any> {
	const d1Databases: Record<string, any> = {};

	for (const [key, value] of Object.entries(env)) {
		if (key.endsWith("_D1") || key.includes("D1") || key.endsWith("_DB")) {
			d1Databases[key] = value;
		}
	}

	return d1Databases;
}

/**
 * Extract Durable Object bindings from environment
 */
function extractDurableObjects(env: any): Record<string, any> {
	const durableObjects: Record<string, any> = {};

	for (const [key, value] of Object.entries(env)) {
		if (key.endsWith("_DO") || key.includes("DURABLE")) {
			durableObjects[key] = value;
		}
	}

	return durableObjects;
}

/**
 * Generate wrangler.toml configuration for a Shovel app from CLI flags
 */
export function generateWranglerConfig(options: {
	name: string;
	entrypoint: string;
	cacheAdapter?: string;
	filesystemAdapter?: string;
	kvNamespaces?: string[];
	r2Buckets?: string[];
	d1Databases?: string[];
}): string {
	const {
		name,
		entrypoint,
		cacheAdapter,
		filesystemAdapter,
		kvNamespaces = [],
		r2Buckets = [],
		d1Databases = [],
	} = options;

	// Auto-generate bindings based on CLI flags
	// Cache should use Cloudflare's native Cache API, not KV
	const autoKVNamespaces: string[] = []; // No KV needed for caching
	const autoR2Buckets = filesystemAdapter === "r2" ? ["STORAGE_R2"] : [];

	const allKVNamespaces = [...new Set([...kvNamespaces, ...autoKVNamespaces])];
	const allR2Buckets = [...new Set([...r2Buckets, ...autoR2Buckets])];

	return `# Generated wrangler.toml for Shovel app
name = "${name}"
main = "${entrypoint}"
compatibility_date = "2024-01-01"

# ServiceWorker format (since Shovel apps are ServiceWorker-style)
usage_model = "bundled"

# KV bindings${
		allKVNamespaces.length > 0
			? "\n" +
				allKVNamespaces
					.map(
						(kv) => `[[kv_namespaces]]
binding = "${kv}"
id = "your-kv-namespace-id"
preview_id = "your-preview-kv-namespace-id"`,
					)
					.join("\n\n")
			: ""
	}

# R2 bindings${
		allR2Buckets.length > 0
			? "\n" +
				allR2Buckets
					.map(
						(bucket) => `[[r2_buckets]]
binding = "${bucket}"
bucket_name = "your-bucket-name"`,
					)
					.join("\n\n")
			: ""
	}

# D1 bindings
${d1Databases
	.map(
		(db) => `[[d1_databases]]
binding = "${db}"
database_name = "your-database-name"
database_id = "your-database-id"`,
	)
	.join("\n\n")}
`;
}

// ============================================================================
// CLOUDFLARE WORKER WRAPPER UTILITIES
// ============================================================================

/**
 * Generate banner code for ServiceWorker → ES Module conversion
 */
export const cloudflareWorkerBanner = `// Cloudflare Worker ES Module wrapper
let serviceWorkerGlobals = null;

// Set up ServiceWorker environment
if (typeof globalThis.self === 'undefined') {
	globalThis.self = globalThis;
}

// Capture fetch event handlers
const fetchHandlers = [];
const originalAddEventListener = globalThis.addEventListener;
globalThis.addEventListener = function(type, handler, options) {
	if (type === 'fetch') {
		fetchHandlers.push(handler);
	} else {
		originalAddEventListener?.call(this, type, handler, options);
	}
};

// Create a promise-based FetchEvent that can be awaited
class FetchEvent {
	constructor(type, init) {
		this.type = type;
		this.request = init.request;
		this._response = null;
		this._responsePromise = new Promise((resolve) => {
			this._resolveResponse = resolve;
		});
	}
	
	respondWith(response) {
		this._response = response;
		this._resolveResponse(response);
	}
	
	async waitUntil(promise) {
		await promise;
	}
}`;

/**
 * Generate footer code for ServiceWorker → ES Module conversion
 */
export const cloudflareWorkerFooter = `
// Export ES Module for Cloudflare Workers
export default {
	async fetch(request, env, ctx) {
		try {
			// Set up ServiceWorker-like dirs API for bundled deployment
			if (!globalThis.self.dirs) {
				// For bundled deployment, assets are served via static middleware
				// not through the dirs API
				globalThis.self.dirs = {
					async open(directoryName) {
						if (directoryName === 'assets') {
							// Return a minimal interface that indicates no files available
							// The assets middleware will fall back to dev mode behavior
							return {
								async getFileHandle(fileName) {
									throw new Error(\`NotFoundError: \${fileName} not found in bundled assets\`);
								}
							};
						}
						throw new Error(\`Directory \${directoryName} not available in bundled deployment\`);
					}
				};
			}
			
			// Set up caches API
			if (!globalThis.self.caches) {
				globalThis.self.caches = globalThis.caches;
			}
			
			// Ensure request.url is a string
			if (typeof request.url !== 'string') {
				return new Response('Invalid request URL: ' + typeof request.url, { status: 500 });
			}
			
			// Create proper FetchEvent-like object
			let responseReceived = null;
			const event = { 
				request, 
				respondWith: (response) => { responseReceived = response; }
			};
			
			// Dispatch to ServiceWorker fetch handlers
			for (const handler of fetchHandlers) {
				try {
					console.log('[Wrapper] Calling handler for:', request.url);
					await handler(event);
					console.log('[Wrapper] Handler completed, response:', !!responseReceived);
					if (responseReceived) {
						return responseReceived;
					}
				} catch (error) {
					console.error('[Wrapper] Handler error:', error);
					console.error('[Wrapper] Error stack:', error.stack);
					// Return detailed error in response body for debugging
					return new Response(JSON.stringify({
						error: error.message,
						stack: error.stack,
						name: error.name,
						url: request.url
					}, null, 2), { 
						status: 500,
						headers: { 'Content-Type': 'application/json' }
					});
				}
			}
			
			return new Response('No ServiceWorker handler', { status: 404 });
		} catch (topLevelError) {
			console.error('[Wrapper] Top-level error:', topLevelError);
			return new Response(JSON.stringify({
				error: 'Top-level wrapper error: ' + topLevelError.message,
				stack: topLevelError.stack,
				name: topLevelError.name,
				url: request?.url || 'unknown'
			}, null, 2), { 
				status: 500,
				headers: { 'Content-Type': 'application/json' }
			});
		}
	}
};`;

/**
 * Default export for easy importing
 */
export default CloudflarePlatform;
