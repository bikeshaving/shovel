/**
 * @b9g/platform-cloudflare - Cloudflare Workers platform adapter for Shovel
 *
 * Provides ServiceWorker-native deployment for Cloudflare Workers with KV/R2/D1 integration.
 */

import {
	BasePlatform,
	PlatformConfig,
	Handler,
	Server,
	ServerOptions,
	ServiceWorkerOptions,
	ServiceWorkerInstance,
} from "@b9g/platform";
import {getLogger} from "@logtape/logtape";
import type {Miniflare} from "miniflare";
import type {CFAssetsBinding} from "./filesystem-assets.js";

const logger = getLogger(["platform-cloudflare"]);

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

export interface CloudflarePlatformOptions extends PlatformConfig {
	/** Cloudflare Workers environment (production, preview, dev) */
	environment?: "production" | "preview" | "dev";
	/** Static assets directory for ASSETS binding (dev mode) */
	assetsDirectory?: string;
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
	readonly name: string;
	#options: Required<CloudflarePlatformOptions>;
	#miniflare: Miniflare | null = null;
	#assetsMiniflare: Miniflare | null = null; // Separate instance for ASSETS binding
	#assetsBinding: CFAssetsBinding | null = null;

	constructor(options: CloudflarePlatformOptions = {}) {
		super(options);
		this.name = "cloudflare";
		this.#options = {
			environment: "production",
			assetsDirectory: undefined as any,
			kvNamespaces: {},
			r2Buckets: {},
			d1Databases: {},
			durableObjects: {},
			...options,
		};
	}

	/**
	 * Create "server" for Cloudflare Workers (which is really just the handler)
	 */
	createServer(handler: Handler, _options: ServerOptions = {}): Server {
		// Cloudflare Workers don't have servers - they are the handler
		// This is mainly for compatibility with the Platform interface

		return {
			async listen() {
				logger.info("Worker handler ready", {});
			},
			async close() {
				logger.info("Worker handler stopped", {});
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
	 * In production: Uses the native CF Worker environment
	 * In dev mode: Uses miniflare (workerd) for true dev/prod parity
	 */
	async loadServiceWorker(
		entrypoint: string,
		_options: ServiceWorkerOptions = {},
	): Promise<ServiceWorkerInstance> {
		// Check if we're in a real Cloudflare Worker environment
		const isCloudflareWorker =
			typeof globalThis.addEventListener === "function" &&
			typeof globalThis.caches !== "undefined" &&
			typeof globalThis.FetchEvent !== "undefined";

		if (isCloudflareWorker) {
			logger.info("Running in native ServiceWorker environment", {});

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
				get ready() {
					return true;
				},
				dispose: async () => {},
			};

			// Import the entrypoint module (bundled)
			await import(entrypoint);
			return instance;
		} else {
			// Development mode - use miniflare
			return this.#loadServiceWorkerWithMiniflare(entrypoint);
		}
	}

	/**
	 * Load ServiceWorker using miniflare (workerd) for dev mode
	 */
	async #loadServiceWorkerWithMiniflare(
		entrypoint: string,
	): Promise<ServiceWorkerInstance> {
		logger.info("Starting miniflare dev server", {entrypoint});

		// Dynamic import miniflare (dev dependency)
		const {Miniflare} = await import("miniflare");

		// Configure miniflare for the worker
		const miniflareOptions: ConstructorParameters<typeof Miniflare>[0] = {
			modules: false, // ServiceWorker format (not ES modules)
			scriptPath: entrypoint,
			// Enable CF-compatible APIs
			compatibilityDate: "2024-09-23",
			compatibilityFlags: ["nodejs_compat"],
		};

		// Create miniflare instance for the worker
		this.#miniflare = new Miniflare(miniflareOptions);

		// Trigger initialization to catch configuration errors early
		await this.#miniflare.ready;

		// If assets directory is configured, create a separate miniflare instance
		// just for the ASSETS binding (to avoid routing conflicts)
		if (this.#options.assetsDirectory) {
			logger.info("Setting up separate ASSETS binding", {
				directory: this.#options.assetsDirectory,
			});

			this.#assetsMiniflare = new Miniflare({
				modules: true,
				script: `export default { fetch() { return new Response("assets-only"); } }`,
				assets: {
					directory: this.#options.assetsDirectory,
					binding: "ASSETS",
				},
				compatibilityDate: "2024-09-23",
			});

			const assetsEnv = await this.#assetsMiniflare.getBindings();
			if (assetsEnv.ASSETS) {
				this.#assetsBinding = assetsEnv.ASSETS as CFAssetsBinding;
				logger.info("ASSETS binding available", {});
			}
		}

		const mf = this.#miniflare;

		const instance: ServiceWorkerInstance = {
			runtime: mf,
			handleRequest: async (request: Request) => {
				return mf.dispatchFetch(request);
			},
			install: () => Promise.resolve(),
			activate: () => Promise.resolve(),
			get ready() {
				return true;
			},
			dispose: async () => {
				await mf.dispose();
			},
		};

		logger.info("Miniflare dev server ready", {});
		return instance;
	}

	/**
	 * Dispose of platform resources
	 */
	async dispose(): Promise<void> {
		if (this.#miniflare) {
			await this.#miniflare.dispose();
			this.#miniflare = null;
		}
		if (this.#assetsMiniflare) {
			await this.#assetsMiniflare.dispose();
			this.#assetsMiniflare = null;
		}
		this.#assetsBinding = null;
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
		cacheAdapter: _cacheAdapter,
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
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]

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
					logger.debug("Calling handler", {url: request.url});
					await handler(event);
					logger.debug("Handler completed", {hasResponse: !!responseReceived});
					if (responseReceived) {
						return responseReceived;
					}
				} catch (error) {
					logger.error("Handler error", {error});
					logger.error("Error stack", {stack: error.stack});
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
			logger.error("Top-level error", {error: topLevelError});
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
