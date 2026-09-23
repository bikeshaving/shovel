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

// External packages
// Internal @b9g/* packages
import type {
	EntryPoints,
	Handler,
	PlatformDefaults,
	PlatformESBuildConfig,
	Server,
	ServerOptions,
	ServiceWorkerInstance,
	ServiceWorkerOptions,
	ShovelServiceWorkerContainer,
} from "@b9g/platform";
import type {ShovelConfig} from "@b9g/platform/runtime";
import {getLogger} from "@logtape/logtape";
import type {Miniflare} from "miniflare";

const logger = getLogger(["shovel", "platform"]);

// Re-export common platform types
export type {
	Handler,
	Server,
	ServerOptions,
	ServiceWorkerOptions,
	ServiceWorkerInstance,
} from "@b9g/platform";

// ============================================================================
// TYPES
// ============================================================================

export interface CloudflarePlatformOptions {
	/** Port for development server (default: 7777) */
	port?: number;

	/** Host for development server (default: localhost) */
	host?: string;

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
// SERVICE WORKER CONTAINER (stub for Cloudflare - uses Miniflare internally)
// ============================================================================

const kPlatform = Symbol("platform");
const kInstance = Symbol("instance");
const kReadyPromise = Symbol("readyPromise");
const kReadyResolve = Symbol("readyResolve");

interface CloudflareServiceWorkerContainer {
	[kPlatform]: CloudflarePlatform;
	[kInstance]: ServiceWorkerInstance | null;
	[kReadyPromise]: Promise<ServiceWorkerRegistration>;
	[kReadyResolve]?: (reg: ServiceWorkerRegistration) => void;
}

/**
 * Stub ServiceWorkerContainer for Cloudflare
 * Cloudflare Workers don't use the same supervisor/worker model as Node/Bun.
 * This provides API compatibility but delegates to Miniflare for dev mode.
 */
class CloudflareServiceWorkerContainer
	extends EventTarget
	implements ShovelServiceWorkerContainer {
	readonly controller: ServiceWorker | null;
	oncontrollerchange: ((ev: Event) => unknown) | null;
	onmessage: ((ev: MessageEvent) => unknown) | null;
	onmessageerror: ((ev: MessageEvent) => unknown) | null;

	constructor(platform: CloudflarePlatform) {
		super();
		this[kPlatform] = platform;
		this[kInstance] = null;
		this[kReadyPromise] = new Promise((resolve) => {
			this[kReadyResolve] = resolve;
		});
		this.controller = null;
		this.oncontrollerchange = null;
		this.onmessage = null;
		this.onmessageerror = null;
	}

	get ready(): Promise<ServiceWorkerRegistration> {
		return this[kReadyPromise];
	}

	get pool(): {handleRequest(request: Request): Promise<Response>} | undefined {
		return undefined; // Cloudflare doesn't use ServiceWorkerPool
	}

	/**
	 * Get the Miniflare instance for request handling
	 */
	get instance(): ServiceWorkerInstance | null {
		return this[kInstance];
	}

	async register(
		scriptURL: string | URL,
		_options?: RegistrationOptions,
	): Promise<ServiceWorkerRegistration> {
		const url = typeof scriptURL === "string"
			? scriptURL
			: scriptURL.toString();

		// Delegate to loadServiceWorker which uses Miniflare
		this[kInstance] = await this[kPlatform].loadServiceWorker(url);

		// Create a mock registration to satisfy the interface
		const registration = {
			scope: "/",
			installing: null,
			waiting: null,
			active: null,
			navigationPreload: {} as NavigationPreloadManager,
			onupdatefound: null,
			update: async () => {},
			unregister: async () => true,
			addEventListener: () => {},
			removeEventListener: () => {},
			dispatchEvent: () => true,
		} as unknown as ServiceWorkerRegistration;

		this[kReadyResolve]?.(registration);
		return registration;
	}

	async getRegistration(): Promise<ServiceWorkerRegistration | undefined> {
		return undefined;
	}

	async getRegistrations(): Promise<readonly ServiceWorkerRegistration[]> {
		return [];
	}

	startMessages(): void {}

	async terminate(): Promise<void> {
		// Dispose Miniflare instance
		if (this[kInstance]) {
			await this[kInstance].dispose();
			this[kInstance] = null;
		}
	}

	async reloadWorkers(_entrypoint: string): Promise<void> {
		// For Cloudflare, reloading requires restarting Miniflare
		// This is typically handled by file watchers in development
		logger.debug("Cloudflare hot reload requires Miniflare restart");
	}
}

// ============================================================================
// PLATFORM IMPLEMENTATION (for miniflare dev mode)
// ============================================================================

const kOptions = Symbol("options");
const kMiniflare = Symbol("miniflare");
const kAssetsMiniflare = Symbol("assetsMiniflare");

export interface CloudflarePlatform {
	[kOptions]: {
		environment: "production" | "preview" | "dev";
		assetsDirectory: string | undefined;
		cwd: string;
		config?: ShovelConfig;
		port: number;
		host: string;
	};
	[kMiniflare]: Miniflare | null;
	[kAssetsMiniflare]: Miniflare | null;
}

/**
 * Cloudflare Workers platform implementation
 */
export class CloudflarePlatform {
	readonly name: string;
	readonly serviceWorker: CloudflareServiceWorkerContainer;

	constructor(options: CloudflarePlatformOptions = {}) {
		this.name = "cloudflare";
		this[kMiniflare] = null;
		this[kAssetsMiniflare] = null;
		this.serviceWorker = new CloudflareServiceWorkerContainer(this);

		const cwd = options.cwd ?? ".";

		this[kOptions] = {
			environment: options.environment ?? "production",
			assetsDirectory: options.assetsDirectory,
			cwd,
			config: options.config,
			port: options.port ?? 7777,
			host: options.host ?? "localhost",
		};
	}

	/**
	 * Create "server" for Cloudflare Workers (stub for Platform interface)
	 */
	createServer(_handler: Handler, _options: ServerOptions = {}): Server {
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
	 * Start HTTP server (Cloudflare uses Miniflare's built-in server)
	 * Returns a stub server since Miniflare manages its own listener
	 */
	async listen(): Promise<Server> {
		// Miniflare handles its own HTTP server, return a stub
		return this.createServer(() => new Response("Miniflare handles requests"));
	}

	/**
	 * Close server (terminates Miniflare via serviceWorker container)
	 */
	async close(): Promise<void> {
		await this.serviceWorker.terminate();
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
			// Start HTTP server for development
			port: this[kOptions].port,
			host: this[kOptions].host,
		};

		this[kMiniflare] = new Miniflare(miniflareOptions);
		await this[kMiniflare].ready;

		if (this[kOptions].assetsDirectory) {
			logger.info("Setting up ASSETS binding", {
				directory: this[kOptions].assetsDirectory,
			});

			this[kAssetsMiniflare] = new Miniflare({
				modules: true,
				script: `export default { fetch() { return new Response("assets-only"); } }`,
				assets: {directory: this[kOptions].assetsDirectory, binding: "ASSETS"},
				compatibilityDate: "2024-09-23",
			});

			await this[kAssetsMiniflare].ready;
		}

		const mf = this[kMiniflare];
		const assetsMf = this[kAssetsMiniflare];

		// Create dispose function that also clears platform references
		const disposeInstance = async () => {
			await mf.dispose();
			this[kMiniflare] = null;
			if (assetsMf) {
				await assetsMf.dispose();
				this[kAssetsMiniflare] = null;
			}
		};

		const instance: ServiceWorkerInstance = {
			runtime: mf,
			handleRequest: async (request: Request) => {
				const dispatchFetch = mf.dispatchFetch as unknown as (
					url: string,
					init: RequestInit & {duplex?: "half"},
				) => Promise<Response>;
				const cfResponse = await dispatchFetch(request.url, {
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
		if (this[kMiniflare]) {
			await this[kMiniflare].dispose();
			this[kMiniflare] = null;
		}
		if (this[kAssetsMiniflare]) {
			await this[kAssetsMiniflare].dispose();
			this[kAssetsMiniflare] = null;
		}
	}

	/**
	 * Get entry points for bundling.
	 *
	 * Cloudflare produces a single file for both dev and prod:
	 * - worker.js: Everything bundled inline (runtime + user code)
	 *
	 * Cloudflare Workers don't support spawning sub-workers, so everything
	 * must be in one file. Dev and prod are identical because workerd
	 * doesn't allow setTimeout in global scope, so lifecycle must be
	 * deferred to first request in both cases.
	 */
	getEntryPoints(
		userEntryPath: string,
		_mode: "development" | "production",
	): EntryPoints {
		const safePath = JSON.stringify(userEntryPath);
		const serverCode = `// Cloudflare Worker Entry
import { config } from "shovel:config";
import __shovelAssetsManifest from "shovel:assets";
import { initializeRuntime, createFetchHandler, setAssetsManifest } from "@b9g/platform-cloudflare/runtime";

// Register the build's asset manifest so directory handles can enumerate
// ASSETS without importing the virtual module from library code (which
// breaks consumers bundling outside a shovel build).
setAssetsManifest(__shovelAssetsManifest);

// Initialize runtime first (installs ServiceWorker globals like addEventListener)
const registration = await initializeRuntime(config);

// Import user code (registers event handlers via self.addEventListener)
// Must be dynamic import to ensure it runs after initializeRuntime
await import(${safePath});

// Lifecycle deferred to first request (workerd doesn't allow setTimeout in global scope)
export default { fetch: createFetchHandler(registration) };
`;

		return {worker: serverCode};
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
				"cloudflare:*",
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
				"*": {
					module: "@b9g/platform-cloudflare/caches",
					export: "CloudflareNativeCache",
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
