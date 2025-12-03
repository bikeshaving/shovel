/**
 * @b9g/platform - Platform interface for ServiceWorker entrypoint loading
 *
 * Platform = "ServiceWorker entrypoint loader for JavaScript runtimes"
 * Core responsibility: Take a ServiceWorker-style app file and make it run in this environment.
 */

import * as Path from "path";
import {readFileSync} from "fs";
import {CustomCacheStorage} from "@b9g/cache";
import {MemoryCache} from "@b9g/cache/memory";

// Runtime global declarations for platform detection
declare const Deno: any;
declare const window: any;

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Platform configuration
 * Extended by platform-specific implementations (NodePlatformOptions, etc.)
 */
export interface PlatformConfig {
	// Platform-specific configuration will be added here as needed
}

/**
 * Server options for platform implementations
 */
export interface ServerOptions {
	/** Port to listen on */
	port?: number;
	/** Host to bind to */
	host?: string;
	/** Development mode settings */
	development?: {
		/** Source maps support */
		sourceMaps?: boolean;
		/** Verbose logging */
		verbose?: boolean;
	};
}

/**
 * Request handler function (Web Fetch API compatible)
 */
export type Handler = (
	request: Request,
	context?: any,
) => Promise<Response> | Response;

/**
 * Server instance returned by platform.createServer()
 */
export interface Server {
	/** Start listening for requests */
	listen(): Promise<void>;
	/** Stop the server */
	close(): Promise<void>;
	/** Get server address information */
	address(): {port: number; host: string};
	/** Get server URL */
	readonly url: string;
	/** Whether server is ready to accept requests */
	readonly ready: boolean;
}

/**
 * ServiceWorker entrypoint options
 */
export interface ServiceWorkerOptions {
	/** Additional context to provide */
	context?: any;
	/** Number of worker threads (Node/Bun only) */
	workerCount?: number;
	/** Enable hot reload (dev mode) - forces worker mode for reliable reloading */
	hotReload?: boolean;
}

/**
 * ServiceWorker instance returned by platform
 */
export interface ServiceWorkerInstance {
	/** The ServiceWorker runtime */
	runtime: any; // WorkerPool or ServiceWorkerRegistration
	/** Handle HTTP request */
	handleRequest(request: Request): Promise<Response>;
	/** Install the ServiceWorker */
	install(): Promise<void>;
	/** Activate the ServiceWorker */
	activate(): Promise<void>;
	/** Check if ready to handle requests */
	readonly ready: boolean;
	/** Dispose of resources */
	dispose(): Promise<void>;
}

/**
 * Platform interface - ServiceWorker entrypoint loader for JavaScript runtimes
 *
 * The core responsibility: "Take a ServiceWorker-style app file and make it run in this environment"
 */
export interface Platform {
	/**
	 * Platform name for identification
	 */
	readonly name: string;

	/**
	 * Load and run a ServiceWorker-style entrypoint
	 * This is where all the platform-specific complexity lives
	 */
	loadServiceWorker(
		entrypoint: string,
		options?: ServiceWorkerOptions,
	): Promise<ServiceWorkerInstance>;

	/**
	 * SUPPORTING UTILITY - Create cache storage
	 * Returns empty CacheStorage - applications create caches on-demand via caches.open()
	 */
	createCaches(): Promise<CacheStorage>;

	/**
	 * SUPPORTING UTILITY - Create server instance for this platform
	 */
	createServer(handler: Handler, options?: ServerOptions): Server;
}

// ============================================================================
// Platform Detection
// ============================================================================

/**
 * Platform registry - internal implementation
 */
interface PlatformRegistry {
	/** Register a platform implementation */
	register(name: string, platform: any): void;
	/** Get platform by name */
	get(name: string): any | undefined;
	/** Get all registered platforms */
	list(): string[];
}

/**
 * Detect the current JavaScript runtime
 */
export function detectRuntime(): "bun" | "deno" | "node" {
	if (typeof Bun !== "undefined" || process.versions?.bun) {
		return "bun";
	}

	if (typeof Deno !== "undefined") {
		return "deno";
	}

	// Default to Node.js
	return "node";
}

/**
 * Detect platform from package.json dependencies
 * When multiple platforms are installed, prioritize based on current runtime
 * @param cwd - Current working directory (optional, only available in Node/Bun)
 */
function detectPlatformFromPackageJSON(cwd?: string): string | null {
	// Skip if no cwd and process.cwd unavailable (e.g., edge runtimes)
	if (!cwd && typeof process === "undefined") {
		return null;
	}

	try {
		// eslint-disable-next-line no-restricted-properties
		const pkgPath = Path.join(cwd || process.cwd(), "package.json");
		const pkgContent = readFileSync(pkgPath, "utf8");
		const pkg = JSON.parse(pkgContent);
		const deps = {...pkg.dependencies, ...pkg.devDependencies};

		return selectPlatformFromDeps(deps);
	} catch (err) {
		// Only ignore file-not-found errors, rethrow others
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
			throw err;
		}
		return null;
	}
}

/**
 * Select best platform from dependencies based on current runtime
 * When multiple platforms are installed (e.g., monorepo), prefer the one matching current runtime
 */
function selectPlatformFromDeps(deps: Record<string, any>): string | null {
	const hasBun = deps["@b9g/platform-bun"];
	const hasNode = deps["@b9g/platform-node"];
	const hasCloudflare = deps["@b9g/platform-cloudflare"];

	// If only one platform installed, use it
	const installedCount = [hasBun, hasNode, hasCloudflare].filter(
		Boolean,
	).length;
	if (installedCount === 0) return null;
	if (installedCount === 1) {
		if (hasBun) return "bun";
		if (hasNode) return "node";
		if (hasCloudflare) return "cloudflare";
	}

	// Multiple platforms installed - prioritize based on current runtime
	const runtime = detectRuntime();

	// Match runtime to platform (prefer exact match)
	if (runtime === "bun" && hasBun) return "bun";
	if (runtime === "node" && hasNode) return "node";

	// Fallback order when no exact match (development-friendly first)
	if (hasBun) return "bun";
	if (hasNode) return "node";
	if (hasCloudflare) return "cloudflare";

	return null;
}

/**
 * Detect deployment platform from environment
 *
 * Supports:
 * - Cloudflare Workers
 *
 * Future platforms (Lambda, Vercel, Netlify, Deno) will be added post-launch
 */
export function detectDeploymentPlatform(): string | null {
	// Explicitly check we're NOT in Node.js/Bun first
	// (Node now has fetch/caches globals, so can't rely on them alone)
	if (
		typeof process !== "undefined" &&
		(process.versions?.node || process.versions?.bun)
	) {
		return null; // Running in Node.js or Bun, not a deployment platform
	}

	// Cloudflare Workers - has web APIs but no process global
	if (
		typeof caches !== "undefined" &&
		typeof addEventListener !== "undefined" &&
		typeof fetch !== "undefined" &&
		// Ensure we're not in a browser
		typeof window === "undefined"
	) {
		return "cloudflare";
	}

	return null;
}

/**
 * Detect platform for development
 *
 * Priority:
 * 1. Check package.json for installed @b9g/platform-* package
 * 2. Fallback to current runtime (bun/node/deno)
 */
export function detectDevelopmentPlatform(): string {
	// First, check if user has explicitly installed a platform package
	const pkgPlatform = detectPlatformFromPackageJSON();
	if (pkgPlatform) {
		return pkgPlatform;
	}

	// Fallback to runtime detection (for monorepos or when no platform installed)
	const runtime = detectRuntime();

	switch (runtime) {
		case "bun":
			return "bun";
		case "deno":
			return "deno";
		case "node":
		default:
			return "node";
	}
}

/**
 * Resolve platform name from options, config, or auto-detect
 *
 * Priority:
 * 1. Explicit --platform or --target CLI flag
 * 2. shovel.json or package.json "shovel.platform" field
 * 3. Deployment platform detection (production environments)
 * 4. Development platform detection (local runtime)
 */
export function resolvePlatform(options: {
	platform?: string;
	target?: string;
	config?: {platform?: string};
}): string {
	// Explicit CLI platform takes precedence
	if (options.platform) {
		return options.platform;
	}

	// Target for build/deploy scenarios
	if (options.target) {
		return options.target;
	}

	// Config file platform (shovel.json or package.json)
	if (options.config?.platform) {
		return options.config.platform;
	}

	// Try to detect deployment platform (Lambda, Vercel, etc.)
	const deploymentPlatform = detectDeploymentPlatform();
	if (deploymentPlatform) {
		return deploymentPlatform;
	}

	// Fallback to development platform (bun, node, deno)
	return detectDevelopmentPlatform();
}

/**
 * Create platform instance based on name
 */
export async function createPlatform(
	platformName: string,
	options: any = {},
): Promise<any> {
	switch (platformName) {
		case "node": {
			const modulePath = import.meta.resolve("@b9g/platform-node");
			const NodePlatform = await import(modulePath).then((m) => m.default);
			return new NodePlatform(options);
		}

		case "bun": {
			const modulePath = import.meta.resolve("@b9g/platform-bun");
			const BunPlatform = await import(modulePath).then((m) => m.default);
			return new BunPlatform(options);
		}

		case "cloudflare":
		case "cloudflare-workers":
		case "cf": {
			const modulePath = import.meta.resolve("@b9g/platform-cloudflare");
			const CloudflarePlatform = await import(modulePath).then(
				(m) => m.default,
			);
			return new CloudflarePlatform(options);
		}

		default:
			throw new Error(
				`Unknown platform: ${platformName}. Available platforms: node, bun, cloudflare`,
			);
	}
}

// ============================================================================
// Base Platform Class
// ============================================================================

/**
 * Base platform class with shared adapter loading logic
 * Platform implementations extend this and provide platform-specific methods
 */
export abstract class BasePlatform implements Platform {
	config: PlatformConfig;

	constructor(config: PlatformConfig = {}) {
		this.config = config;
	}

	abstract readonly name: string;
	abstract loadServiceWorker(entrypoint: string, options?: any): Promise<any>;
	abstract createServer(handler: any, options?: any): any;

	/**
	 * Create cache storage
	 * Returns empty CacheStorage - applications create caches on-demand via caches.open()
	 */
	async createCaches(): Promise<CacheStorage> {
		// Return CacheStorage with memory cache factory
		// Applications call caches.open("name") to create caches on-demand
		return new CustomCacheStorage(
			(name: string) => new MemoryCache(name),
		) as CacheStorage;
	}
}

// ============================================================================
// Platform Registry
// ============================================================================

/**
 * Global platform registry
 */
class DefaultPlatformRegistry implements PlatformRegistry {
	#platforms: Map<string, Platform>;

	constructor() {
		this.#platforms = new Map<string, Platform>();
	}

	register(name: string, platform: Platform): void {
		this.#platforms.set(name, platform);
	}

	get(name: string): Platform | undefined {
		return this.#platforms.get(name);
	}

	list(): string[] {
		return Array.from(this.#platforms.keys());
	}
}

/**
 * Global platform registry instance
 */
export const platformRegistry = new DefaultPlatformRegistry();

/**
 * Get platform by name with error handling
 */
export function getPlatform(name?: string): Platform {
	if (name) {
		const platform = platformRegistry.get(name);
		if (!platform) {
			const available = platformRegistry.list();
			throw new Error(
				`Platform '${name}' not found. Available platforms: ${available.join(", ")}`,
			);
		}
		return platform;
	}

	// Auto-detect platform from environment
	const platformName =
		detectDeploymentPlatform() || detectDevelopmentPlatform();
	const platform = platformRegistry.get(platformName);

	if (!platform) {
		throw new Error(
			`Detected platform '${platformName}' not registered. Please register it manually or specify a platform name.`,
		);
	}

	return platform;
}

/**
 * Get platform with async auto-registration fallback
 */
export async function getPlatformAsync(name?: string): Promise<Platform> {
	if (name) {
		const platform = platformRegistry.get(name);
		if (!platform) {
			const available = platformRegistry.list();
			throw new Error(
				`Platform '${name}' not found. Available platforms: ${available.join(", ")}`,
			);
		}
		return platform;
	}

	// Auto-detect platform from environment
	const platformName =
		detectDeploymentPlatform() || detectDevelopmentPlatform();
	const platform = platformRegistry.get(platformName);

	if (!platform) {
		throw new Error(
			`Detected platform '${platformName}' not registered. Please register it manually using platformRegistry.register().`,
		);
	}

	return platform;
}

// ============================================================================
// Re-exports from other modules
// ============================================================================

// Worker pool
export {
	ServiceWorkerPool,
	type WorkerPoolOptions,
	type WorkerMessage,
	type WorkerRequest,
	type WorkerResponse,
	type WorkerLoadMessage,
	type WorkerReadyMessage,
	type WorkerErrorMessage,
	type WorkerInitMessage,
	type WorkerInitializedMessage,
} from "./worker-pool.js";

// Single-threaded runtime (for workerCount === 1)
export {
	SingleThreadedRuntime,
	type SingleThreadedRuntimeOptions,
} from "./single-threaded.js";

// ServiceWorker runtime
export {
	ShovelServiceWorkerRegistration,
	ShovelGlobalScope,
	FetchEvent,
	InstallEvent,
	ActivateEvent,
	ExtendableEvent,
} from "./runtime.js";

// Cookie Store API
export {
	RequestCookieStore,
	type CookieListItem,
	type CookieInit,
	type CookieStoreGetOptions,
	type CookieStoreDeleteOptions,
	type CookieSameSite,
	type CookieList,
	parseCookieHeader,
	serializeCookie,
	parseSetCookieHeader,
} from "./cookie-store.js";

// Filesystem utilities
export {CustomBucketStorage} from "@b9g/filesystem";

// Config utilities
export {
	loadConfig,
	configureLogging,
	getCacheConfig,
	getBucketConfig,
	parseConfigExpr,
	processConfigValue,
	matchPattern,
	createBucketFactory,
	createCacheFactory,
	type ShovelConfig,
	type CacheConfig,
	type BucketConfig,
	type LoggingConfig,
	type LogLevel,
	type BucketFactoryOptions,
	type CacheFactoryOptions,
	type ProcessedShovelConfig,
} from "./config.js";
