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
	loadConfig,
	createCacheFactory,
	type ProcessedShovelConfig,
} from "@b9g/platform";
import {CustomCacheStorage} from "@b9g/cache";
import {getLogger} from "@logtape/logtape";
import type {Miniflare} from "miniflare";

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
	/** Working directory for config file resolution */
	cwd?: string;
}

// ============================================================================
// PLATFORM IMPLEMENTATION
// ============================================================================

/**
 * Cloudflare Workers platform implementation
 */
export class CloudflarePlatform extends BasePlatform {
	readonly name: string;
	#options: {
		environment: "production" | "preview" | "dev";
		assetsDirectory: string | undefined;
		cwd: string;
	};
	#miniflare: Miniflare | null;
	#assetsMiniflare: Miniflare | null; // Separate instance for ASSETS binding
	#config: ProcessedShovelConfig;

	constructor(options: CloudflarePlatformOptions = {}) {
		super(options);
		this.#miniflare = null;
		this.#assetsMiniflare = null;
		this.name = "cloudflare";

		const cwd = options.cwd ?? ".";
		this.#config = loadConfig(cwd);

		this.#options = {
			environment: options.environment ?? "production",
			assetsDirectory: options.assetsDirectory,
			cwd,
		};
	}

	/**
	 * Create cache storage
	 * Uses config from shovel.json with memory cache default.
	 *
	 * Note: This is for the platform/test runner context. Inside actual
	 * Cloudflare Workers, native caches are available via globalThis.caches
	 * (captured by the banner as globalThis.__cloudflareCaches).
	 */
	async createCaches(): Promise<CustomCacheStorage> {
		return new CustomCacheStorage(
			createCacheFactory({config: this.#config, defaultProvider: "cloudflare"}),
		);
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
	 * Load ServiceWorker-style entrypoint using miniflare (workerd)
	 *
	 * Note: In production Cloudflare Workers, the banner/footer wrapper code
	 * handles request dispatch directly - loadServiceWorker is only used for
	 * local development with miniflare.
	 */
	async loadServiceWorker(
		entrypoint: string,
		_options: ServiceWorkerOptions = {},
	): Promise<ServiceWorkerInstance> {
		return this.#loadServiceWorkerWithMiniflare(entrypoint);
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

			await this.#assetsMiniflare.ready;
			logger.info("ASSETS binding available", {});
		}

		const mf = this.#miniflare;

		const instance: ServiceWorkerInstance = {
			runtime: mf,
			handleRequest: async (request: Request) => {
				// Miniflare's dispatchFetch has Cloudflare-specific types that differ from
				// standard web types. Use explicit any cast to bridge the type systems.
				const cfResponse = await (mf.dispatchFetch as Function)(request.url, {
					method: request.method,
					headers: request.headers,
					body: request.body,
					duplex: request.body ? "half" : undefined,
				});
				// Convert Cloudflare-specific Response to standard Response
				return new Response(cfResponse.body as BodyInit | null, {
					status: cfResponse.status,
					statusText: cfResponse.statusText,
					headers: cfResponse.headers as HeadersInit,
				});
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
	};
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

// Capture native Cloudflare caches before any framework code runs
const nativeCaches = globalThis.caches;

// Set up ServiceWorker environment
if (typeof globalThis.self === 'undefined') {
	globalThis.self = globalThis;
}

// Store native caches for access via globalThis.__cloudflareCaches
globalThis.__cloudflareCaches = nativeCaches;

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
			
			// Helper for error responses
			const createErrorResponse = (err) => {
				const isDev = typeof import.meta !== "undefined" && import.meta.env?.MODE !== "production";
				if (isDev) {
					const escapeHtml = (str) => str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
					return new Response(\`<!DOCTYPE html>
<html>
<head>
  <title>500 Internal Server Error</title>
  <style>
    body { font-family: system-ui, sans-serif; padding: 2rem; max-width: 800px; margin: 0 auto; }
    h1 { color: #c00; }
    .message { font-size: 1.2em; color: #333; }
    pre { background: #f5f5f5; padding: 1rem; overflow-x: auto; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>500 Internal Server Error</h1>
  <p class="message">\${escapeHtml(err.message)}</p>
  <pre>\${escapeHtml(err.stack || "No stack trace available")}</pre>
</body>
</html>\`, { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } });
				} else {
					return new Response("Internal Server Error", { status: 500, headers: { "Content-Type": "text/plain" } });
				}
			};

			// Dispatch to ServiceWorker fetch handlers
			for (const handler of fetchHandlers) {
				try {
					await handler(event);
					if (responseReceived) {
						return responseReceived;
					}
				} catch (error) {
					console.error("Handler error:", error);
					return createErrorResponse(error);
				}
			}

			return new Response('No ServiceWorker handler', { status: 404 });
		} catch (topLevelError) {
			console.error("Top-level error:", topLevelError);
			const isDev = typeof import.meta !== "undefined" && import.meta.env?.MODE !== "production";
			if (isDev) {
				const escapeHtml = (str) => String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
				return new Response(\`<!DOCTYPE html>
<html>
<head>
  <title>500 Internal Server Error</title>
  <style>
    body { font-family: system-ui, sans-serif; padding: 2rem; max-width: 800px; margin: 0 auto; }
    h1 { color: #c00; }
    .message { font-size: 1.2em; color: #333; }
    pre { background: #f5f5f5; padding: 1rem; overflow-x: auto; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>500 Internal Server Error</h1>
  <p class="message">\${escapeHtml(topLevelError.message)}</p>
  <pre>\${escapeHtml(topLevelError.stack || "No stack trace available")}</pre>
</body>
</html>\`, { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } });
			} else {
				return new Response("Internal Server Error", { status: 500, headers: { "Content-Type": "text/plain" } });
			}
		}
	}
};`;

/**
 * Default export for easy importing
 */
export default CloudflarePlatform;
