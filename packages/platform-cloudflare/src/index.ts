/**
 * @b9g/platform-cloudflare - Cloudflare Workers platform adapter for Shovel
 *
 * Provides ServiceWorker-native deployment for Cloudflare Workers with KV/R2/D1 integration.
 *
 * Architecture:
 * - Uses ServiceWorkerGlobals from @b9g/platform for full feature parity with Node/Bun
 * - AsyncContext provides per-request access to Cloudflare's env/ctx
 * - Buckets use R2 via lazy factory (accessed when buckets.open() is called)
 * - Caches use Cloudflare's native Cache API
 */

// Platform imports (for CloudflarePlatform class - only used in Node.js context)
import {
	BasePlatform,
	PlatformConfig,
	Handler,
	Server,
	ServerOptions,
	ServiceWorkerOptions,
	ServiceWorkerInstance,
	EntryWrapperOptions,
	PlatformEsbuildConfig,
} from "@b9g/platform";
import {CustomCacheStorage} from "@b9g/cache";

// Runtime imports (for bundled worker - browser-compatible)
// These are imported separately to keep runtime code browser-safe
import {
	ServiceWorkerGlobals,
	ShovelServiceWorkerRegistration,
} from "@b9g/platform/runtime";
import {CustomBucketStorage} from "@b9g/filesystem";
import {AsyncContext} from "@b9g/async-context";
import {getLogger} from "@logtape/logtape";
import type {Miniflare} from "miniflare";
import type {R2Bucket} from "./filesystem-r2.js";
import {R2FileSystemDirectoryHandle} from "./filesystem-r2.js";
import type {ExecutionContext} from "./cloudflare-runtime.js";

const logger = getLogger(["server"]);

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
// PER-REQUEST CONTEXT (AsyncContext)
// ============================================================================

/**
 * Cloudflare Workers pass `env` and `ctx` to each request handler.
 * We store these in AsyncContext so they can be accessed anywhere in the request.
 */

/** Per-request storage for Cloudflare's env object (KV, R2, D1 bindings) */
const envStorage = new AsyncContext.Variable<Record<string, unknown>>();

/** Per-request storage for Cloudflare's ExecutionContext */
const ctxStorage = new AsyncContext.Variable<ExecutionContext>();

/**
 * Get the current request's Cloudflare env object
 * Contains all bindings: KV namespaces, R2 buckets, D1 databases, etc.
 */
export function getEnv<T = Record<string, unknown>>(): T | undefined {
	return envStorage.get() as T | undefined;
}

/**
 * Get the current request's Cloudflare ExecutionContext
 * Used for ctx.waitUntil() and other lifecycle methods
 */
export function getCtx(): ExecutionContext | undefined {
	return ctxStorage.get();
}

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
// CLOUDFLARE RUNTIME SETUP (for bundled workers)
// ============================================================================

// Module-level state for the runtime (initialized once when module loads)
let _registration: ShovelServiceWorkerRegistration | null = null;
let _globals: ServiceWorkerGlobals | null = null;

/**
 * Initialize the Cloudflare runtime with ServiceWorkerGlobals
 * Called once when the worker module loads (before user code runs)
 *
 * This sets up:
 * - ServiceWorkerGlobals (caches, buckets, cookieStore, addEventListener, etc.)
 * - Per-request env/ctx via AsyncContext
 */
export function initializeRuntime(): ShovelServiceWorkerRegistration {
	if (_registration) {
		return _registration;
	}

	// Create registration (captures addEventListener('fetch', ...))
	_registration = new ShovelServiceWorkerRegistration();

	// Create bucket storage with lazy R2 factory
	// The factory accesses env via AsyncContext when buckets.open() is called
	const buckets = new CustomBucketStorage(createCloudflareR2BucketFactory());

	// Create ServiceWorkerGlobals with:
	// - Our registration
	// - Cloudflare's native caches (already available globally)
	// - R2-backed bucket storage
	_globals = new ServiceWorkerGlobals({
		registration: _registration,
		caches: globalThis.caches, // Use Cloudflare's native Cache API
		buckets,
	});

	// Install globals (caches, buckets, cookieStore, addEventListener, etc.)
	_globals.install();

	return _registration;
}

/**
 * Create the ES module fetch handler for Cloudflare Workers
 * This wraps requests with AsyncContext so env/ctx are available everywhere
 */
export function createFetchHandler(
	registration: ShovelServiceWorkerRegistration,
): (
	request: Request,
	env: unknown,
	ctx: ExecutionContext,
) => Promise<Response> {
	return async (
		request: Request,
		env: unknown,
		ctx: ExecutionContext,
	): Promise<Response> => {
		// Run request with env/ctx available via AsyncContext
		return envStorage.run(env as Record<string, unknown>, () =>
			ctxStorage.run(ctx, async () => {
				try {
					return await registration.handleRequest(request);
				} catch (error) {
					console.error("ServiceWorker error:", error);
					const err = error instanceof Error ? error : new Error(String(error));

					// Dev mode: show detailed error
					const isDev =
						typeof import.meta !== "undefined" &&
						import.meta.env?.MODE !== "production";
					if (isDev) {
						return new Response(
							`<!DOCTYPE html>
<html>
<head><title>500 Internal Server Error</title>
<style>body{font-family:system-ui;padding:2rem;max-width:800px;margin:0 auto}h1{color:#c00}pre{background:#f5f5f5;padding:1rem;overflow-x:auto}</style>
</head>
<body>
<h1>500 Internal Server Error</h1>
<p>${escapeHtml(err.message)}</p>
<pre>${escapeHtml(err.stack || "No stack trace")}</pre>
</body></html>`,
							{status: 500, headers: {"Content-Type": "text/html"}},
						);
					}

					return new Response("Internal Server Error", {status: 500});
				}
			}),
		);
	};
}

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/**
 * Create a bucket factory for Cloudflare that uses R2 bindings
 *
 * The factory is called lazily when buckets.open(name) is called.
 * At that point, `env` is available via AsyncContext.
 *
 * Bucket name -> R2 binding mapping:
 * - Default: bucket name uppercased with "_R2" suffix (e.g., "uploads" -> "UPLOADS_R2")
 */
function createCloudflareR2BucketFactory() {
	return async (name: string): Promise<FileSystemDirectoryHandle> => {
		const env = getEnv();
		if (!env) {
			throw new Error(
				`Cannot access bucket "${name}": Cloudflare env not available. ` +
					`This usually means you're trying to access buckets outside of a request context.`,
			);
		}

		// Default binding name convention: "uploads" -> "UPLOADS_R2"
		const bindingName = `${name.toUpperCase()}_R2`;
		const r2Bucket = env[bindingName] as R2Bucket | undefined;

		if (!r2Bucket) {
			throw new Error(
				`R2 bucket binding "${bindingName}" not found in env. ` +
					`Configure in wrangler.toml:\n\n` +
					`[[r2_buckets]]\n` +
					`binding = "${bindingName}"\n` +
					`bucket_name = "your-bucket-name"`,
			);
		}

		return new R2FileSystemDirectoryHandle(r2Bucket, "");
	};
}

// ============================================================================
// PLATFORM IMPLEMENTATION (for miniflare dev mode)
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
	#assetsMiniflare: Miniflare | null;

	constructor(options: CloudflarePlatformOptions = {}) {
		super(options);
		this.#miniflare = null;
		this.#assetsMiniflare = null;
		this.name = "cloudflare";

		const cwd = options.cwd ?? ".";

		this.#options = {
			environment: options.environment ?? "production",
			assetsDirectory: options.assetsDirectory,
			cwd,
		};
	}

	/**
	 * Create cache storage
	 * Uses Cloudflare's native Cache API
	 */
	async createCaches(): Promise<CustomCacheStorage> {
		// Use Cloudflare's native caches (only available in Worker context)
		return new CustomCacheStorage(async (name: string) => {
			if (globalThis.caches) {
				return globalThis.caches.open(name);
			}
			throw new Error("Cloudflare caches not available in this context");
		});
	}

	/**
	 * Create "server" for Cloudflare Workers (stub for Platform interface)
	 */
	createServer(handler: Handler, _options: ServerOptions = {}): Server {
		return {
			async listen() {
				logger.info("Worker handler ready", {});
			},
			async close() {
				logger.info("Worker handler stopped", {});
			},
			address: () => ({port: 443, host: "cloudflare-workers"}),
			get url() {
				return "https://cloudflare-workers";
			},
			get ready() {
				return true;
			},
		};
	}

	/**
	 * Load ServiceWorker using miniflare (workerd) for dev mode
	 */
	async loadServiceWorker(
		entrypoint: string,
		_options: ServiceWorkerOptions = {},
	): Promise<ServiceWorkerInstance> {
		logger.info("Starting miniflare dev server", {entrypoint});

		const {Miniflare} = await import("miniflare");

		// Use ES modules format - our bundled worker exports default handler
		const miniflareOptions: ConstructorParameters<typeof Miniflare>[0] = {
			modules: true,
			scriptPath: entrypoint,
			compatibilityDate: "2024-09-23",
			compatibilityFlags: ["nodejs_compat"],
		};

		this.#miniflare = new Miniflare(miniflareOptions);
		await this.#miniflare.ready;

		if (this.#options.assetsDirectory) {
			logger.info("Setting up ASSETS binding", {
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
		}

		const mf = this.#miniflare;

		const instance: ServiceWorkerInstance = {
			runtime: mf,
			handleRequest: async (request: Request) => {
				const cfResponse = await (mf.dispatchFetch as Function)(request.url, {
					method: request.method,
					headers: request.headers,
					body: request.body,
					duplex: request.body ? "half" : undefined,
				});
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

	/**
	 * Get virtual entry wrapper for Cloudflare Workers
	 *
	 * Wraps user code with:
	 * 1. Config import (shovel:config virtual module)
	 * 2. Runtime initialization (ServiceWorkerGlobals)
	 * 3. User code import (registers fetch handlers)
	 * 4. ES module export for Cloudflare Workers format
	 *
	 * Note: Unlike Node/Bun, Cloudflare bundles user code inline, so the
	 * entryPath is embedded directly in the wrapper.
	 */
	getEntryWrapper(entryPath: string, _options?: EntryWrapperOptions): string {
		// Use JSON.stringify to safely escape the path (prevents code injection)
		const safePath = JSON.stringify(entryPath);
		return `// Cloudflare Worker Entry - uses ServiceWorkerGlobals for feature parity with Node/Bun
import { initializeRuntime, createFetchHandler } from "@b9g/platform-cloudflare/cloudflare-runtime";
import { config } from "shovel:config"; // Virtual module - resolved at build time

// Config available for caches/buckets provider configuration
// (Cloudflare doesn't use port/host/workers from config)
void config;

// Initialize runtime BEFORE user code (installs globals like addEventListener)
const registration = initializeRuntime();

// Import user's ServiceWorker code (calls addEventListener('fetch', ...))
import ${safePath};

// Export ES module handler for Cloudflare Workers
export default {
	fetch: createFetchHandler(registration)
};
`;
	}

	/**
	 * Get Cloudflare-specific esbuild configuration
	 *
	 * Note: Cloudflare Workers natively support import.meta.env, so no define alias
	 * is needed. The nodejs_compat flag enables node:* built-in modules at runtime,
	 * so we externalize them during bundling.
	 */
	getEsbuildConfig(): PlatformEsbuildConfig {
		return {
			platform: "browser",
			conditions: ["worker", "browser"],
			// Externalize node:* builtins - available at runtime via nodejs_compat flag
			external: ["node:*"],
			// Cloudflare bundles user code inline via `import "user-entry"`
			bundlesUserCodeInline: true,
		};
	}
}

// ============================================================================
// WRANGLER UTILITIES
// ============================================================================

export function createOptionsFromEnv(env: any): CloudflarePlatformOptions {
	return {
		environment: env.ENVIRONMENT || "production",
	};
}

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
		filesystemAdapter,
		kvNamespaces = [],
		r2Buckets = [],
		d1Databases = [],
	} = options;

	const autoR2Buckets = filesystemAdapter === "r2" ? ["STORAGE_R2"] : [];
	const allKVNamespaces = [...new Set(kvNamespaces)];
	const allR2Buckets = [...new Set([...r2Buckets, ...autoR2Buckets])];

	return `# Generated wrangler.toml for Shovel app
name = "${name}"
main = "${entrypoint}"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]

${allKVNamespaces.length > 0 ? allKVNamespaces.map((kv) => `[[kv_namespaces]]\nbinding = "${kv}"\nid = "your-kv-id"`).join("\n\n") : "# No KV namespaces configured"}

${allR2Buckets.length > 0 ? allR2Buckets.map((bucket) => `[[r2_buckets]]\nbinding = "${bucket}"\nbucket_name = "your-bucket-name"`).join("\n\n") : "# No R2 buckets configured"}

${d1Databases.length > 0 ? d1Databases.map((db) => `[[d1_databases]]\nbinding = "${db}"\ndatabase_name = "your-db-name"\ndatabase_id = "your-db-id"`).join("\n\n") : "# No D1 databases configured"}
`;
}

export default CloudflarePlatform;
