/**
 * @b9g/platform - Platform interface for ServiceWorker entrypoint loading
 *
 * Platform = "ServiceWorker entrypoint loader for JavaScript runtimes"
 * Core responsibility: Take a ServiceWorker-style app file and make it run in this environment.
 */

import type {CacheStorage} from "@b9g/cache/cache-storage";

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Cache backend configuration
 * Type can be a blessed alias or full package name
 */
export interface CacheBackendConfig {
	/** Cache backend type - blessed alias (memory, redis, kv) or package name (@custom/cache) */
	type?: string;
	/** Maximum number of entries (for memory/LRU caches) */
	maxEntries?: number;
	/** Time-to-live in milliseconds or string format (e.g., '5m', '1h') */
	ttl?: number | string;
	/** Directory for filesystem cache */
	dir?: string;
	/** Redis connection string */
	url?: string;
	/** Custom cache factory function */
	factory?: () => any;
}

/**
 * Cache configuration for different cache types
 */
export interface CacheConfig {
	/** Page/HTML cache configuration */
	pages?: CacheBackendConfig;
	/** API response cache configuration */
	api?: CacheBackendConfig;
	/** Static file cache configuration */
	static?: CacheBackendConfig;
	/** Custom named caches */
	[name: string]: CacheBackendConfig | undefined;
}

/**
 * Static file serving configuration
 */
export interface StaticConfig {
	/** Public URL path prefix */
	publicPath?: string;
	/** Output directory for built assets */
	outputDir?: string;
	/** Asset manifest file path */
	manifest?: string;
	/** Development mode (serve from source) */
	dev?: boolean;
	/** Source directory for development */
	sourceDir?: string;
	/** Cache configuration for static files */
	cache?: {
		name?: string;
		ttl?: string | number;
	};
}

/**
 * CORS configuration
 */
export interface CorsConfig {
	/** Allowed origins */
	origin?: boolean | string | string[] | RegExp | ((origin: string) => boolean);
	/** Allowed methods */
	methods?: string[];
	/** Allowed headers */
	allowedHeaders?: string[];
	/** Exposed headers */
	exposedHeaders?: string[];
	/** Allow credentials */
	credentials?: boolean;
	/** Preflight cache duration */
	maxAge?: number;
}

/**
 * Filesystem adapter configuration
 */
export interface FilesystemConfig {
	/** Filesystem adapter type - blessed alias (memory, s3, r2) or package name (@custom/fs) */
	type?: string;
	/** Region for cloud storage */
	region?: string;
	/** Access credentials */
	credentials?: {
		accessKeyId?: string;
		secretAccessKey?: string;
		token?: string;
	};
	/** Factory function for creating directory storage */
	factory?: any; // DirectoryFactory from @b9g/filesystem
	/** Additional adapter-specific options */
	[key: string]: any;
}

/**
 * Platform configuration from CLI flags
 */
export interface PlatformConfig {
	/** Cache configuration */
	caches?: CacheConfig;
	/** Filesystem adapter configuration */
	filesystem?: FilesystemConfig;
}

/**
 * Server options for platform implementations
 */
export interface ServerOptions {
	/** Port to listen on */
	port?: number;
	/** Host to bind to */
	host?: string;
	/** Hostname for URL generation */
	hostname?: string;
	/** Enable compression */
	compression?: boolean;
	/** CORS configuration */
	cors?: CorsConfig;
	/** Custom headers to add to all responses */
	headers?: Record<string, string>;
	/** Request timeout in milliseconds */
	timeout?: number;
	/** Development mode settings */
	development?: {
		/** Enable hot reloading */
		hotReload?: boolean;
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
	/** Enable hot reloading */
	hotReload?: boolean;
	/** Cache configuration to pass to platform event */
	caches?: CacheConfig;
	/** Additional context to provide */
	context?: any;
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
	/** Collect routes for static generation */
	collectStaticRoutes(outDir: string, baseUrl?: string): Promise<string[]>;
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
	 * THE MAIN JOB - Create a ServiceWorkerContainer for managing multiple registrations
	 * This is the new registry-based approach aligned with ServiceWorker spec
	 */
	createServiceWorkerContainer(options?: ServiceWorkerOptions): Promise<any>; // ServiceWorkerContainer from runtime.ts

	/**
	 * Load and run a ServiceWorker-style entrypoint (legacy method)
	 * This is where all the platform-specific complexity lives
	 */
	loadServiceWorker(
		entrypoint: string,
		options?: ServiceWorkerOptions,
	): Promise<ServiceWorkerInstance>;

	/**
	 * SUPPORTING UTILITY - Create cache storage with platform-optimized backends
	 * Automatically selects optimal cache types when not specified:
	 * - Node.js: filesystem for persistence, memory for API
	 * - Cloudflare: KV for persistence, memory for fast access
	 * - Bun: filesystem with optimized writes
	 */
	createCaches(config?: CacheConfig): Promise<CacheStorage>;

	/**
	 * SUPPORTING UTILITY - Create bucket storage with platform-optimized backends
	 * Uses factory pattern to route bucket names to different filesystem adapters
	 */
	createBuckets(config?: FilesystemConfig): Promise<any>; // BucketStorage

	/**
	 * SUPPORTING UTILITY - Create server instance for this platform
	 */
	createServer(handler: Handler, options?: ServerOptions): Server;

	/**
	 * SUPPORTING UTILITY - Get filesystem directory handle
	 * Maps directly to cloud storage buckets (S3, R2) or local directories
	 * @param name - Directory name. Use "" for root directory
	 */
	getDirectoryHandle(name: string): Promise<FileSystemDirectoryHandle>;
}

// ============================================================================
// Platform Detection
// ============================================================================

/**
 * Platform detection result
 */
export interface PlatformDetection {
	/** Detected platform name */
	platform: string;
	/** Confidence level (0-1) */
	confidence: number;
	/** Detection reasons */
	reasons: string[];
}

/**
 * Platform registry for auto-detection
 */
export interface PlatformRegistry {
	/** Register a platform implementation */
	register(name: string, platform: any): void;
	/** Get platform by name */
	get(name: string): any | undefined;
	/** Detect current platform */
	detect(): PlatformDetection;
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
 * Detect platform for development (uses current runtime)
 */
export function detectDevelopmentPlatform(): string {
	const runtime = detectRuntime();

	switch (runtime) {
		case "bun":
			return "bun";
		case "deno":
			return "node"; // Use Node.js platform for Deno for now
		case "node":
		default:
			return "node";
	}
}

/**
 * Comprehensive platform detection with confidence scoring
 */
export function detectPlatforms(): PlatformDetection[] {
	const detections: PlatformDetection[] = [];

	// Check for Bun
	if (typeof Bun !== "undefined") {
		detections.push({
			platform: "bun",
			confidence: 0.9,
			reasons: ["Bun global detected"],
		});
	}

	// Check for Vercel Edge Runtime
	if (typeof EdgeRuntime !== "undefined") {
		detections.push({
			platform: "vercel",
			confidence: 0.9,
			reasons: ["Vercel EdgeRuntime detected"],
		});
	}

	// Check for Deno
	if (typeof Deno !== "undefined") {
		detections.push({
			platform: "deno",
			confidence: 0.9,
			reasons: ["Deno global detected"],
		});
	}

	// Check for Cloudflare Workers
	if (
		typeof caches !== "undefined" &&
		typeof Response !== "undefined" &&
		typeof crypto !== "undefined"
	) {
		// Additional check for Workers-specific globals
		if (
			typeof addEventListener !== "undefined" &&
			typeof fetch !== "undefined"
		) {
			detections.push({
				platform: "cloudflare-workers",
				confidence: 0.8,
				reasons: ["Worker-like environment detected", "Web APIs available"],
			});
		}
	}

	// Check for Node.js (fallback)
	if (
		typeof process !== "undefined" &&
		process.versions &&
		process.versions.node
	) {
		detections.push({
			platform: "node",
			confidence: 0.7,
			reasons: ["Node.js process detected"],
		});
	}

	// Fallback detection
	if (detections.length === 0) {
		detections.push({
			platform: "unknown",
			confidence: 0,
			reasons: ["No platform detected"],
		});
	}

	return detections.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Get the best platform detection
 */
export function getBestPlatformDetection(): PlatformDetection {
	const detections = detectPlatforms();
	return detections[0];
}

/**
 * Resolve platform name from options or auto-detect
 */
export function resolvePlatform(options: {
	platform?: string;
	target?: string;
}): string {
	// Explicit platform takes precedence
	if (options.platform) {
		return options.platform;
	}

	// Target for build/deploy scenarios
	if (options.target) {
		return options.target;
	}

	// Auto-detect for development
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

/**
 * Display platform information (for CLI info command)
 */
export function displayPlatformInfo(platformName: string): void {
	const runtime = detectRuntime();
	const detection = getBestPlatformDetection();

	console.info(`🚀 Platform: ${platformName}`);
	console.info(`⚙️  Runtime: ${runtime}`);
	console.info(
		`🔍 Auto-detected: ${detection.platform} (confidence: ${detection.confidence})`,
	);
	console.info(`💡 Reasons: ${detection.reasons.join(", ")}`);
}

// ============================================================================
// Adapter Registry
// ============================================================================

interface AdapterModule {
	createCache?: (config: any) => any;
	createFileSystem?: (config: any) => any;
}

/**
 * Internal blessed aliases for cache adapters
 */
const CACHE_ALIASES = {
	memory: "@b9g/cache",
	redis: "@b9g/cache-redis",
	kv: "@b9g/cache-kv",
	cloudflare: "@b9g/cache/cloudflare",
} as const;

/**
 * Internal blessed aliases for filesystem adapters
 */
const FILESYSTEM_ALIASES = {
	memory: "@b9g/filesystem",
	fs: "@b9g/filesystem/node",
	"bun-s3": "@b9g/filesystem/bun-s3",
	s3: "@b9g/filesystem-s3",
	r2: "@b9g/filesystem-r2",
} as const;

/**
 * Internal: Resolve a cache adapter name to a package name
 */
function resolveCacheAdapter(name: string): string {
	// If it starts with @, assume it's a full package name
	if (name.startsWith("@")) {
		return name;
	}

	// Check blessed aliases
	if (name in CACHE_ALIASES) {
		return CACHE_ALIASES[name as keyof typeof CACHE_ALIASES];
	}

	throw new Error(
		`Unknown cache adapter: ${name}. Available aliases: ${Object.keys(CACHE_ALIASES).join(", ")} or use full package name like @custom/cache`,
	);
}

/**
 * Internal: Resolve a filesystem adapter name to a package name
 */
function resolveFilesystemAdapter(name: string): string {
	// If it starts with @, assume it's a full package name
	if (name.startsWith("@")) {
		return name;
	}

	// Check blessed aliases
	if (name in FILESYSTEM_ALIASES) {
		return FILESYSTEM_ALIASES[name as keyof typeof FILESYSTEM_ALIASES];
	}

	throw new Error(
		`Unknown filesystem adapter: ${name}. Available aliases: ${Object.keys(FILESYSTEM_ALIASES).join(", ")} or use full package name like @custom/filesystem`,
	);
}

/**
 * Dynamically load a cache adapter
 * @param name - Adapter name (blessed alias or package name)
 * @param config - Adapter configuration
 * @returns Cache instance
 */
async function loadCacheAdapter(name: string, config: any = {}) {
	const packageName = resolveCacheAdapter(name);

	try {
		const module: AdapterModule = await import(packageName);

		if (!module.createCache) {
			throw new Error(
				`Package ${packageName} does not export a createCache function`,
			);
		}

		return module.createCache(config);
	} catch (error) {
		if (
			error instanceof Error &&
			error.message.includes("Cannot resolve module")
		) {
			throw new Error(
				`Cache adapter '${name}' requires: npm install ${packageName}`,
			);
		}
		throw error;
	}
}

/**
 * Dynamically load a filesystem adapter
 * @param name - Adapter name (blessed alias or package name)
 * @param config - Adapter configuration
 * @returns Filesystem adapter instance
 */
async function loadFilesystemAdapter(name: string, config: any = {}) {
	const packageName = resolveFilesystemAdapter(name);

	try {
		const module: AdapterModule = await import(packageName);

		if (!module.createFileSystem) {
			throw new Error(
				`Package ${packageName} does not export a createFileSystem function`,
			);
		}

		return module.createFileSystem(config);
	} catch (error) {
		if (
			error instanceof Error &&
			error.message.includes("Cannot resolve module")
		) {
			throw new Error(
				`Filesystem adapter '${name}' requires: npm install ${packageName}`,
			);
		}
		throw error;
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
	protected config: PlatformConfig;

	constructor(config: PlatformConfig = {}) {
		this.config = config;
	}

	abstract readonly name: string;
	abstract loadServiceWorker(entrypoint: string, options?: any): Promise<any>;
	abstract createServer(handler: any, options?: any): any;
	abstract getDirectoryHandle(name: string): Promise<FileSystemDirectoryHandle>;

	/**
	 * Create cache storage with dynamic adapter loading
	 * Uses platform defaults when specific cache types aren't configured
	 */
	async createCaches(config?: CacheConfig): Promise<CacheStorage> {
		const mergedConfig = this.mergeCacheConfig(config);
		return this.buildCacheStorage(mergedConfig);
	}

	/**
	 * Get platform-specific default cache configuration
	 * Subclasses override this to provide optimal defaults for their runtime
	 */
	protected getDefaultCacheConfig(): CacheConfig {
		return {
			pages: {type: "memory"},
			api: {type: "memory"},
			static: {type: "memory"},
		};
	}

	/**
	 * Merge user config with platform defaults
	 */
	protected mergeCacheConfig(userConfig?: CacheConfig): CacheConfig {
		const defaults = this.getDefaultCacheConfig();
		const platformConfig = this.config.caches || {};

		// Merge in order: defaults -> platform config -> user config
		return {
			...defaults,
			...platformConfig,
			...userConfig,
		};
	}

	/**
	 * Build CacheStorage instance with dynamic adapter loading
	 */
	protected async buildCacheStorage(
		config: CacheConfig,
	): Promise<CacheStorage> {
		const caches = new Map();

		// Load each configured cache type
		for (const [name, cacheConfig] of Object.entries(config)) {
			if (
				cacheConfig &&
				typeof cacheConfig === "object" &&
				"type" in cacheConfig
			) {
				const cache = await this.loadCacheInstance(cacheConfig);
				caches.set(name, cache);
			}
		}

		// Return CacheStorage-compatible interface
		return {
			async open(name: string) {
				const cache = caches.get(name);
				if (!cache) {
					throw new Error(`Cache '${name}' not configured`);
				}
				return cache;
			},
			async delete(name: string) {
				const deleted = caches.delete(name);
				return deleted;
			},
			async has(name: string) {
				return caches.has(name);
			},
			async keys() {
				return Array.from(caches.keys());
			},
		};
	}

	/**
	 * Load a single cache instance using dynamic import
	 */
	protected async loadCacheInstance(config: CacheBackendConfig) {
		if (!config.type) {
			throw new Error("Cache configuration must specify a type");
		}

		try {
			return await loadCacheAdapter(config.type, config);
		} catch (error) {
			// Add context about which cache failed to load
			if (error instanceof Error) {
				throw new Error(`Failed to load cache adapter: ${error.message}`);
			}
			throw error;
		}
	}

	/**
	 * Load filesystem adapter using dynamic import
	 */
	protected async loadFilesystemAdapter(config?: FilesystemConfig) {
		const fsConfig =
			config || this.config.filesystem || this.getDefaultFilesystemConfig();

		if (!fsConfig.type) {
			throw new Error("Filesystem configuration must specify a type");
		}

		try {
			return await loadFilesystemAdapter(fsConfig.type, fsConfig);
		} catch (error) {
			// Add context about filesystem adapter failure
			if (error instanceof Error) {
				throw new Error(`Failed to load filesystem adapter: ${error.message}`);
			}
			throw error;
		}
	}

	/**
	 * Get platform-specific default filesystem configuration
	 * Subclasses override this to provide optimal defaults for their runtime
	 */
	protected getDefaultFilesystemConfig(): FilesystemConfig {
		return {type: "memory"};
	}
}

// ============================================================================
// Platform Registry
// ============================================================================

/**
 * Global platform registry
 */
class DefaultPlatformRegistry implements PlatformRegistry {
	private platforms = new Map<string, Platform>();

	register(name: string, platform: Platform): void {
		this.platforms.set(name, platform);
	}

	get(name: string): Platform | undefined {
		return this.platforms.get(name);
	}

	detect(): PlatformDetection {
		return getBestPlatformDetection();
	}

	list(): string[] {
		return Array.from(this.platforms.keys());
	}
}

/**
 * Global platform registry instance
 */
export const platformRegistry = new DefaultPlatformRegistry();

/**
 * Auto-detect and return the appropriate platform
 */
export function detectPlatform(): Platform | null {
	const detection = platformRegistry.detect();

	if (detection.confidence > 0.5) {
		const platform = platformRegistry.get(detection.platform);
		if (platform) {
			return platform;
		}
	}

	return null;
}

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

	// Auto-detect platform
	const detected = detectPlatform();
	if (!detected) {
		throw new Error(
			"No platform could be auto-detected. Please register a platform manually or specify a platform name.",
		);
	}

	return detected;
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

	// Auto-detect platform
	const detected = detectPlatform();
	if (!detected) {
		// Create default Node.js platform if no platforms are registered
		const NodePlatform = await import("@b9g/platform-node").then(
			(m) => m.default,
		);
		const nodePlatform = new NodePlatform();
		platformRegistry.register("node", nodePlatform);
		return nodePlatform;
	}

	return detected;
}

// ============================================================================
// File System Access API
// ============================================================================

/**
 * Get the file system directory handle for the specified name
 * Auto-registers Node.js platform if no platform is detected
 */
export async function getDirectoryHandle(
	name: string,
): Promise<FileSystemDirectoryHandle> {
	const platform = await getPlatformAsync();
	return await platform.getDirectoryHandle(name);
}

/**
 * @deprecated Use getDirectoryHandle() instead
 */
export async function getBucket(
	name?: string,
): Promise<FileSystemDirectoryHandle> {
	const platform = await getPlatformAsync();
	return await platform.getDirectoryHandle(name || "");
}

/**
 * @deprecated Use getDirectoryHandle() instead
 */
export async function getFileSystemRoot(
	name?: string,
): Promise<FileSystemDirectoryHandle> {
	const platform = await getPlatformAsync();
	return await platform.getDirectoryHandle(name || "");
}


/**
 * Common WorkerPool abstraction based on web standards
 * Provides platform-agnostic worker management for ServiceWorker execution
 */

import * as Path from "path";

export interface WorkerPoolOptions {
	/** Number of workers in the pool (default: 1) */
	workerCount?: number;
	/** Request timeout in milliseconds (default: 30000) */
	requestTimeout?: number;
	/** Enable hot reloading (default: true in development) */
	hotReload?: boolean;
	/** Working directory for file resolution */
	cwd?: string;
}

export interface WorkerMessage {
	type: string;
	[key: string]: any;
}

export interface WorkerRequest extends WorkerMessage {
	type: "request";
	request: {
		url: string;
		method: string;
		headers: Record<string, string>;
		body?: any;
	};
	requestId: number;
}

export interface WorkerResponse extends WorkerMessage {
	type: "response";
	response: {
		status: number;
		statusText: string;
		headers: Record<string, string>;
		body: string;
	};
	requestId: number;
}

export interface WorkerLoadMessage extends WorkerMessage {
	type: "load";
	version: number | string;
	entrypoint?: string;
}

export interface WorkerReadyMessage extends WorkerMessage {
	type: "ready" | "worker-ready";
	version?: number | string;
}

export interface WorkerErrorMessage extends WorkerMessage {
	type: "error";
	error: string;
	stack?: string;
	requestId?: number;
}

/**
 * Resolve the worker script path for the current platform
 */
function resolveWorkerScript(entrypoint?: string): string {
	// Try to find bundled worker.js relative to app entrypoint first
	if (entrypoint) {
		const entryDir = Path.dirname(entrypoint);
		const bundledWorker = Path.join(entryDir, "worker.js");

		// Check if bundled worker exists (production)
		try {
			// Use platform-specific file existence check
			if (typeof Bun !== "undefined") {
				// Bun has synchronous file operations
				const file = Bun.file(bundledWorker);
				if (file.size > 0) {
					console.debug(`[WorkerPool] Using bundled worker: ${bundledWorker}`);
					return bundledWorker;
				}
			} else if (typeof require !== "undefined") {
				// Node.js - use fs.existsSync
				const fs = require("fs");
				if (fs.existsSync(bundledWorker)) {
					console.debug(`[WorkerPool] Using bundled worker: ${bundledWorker}`);
					return bundledWorker;
				}
			}
		} catch {
			// Fall through to package resolution
		}
	}

	// Fallback to package resolution for development
	try {
		// Use import.meta.resolve for runtime script (contains bootstrap code)
		const workerUrl = import.meta.resolve("@b9g/platform/runtime.js");
		let workerScript: string;

		if (workerUrl.startsWith("file://")) {
			// Convert file:// URL to path for Worker constructor
			workerScript = workerUrl.slice(7); // Remove 'file://' prefix
		} else {
			workerScript = workerUrl;
		}

		console.debug(
			`[WorkerPool] Using worker runtime script: ${workerScript}`,
		);
		return workerScript;
	} catch (error) {
		const bundledPath = entrypoint
			? Path.join(Path.dirname(entrypoint), "runtime.js")
			: "runtime.js";
		throw new Error(
			`Could not resolve runtime.js. Checked bundled path: ${bundledPath} and package: @b9g/platform/runtime.js. Error: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

/**
 * Create a web-standard Worker with targeted Node.js fallback
 */
async function createWebWorker(workerScript: string): Promise<Worker> {
	// Try native Web Worker API first (works in Bun, Deno, browsers)
	if (typeof Worker !== "undefined") {
		return new Worker(workerScript, {type: "module"});
	}

	// Only try shim for Node.js (which lacks native Worker support)
	const isNodeJs = typeof process !== "undefined" && process.versions?.node;

	if (isNodeJs) {
		// Try to dynamically import our own Node.js shim
		try {
			const {Worker: NodeWebWorker} = await import("@b9g/node-webworker");
			console.debug("[WorkerPool] Using @b9g/node-webworker shim for Node.js");
			return new NodeWebWorker(workerScript, {type: "module"});
		} catch (shimError) {
			console.error(
				"\n❌ MISSING WEB STANDARD: Node.js lacks native Web Worker support",
			);
			console.error(
				"🔗 CANONICAL ISSUE: https://github.com/nodejs/node/issues/43583",
			);
			console.error(
				"💬 This is a basic web standard from 2009 - help push for implementation!",
			);
			console.error(
				"🗳️  Please 👍 react and comment on the issue to show demand\n",
			);

			throw new Error(`❌ Web Worker not available on Node.js

🔗 Node.js doesn't implement the Web Worker standard yet.
   CANONICAL ISSUE: https://github.com/nodejs/node/issues/43583
   
🗳️  Please 👍 react and comment to show demand for this basic web standard!

💡 Immediate workaround:
   npm install @b9g/node-webworker
   
   This installs our minimal, reliable Web Worker shim for Node.js.

📚 Learn more: https://developer.mozilla.org/en-US/docs/Web/API/Worker`);
		}
	}

	// For other runtimes, fail with generic message
	const runtime =
		typeof Bun !== "undefined"
			? "Bun"
			: typeof Deno !== "undefined"
				? "Deno"
				: "Unknown";

	throw new Error(`❌ Web Worker not available on ${runtime}

This runtime should support Web Workers but the API is not available.
Please check your runtime version and configuration.

📚 Web Worker standard: https://developer.mozilla.org/en-US/docs/Web/API/Worker`);
}

/**
 * Common WorkerPool implementation based on web standards
 * Provides round-robin request handling and hot reloading
 */
export class WorkerPool {
	private workers: Worker[] = [];
	private currentWorker = 0;
	private requestId = 0;
	private pendingRequests = new Map<
		number,
		{resolve: (response: Response) => void; reject: (error: Error) => void}
	>();
	private options: Required<WorkerPoolOptions>;
	private appEntrypoint?: string;

	constructor(
		options: WorkerPoolOptions = {},
		appEntrypoint?: string,
	) {
		this.appEntrypoint = appEntrypoint;
		this.options = {
			workerCount: 1,
			requestTimeout: 30000,
			hotReload: process.env.NODE_ENV !== "production",
			cwd: process.cwd(),
			...options,
		};

		// Workers will be initialized by calling init() after construction
	}

	/**
	 * Initialize workers (must be called after construction)
	 */
	async init(): Promise<void> {
		await this.initWorkers();
	}

	private async initWorkers() {
		for (let i = 0; i < this.options.workerCount; i++) {
			await this.createWorker();
		}
	}

	private async createWorker(): Promise<Worker> {
		const workerScript = resolveWorkerScript(this.appEntrypoint);
		const worker = await createWebWorker(workerScript);

		// Set up event listeners using web standards
		worker.addEventListener("message", (event) => {
			this.handleWorkerMessage(event.data || event);
		});

		worker.addEventListener("error", (error) => {
			console.error("[WorkerPool] Worker error:", error);
		});

		this.workers.push(worker);
		return worker;
	}

	private handleWorkerMessage(message: WorkerMessage) {
		switch (message.type) {
			case "response":
				this.handleResponse(message as WorkerResponse);
				break;
			case "error":
				this.handleError(message as WorkerErrorMessage);
				break;
			case "ready":
			case "worker-ready":
				this.handleReady(message as WorkerReadyMessage);
				break;
			default:
				// Unknown message type - ignore (could be cache: messages handled directly by MemoryCache)
				break;
		}
	}

	private handleResponse(message: WorkerResponse) {
		const pending = this.pendingRequests.get(message.requestId);
		if (pending) {
			// Reconstruct Response object from serialized data
			const response = new Response(message.response.body, {
				status: message.response.status,
				statusText: message.response.statusText,
				headers: message.response.headers,
			});
			pending.resolve(response);
			this.pendingRequests.delete(message.requestId);
		}
	}

	private handleError(message: WorkerErrorMessage) {
		if (message.requestId) {
			const pending = this.pendingRequests.get(message.requestId);
			if (pending) {
				pending.reject(new Error(message.error));
				this.pendingRequests.delete(message.requestId);
			}
		} else {
			console.error("[WorkerPool] Worker error:", message.error);
		}
	}

	private handleReady(message: WorkerReadyMessage) {
		if (message.type === "ready") {
			console.info(`[WorkerPool] ServiceWorker ready (v${message.version})`);
		} else if (message.type === "worker-ready") {
			console.info("[WorkerPool] Worker initialized");
		}
	}

	/**
	 * Handle HTTP request using round-robin worker selection
	 */
	async handleRequest(request: Request): Promise<Response> {
		// Round-robin worker selection
		const worker = this.workers[this.currentWorker];
		console.info(
			`[WorkerPool] Dispatching to worker ${this.currentWorker + 1} of ${this.workers.length}`,
		);
		this.currentWorker = (this.currentWorker + 1) % this.workers.length;

		const requestId = ++this.requestId;

		return new Promise((resolve, reject) => {
			// Track pending request
			this.pendingRequests.set(requestId, {resolve, reject});

			// Serialize request for worker (can't clone Request objects across threads)
			const workerRequest: WorkerRequest = {
				type: "request",
				request: {
					url: request.url,
					method: request.method,
					headers: Object.fromEntries(request.headers.entries()),
					body: request.body,
				},
				requestId,
			};

			worker.postMessage(workerRequest);

			// Timeout handling
			setTimeout(() => {
				if (this.pendingRequests.has(requestId)) {
					this.pendingRequests.delete(requestId);
					reject(new Error("Request timeout"));
				}
			}, this.options.requestTimeout);
		});
	}

	/**
	 * Reload ServiceWorker with new version (hot reload simulation)
	 */
	async reloadWorkers(version: number | string = Date.now()): Promise<void> {
		console.info(`[WorkerPool] Reloading ServiceWorker (v${version})`);

		const loadPromises = this.workers.map((worker) => {
			return new Promise<void>((resolve) => {
				const handleReady = (event: any) => {
					const message = event.data || event;
					if (message.type === "ready" && message.version === version) {
						worker.removeEventListener("message", handleReady);
						resolve();
					}
				};

				console.info("[WorkerPool] Sending load message:", {
					version,
					entrypoint: this.appEntrypoint,
				});

				worker.addEventListener("message", handleReady);

				const loadMessage: WorkerLoadMessage = {
					type: "load",
					version,
					entrypoint: this.appEntrypoint,
				};

				worker.postMessage(loadMessage);
			});
		});

		await Promise.all(loadPromises);
		console.info(`[WorkerPool] All workers reloaded (v${version})`);
	}

	/**
	 * Graceful shutdown of all workers
	 */
	async terminate(): Promise<void> {
		const terminatePromises = this.workers.map((worker) => worker.terminate());
		await Promise.allSettled(terminatePromises);
		this.workers = [];
		this.pendingRequests.clear();
	}

	/**
	 * Get the number of active workers
	 */
	get workerCount(): number {
		return this.workers.length;
	}

	/**
	 * Check if the pool is ready to handle requests
	 */
	get ready(): boolean {
		return this.workers.length > 0;
	}
}
