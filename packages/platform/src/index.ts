/**
 * @b9g/platform - Platform interface for ServiceWorker entrypoint loading
 *
 * Platform = "ServiceWorker entrypoint loader for JavaScript runtimes"
 * Core responsibility: Take a ServiceWorker-style app file and make it run in this environment.
 *
 * This module is BROWSER-SAFE - no fs/path imports.
 */

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
 * Options for getEntryWrapper()
 * Reserved for future platform-specific options.
 */

export interface EntryWrapperOptions {
	// Currently empty - platforms may add options as needed
}

/**
 * Esbuild configuration subset that platforms can customize
 */
export interface PlatformEsbuildConfig {
	/** Target platform: "node" or "browser" */
	platform?: "node" | "browser" | "neutral";
	/** Export conditions for package.json resolution */
	conditions?: string[];
	/** External modules to exclude from bundle */
	external?: string[];
	/** Compile-time defines */
	define?: Record<string, string>;
	/**
	 * Whether the entry wrapper imports user code inline (bundled together)
	 * or references it as a separate file (loaded at runtime).
	 *
	 * - true: User code is imported inline (e.g., Cloudflare: `import "user-entry"`)
	 * - false: User code is loaded separately (e.g., Node/Bun: `loadServiceWorker("./server.js")`)
	 *
	 * Default: false (separate build)
	 */
	bundlesUserCodeInline?: boolean;
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

	/**
	 * BUILD SUPPORT - Get virtual entry wrapper template for user code
	 *
	 * Returns a JavaScript/TypeScript string that:
	 * 1. Initializes platform-specific runtime (polyfills, globals)
	 * 2. Imports the user's entrypoint
	 * 3. Exports any required handlers (e.g., ES module export for Cloudflare)
	 *
	 * The CLI uses this to create a virtual entry point for bundling.
	 * Every platform must provide a wrapper - there is no "raw user code" mode.
	 *
	 * @param entryPath - Absolute path to user's entrypoint file
	 * @param options - Additional options
	 */
	getEntryWrapper(entryPath: string, options?: EntryWrapperOptions): string;

	/**
	 * BUILD SUPPORT - Get platform-specific esbuild configuration
	 *
	 * Returns partial esbuild config that the CLI merges with common settings.
	 * Includes platform target, conditions, externals, and defines.
	 */
	getEsbuildConfig(): PlatformEsbuildConfig;
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
 * Detect platform for development based on current runtime
 */
export function detectDevelopmentPlatform(): string {
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

	/**
	 * Get virtual entry wrapper template for user code
	 * Subclasses must override to provide platform-specific wrappers
	 */
	abstract getEntryWrapper(
		entryPath: string,
		options?: EntryWrapperOptions,
	): string;

	/**
	 * Get platform-specific esbuild configuration
	 * Subclasses should override to provide platform-specific config
	 */
	abstract getEsbuildConfig(): PlatformEsbuildConfig;
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
