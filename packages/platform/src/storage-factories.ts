/**
 * Storage Factory Functions
 *
 * Creates cache and bucket storage instances based on config.
 * Used by workers and single-threaded runtime.
 *
 * NOTE: This module is for Node/Bun only (uses dynamic imports for filesystem/node).
 * Cloudflare uses native caches and R2 bindings.
 */

import {resolve} from "path";
import {Cache} from "@b9g/cache";

// ============================================================================
// TYPES (subset of config types needed for factories)
// ============================================================================

export interface CacheConfig {
	provider?: string;
	[key: string]: any;
}

export interface BucketConfig {
	provider?: string;
	path?: string;
	[key: string]: any;
}

export interface ShovelConfig {
	caches?: Record<string, CacheConfig>;
	buckets?: Record<string, BucketConfig>;
	[key: string]: any;
}

// ============================================================================
// PATTERN MATCHING
// ============================================================================

/**
 * Match a name against pattern-keyed config
 * Patterns use glob-like syntax (* for wildcards)
 */
function matchPattern<T>(
	name: string,
	patterns: Record<string, T> | undefined,
): T | undefined {
	if (!patterns) return undefined;

	// Exact match first
	if (patterns[name]) return patterns[name];

	// Try pattern matching
	for (const [pattern, value] of Object.entries(patterns)) {
		if (pattern.includes("*")) {
			const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
			if (regex.test(name)) return value;
		}
	}

	return undefined;
}

function getCacheConfig(config: ShovelConfig, name: string): CacheConfig {
	return matchPattern(name, config.caches) || {};
}

function getBucketConfig(config: ShovelConfig, name: string): BucketConfig {
	return matchPattern(name, config.buckets) || {};
}

// ============================================================================
// BUCKET FACTORY
// ============================================================================

// Well-known bucket path conventions
const WELL_KNOWN_BUCKET_PATHS: Record<string, (baseDir: string) => string> = {
	static: (baseDir) => resolve(baseDir, "../static"),
	server: (baseDir) => baseDir,
};

const BUILTIN_BUCKET_PROVIDERS: Record<string, string> = {
	node: "@b9g/filesystem/node.js",
	memory: "@b9g/filesystem/memory.js",
	s3: "@b9g/filesystem-s3",
};

export interface BucketFactoryOptions {
	/** Base directory for path resolution (entrypoint directory) - REQUIRED */
	baseDir: string;
	/** Shovel configuration for overrides */
	config?: ShovelConfig;
}

/**
 * Creates a bucket factory function for CustomBucketStorage.
 */
export function createBucketFactory(options: BucketFactoryOptions) {
	const {baseDir, config} = options;

	return async (name: string): Promise<FileSystemDirectoryHandle> => {
		const bucketConfig = config ? getBucketConfig(config, name) : {};

		// Determine bucket path: config override > well-known > default convention
		let bucketPath: string;
		if (bucketConfig.path) {
			bucketPath = String(bucketConfig.path);
		} else if (WELL_KNOWN_BUCKET_PATHS[name]) {
			bucketPath = WELL_KNOWN_BUCKET_PATHS[name](baseDir);
		} else {
			bucketPath = resolve(baseDir, `../${name}`);
		}

		const provider = String(bucketConfig.provider || "node");
		const modulePath = BUILTIN_BUCKET_PROVIDERS[provider] || provider;

		// Special handling for built-in node bucket (most common case)
		if (modulePath === "@b9g/filesystem/node.js") {
			const {NodeBucket} = await import("@b9g/filesystem/node.js");
			return new NodeBucket(bucketPath);
		}

		// Special handling for built-in memory bucket
		if (modulePath === "@b9g/filesystem/memory.js") {
			const {MemoryBucket} = await import("@b9g/filesystem/memory.js");
			return new MemoryBucket(name);
		}

		// Dynamic import for all other providers
		const module = await import(modulePath);
		const BucketClass =
			module.default ||
			module.S3Bucket ||
			module.Bucket ||
			Object.values(module).find(
				(v: any) => typeof v === "function" && v.name?.includes("Bucket"),
			);

		if (!BucketClass) {
			throw new Error(
				`Bucket module "${modulePath}" does not export a valid bucket class.`,
			);
		}

		const {provider: _, path: __, ...bucketOptions} = bucketConfig;
		return new BucketClass(name, {path: bucketPath, ...bucketOptions});
	};
}

// ============================================================================
// CACHE FACTORY
// ============================================================================

const BUILTIN_CACHE_PROVIDERS: Record<string, string> = {
	memory: "@b9g/cache/memory.js",
	redis: "@b9g/cache-redis",
};

export interface CacheFactoryOptions {
	/** Shovel configuration for cache settings */
	config?: ShovelConfig;
	/** Default provider when not specified in config. Defaults to "memory". */
	defaultProvider?: string;
}

/**
 * Creates a cache factory function for CustomCacheStorage.
 */
export function createCacheFactory(options: CacheFactoryOptions = {}) {
	const {config, defaultProvider = "memory"} = options;

	return async (name: string): Promise<Cache> => {
		const cacheConfig = config ? getCacheConfig(config, name) : {};
		const provider = String(cacheConfig.provider || defaultProvider);

		// Native Cloudflare caches
		if (provider === "cloudflare") {
			const nativeCaches =
				(globalThis as any).__cloudflareCaches ?? globalThis.caches;
			if (!nativeCaches) {
				throw new Error(
					"Cloudflare cache provider requires native caches API.",
				);
			}
			return nativeCaches.open(name);
		}

		const {provider: _, ...cacheOptions} = cacheConfig;
		const modulePath = BUILTIN_CACHE_PROVIDERS[provider] || provider;

		const module = await import(modulePath);
		const CacheClass =
			module.default ||
			module.RedisCache ||
			module.MemoryCache ||
			module.Cache ||
			Object.values(module).find(
				(v: any) => typeof v === "function" && v.name?.includes("Cache"),
			);

		if (!CacheClass) {
			throw new Error(
				`Cache module "${modulePath}" does not export a valid cache class.`,
			);
		}

		return new CacheClass(name, cacheOptions);
	};
}
