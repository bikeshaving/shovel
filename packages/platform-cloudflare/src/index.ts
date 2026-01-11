/**
 * @b9g/platform-cloudflare - Cloudflare Workers platform adapter for Shovel
 *
 * Provides ServiceWorker-native deployment for Cloudflare Workers with KV/R2/D1 integration.
 *
 * Architecture:
 * - Uses ServiceWorkerGlobals from @b9g/platform for full feature parity with Node/Bun
 * - AsyncContext provides per-request access to Cloudflare's env/ctx
 * - Directories use R2 via lazy factory (accessed when directories.open() is called)
 * - Caches use Cloudflare's native Cache API
 */

// Platform imports (for CloudflarePlatform class - only used in Node.js context)
import {
	BasePlatform,
	PlatformConfig,
	type PlatformDefaults,
	Handler,
	Server,
	ServerOptions,
	ServiceWorkerOptions,
	ServiceWorkerInstance,
	EntryWrapperOptions,
	PlatformESBuildConfig,
	type ProductionEntryPoints,
	CustomLoggerStorage,
	type LoggerStorage,
} from "@b9g/platform";
import {createCacheFactory, type ShovelConfig} from "@b9g/platform/runtime";
import {CustomCacheStorage} from "@b9g/cache";
import type {DirectoryStorage} from "@b9g/filesystem";
import {getLogger} from "@logtape/logtape";
import type {Miniflare} from "miniflare";

const logger = getLogger(["shovel", "platform"]);

// Import CloudflareNativeCache for local use (in createCaches)
import {CloudflareNativeCache} from "./caches.js";

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
	/** Shovel configuration (caches, directories, etc.) */
	config?: ShovelConfig;
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
		config?: ShovelConfig;
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
			config: options.config,
		};
	}

	/**
	 * Create cache storage using config from shovel.json
	 * Default: Cloudflare's native Cache API
	 * Merges with runtime defaults (actual class references) for fallback behavior
	 */
	async createCaches(): Promise<CustomCacheStorage> {
		// Runtime defaults with actual class references (not module/export strings)
		const runtimeDefaults: Record<string, {impl: any}> = {
			default: {impl: CloudflareNativeCache},
		};
		const userCaches = this.#options.config?.caches ?? {};
		// Deep merge per entry so user can override options without losing impl
		const configs: Record<string, any> = {};
		const allNames = new Set([
			...Object.keys(runtimeDefaults),
			...Object.keys(userCaches),
		]);
		for (const name of allNames) {
			configs[name] = {...runtimeDefaults[name], ...userCaches[name]};
		}
		return new CustomCacheStorage(createCacheFactory({configs}));
	}

	/**
	 * Create directory storage for Cloudflare Workers
	 * Directories must be configured via shovel.json (no platform defaults)
	 */
	async createDirectories(): Promise<DirectoryStorage> {
		throw new Error(
			"Cloudflare Workers do not have default directories. " +
				"Configure directories in shovel.json using Cloudflare directory classes.",
		);
	}

	/**
	 * Create logger storage for Cloudflare Workers
	 */
	async createLoggers(): Promise<LoggerStorage> {
		return new CustomLoggerStorage((categories) => getLogger(categories));
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
		const assetsMf = this.#assetsMiniflare;

		// Create dispose function that also clears platform references
		const disposeInstance = async () => {
			await mf.dispose();
			this.#miniflare = null;
			if (assetsMf) {
				await assetsMf.dispose();
				this.#assetsMiniflare = null;
			}
		};

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
			dispose: disposeInstance,
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
		return `// Cloudflare Worker Entry
import { config } from "shovel:config";
import { initializeRuntime, createFetchHandler } from "@b9g/platform-cloudflare/runtime";

const registration = await initializeRuntime(config);

import ${safePath};

// Run ServiceWorker lifecycle (install/activate events for migrations, cache warmup, etc.)
await registration.install();
await registration.activate();

export default { fetch: createFetchHandler(registration) };
`;
	}

	/**
	 * Get production entry points for bundling.
	 *
	 * Cloudflare produces a single file:
	 * - server.js: Everything bundled inline (runtime + user code)
	 *
	 * Cloudflare Workers don't support spawning sub-workers, so everything
	 * must be in one file.
	 */
	getProductionEntryPoints(userEntryPath: string): ProductionEntryPoints {
		const safePath = JSON.stringify(userEntryPath);
		const serverCode = `// Cloudflare Worker Entry
import { config } from "shovel:config";
import { initializeRuntime, createFetchHandler } from "@b9g/platform-cloudflare/runtime";

const registration = await initializeRuntime(config);

// Import user code (bundled inline - this is a static import)
import ${safePath};

// Run ServiceWorker lifecycle
await registration.install();
await registration.activate();

export default { fetch: createFetchHandler(registration) };
`;

		return {
			worker: serverCode,
		};
	}

	/**
	 * Get Cloudflare-specific esbuild configuration
	 *
	 * Note: Cloudflare Workers natively support import.meta.env, so no define alias
	 * is needed. The nodejs_compat flag enables node:* built-in modules at runtime,
	 * so we externalize them during bundling.
	 */
	getESBuildConfig(): PlatformESBuildConfig {
		return {
			platform: "browser",
			conditions: ["worker", "browser"],
			// Externalize node builtins - available at runtime via nodejs_compat flag
			// Include both node:* prefix and bare module names for compatibility
			external: [
				"node:*",
				"path",
				"fs",
				"fs/promises",
				"crypto",
				"util",
				"stream",
				"buffer",
				"events",
			],
		};
	}

	/**
	 * Get Cloudflare-specific defaults for config generation
	 */
	getDefaults(): PlatformDefaults {
		return {
			caches: {
				default: {
					module: "@b9g/platform-cloudflare/caches",
				},
			},
			directories: {
				public: {
					module: "@b9g/platform-cloudflare/directories",
					export: "CloudflareAssetsDirectory",
				},
			},
		};
	}
}

export default CloudflarePlatform;
