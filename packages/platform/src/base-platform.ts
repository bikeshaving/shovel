/**
 * Base platform implementation with dynamic adapter loading
 * Provides common functionality for all platform implementations
 */

import type {
	Platform,
	PlatformConfig,
	CacheConfig,
	CacheBackendConfig,
	FilesystemConfig,
} from "./types.js";
import {loadCacheAdapter, loadFilesystemAdapter} from "./adapter-registry.js";
import type {CacheStorage} from "@b9g/cache/cache-storage";

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
	abstract loadServiceWorker(
		entrypoint: string,
		options?: any,
	): Promise<any>;
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
	protected async buildCacheStorage(config: CacheConfig): Promise<CacheStorage> {
		const caches = new Map();

		// Load each configured cache type
		for (const [name, cacheConfig] of Object.entries(config)) {
			if (cacheConfig && typeof cacheConfig === "object" && "type" in cacheConfig) {
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
		const fsConfig = config || this.config.filesystem || this.getDefaultFilesystemConfig();

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