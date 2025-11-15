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


