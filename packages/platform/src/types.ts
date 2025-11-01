/**
 * Core Platform interface and configuration types for Shovel deployment adapters
 */

import type {CacheStorage} from "@b9g/cache/cache-storage";
// Import File System Access API types
import "@types/wicg-file-system-access";

// Re-export adapter registry utilities
export {
	loadCacheAdapter,
	loadFilesystemAdapter,
	resolveCacheAdapter,
	resolveFilesystemAdapter,
	CACHE_ALIASES,
	FILESYSTEM_ALIASES,
} from "./adapter-registry.js";

// Re-export base platform class
export {BasePlatform} from "./base-platform.js";

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
	runtime: any; // ServiceWorkerRuntime from service-worker.ts
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
 * Server instance returned by platform.createServer()
 */
export interface Server {
	/** Start listening for requests */
	listen(): Promise<void> | void;
	/** Stop the server */
	close(): Promise<void> | void;
	/** Get server URL */
	url?: string;
	/** Platform-specific server instance */
	instance?: any;
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
	 * Build artifacts filesystem (install-time only)
	 * Available during install handlers to copy built files to runtime storage
	 */
	readonly dist: FileSystemDirectoryHandle;

	/**
	 * THE MAIN JOB - Load and run a ServiceWorker-style entrypoint
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
	 * SUPPORTING UTILITY - Create server instance for this platform
	 */
	createServer(handler: Handler, options?: ServerOptions): Server;

	/**
	 * SUPPORTING UTILITY - Get filesystem root for bucket/container name
	 * Maps directly to cloud storage buckets (S3, R2) or local directories
	 * @param bucketName - The bucket/container/directory name
	 */
	getFileSystemRoot(bucketName: string): Promise<FileSystemDirectoryHandle>;
}

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
	register(name: string, platform: Platform): void;
	/** Get platform by name */
	get(name: string): Platform | undefined;
	/** Detect current platform */
	detect(): PlatformDetection;
	/** Get all registered platforms */
	list(): string[];
}
