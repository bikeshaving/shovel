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
import {getLogger} from "@logtape/logtape";
import type {Miniflare} from "miniflare";

// Internal @b9g/* packages
import {
	type PlatformDefaults,
	type Handler,
	type Server,
	type ServerOptions,
	type ServiceWorkerOptions,
	type ServiceWorkerInstance,
	type PlatformESBuildConfig,
	type EntryPoints,
	type ShovelServiceWorkerContainer,
} from "@b9g/platform";
import {type ShovelConfig} from "@b9g/platform/runtime";

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

/**
 * Stub ServiceWorkerContainer for Cloudflare
 * Cloudflare Workers don't use the same supervisor/worker model as Node/Bun.
 * This provides API compatibility but delegates to Miniflare for dev mode.
 */
class CloudflareServiceWorkerContainer
	extends EventTarget
	implements ShovelServiceWorkerContainer
{
	#platform: CloudflarePlatform;
	#instance: ServiceWorkerInstance | null;
	#readyPromise: Promise<ServiceWorkerRegistration>;
	#readyResolve?: (reg: ServiceWorkerRegistration) => void;

	readonly controller: ServiceWorker | null;
	oncontrollerchange: ((ev: Event) => unknown) | null;
	onmessage: ((ev: MessageEvent) => unknown) | null;
	onmessageerror: ((ev: MessageEvent) => unknown) | null;

	constructor(platform: CloudflarePlatform) {
		super();
		this.#platform = platform;
		this.#instance = null;
		this.#readyPromise = new Promise((resolve) => {
			this.#readyResolve = resolve;
		});
		this.controller = null;
		this.oncontrollerchange = null;
		this.onmessage = null;
		this.onmessageerror = null;
	}

	get ready(): Promise<ServiceWorkerRegistration> {
		return this.#readyPromise;
	}

	get pool() {
		return undefined; // Cloudflare doesn't use ServiceWorkerPool
	}

	/**
	 * Get the Miniflare instance for request handling
	 */
	get instance(): ServiceWorkerInstance | null {
		return this.#instance;
	}

	async register(
		scriptURL: string | URL,
		_options?: RegistrationOptions,
	): Promise<ServiceWorkerRegistration> {
		const url =
			typeof scriptURL === "string" ? scriptURL : scriptURL.toString();

		// Delegate to loadServiceWorker which uses Miniflare
		this.#instance = await this.#platform.loadServiceWorker(url);

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

		this.#readyResolve?.(registration);
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
		if (this.#instance) {
			await this.#instance.dispose();
			this.#instance = null;
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

/**
 * Cloudflare Workers platform implementation
 */
export class CloudflarePlatform {
	readonly name: string;
	readonly serviceWorker: CloudflareServiceWorkerContainer;
	#options: {
		environment: "production" | "preview" | "dev";
		assetsDirectory: string | undefined;
		cwd: string;
		config?: ShovelConfig;
		port: number;
		host: string;
	};
	#miniflare: Miniflare | null;
	#assetsMiniflare: Miniflare | null;

	constructor(options: CloudflarePlatformOptions = {}) {
		this.name = "cloudflare";
		this.#miniflare = null;
		this.#assetsMiniflare = null;
		this.serviceWorker = new CloudflareServiceWorkerContainer(this);

		const cwd = options.cwd ?? ".";

		this.#options = {
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
			port: this.#options.port,
			host: this.#options.host,
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
import { initializeRuntime, createFetchHandler } from "@b9g/platform-cloudflare/runtime";

// Initialize runtime first (installs ServiceWorker globals like addEventListener)
const registration = await initializeRuntime(config);

// Import user code (registers event handlers via self.addEventListener)
// Must be dynamic import to ensure it runs after initializeRuntime
await import(${safePath});

// Lifecycle deferred to first request (workerd doesn't allow setTimeout in global scope)
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
