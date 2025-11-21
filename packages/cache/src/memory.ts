import {Cache, generateCacheKey, type CacheQueryOptions} from "./index.js";

/**
 * Configuration options for MemoryCache
 */
export interface MemoryCacheOptions {
	/** Maximum number of entries to store */
	maxEntries?: number;
}

/**
 * Cache entry stored in memory
 */
interface CacheEntry {
	request: Request;
	response: Response;
	timestamp: number;
}

/**
 * In-memory cache implementation using Map for storage
 * Supports LRU eviction and TTL expiration
 */
export class MemoryCache extends Cache {
	#storage: Map<string, CacheEntry>;
	#accessOrder: Map<string, number>;
	#accessCounter: number;
	#name: string;
	#options: MemoryCacheOptions;

	constructor(name: string, options: MemoryCacheOptions = {}) {
		super();
		this.#storage = new Map<string, CacheEntry>();
		this.#accessOrder = new Map<string, number>();
		this.#accessCounter = 0;
		this.#name = name;
		this.#options = options;
	}

	/**
	 * Find a cached response for the given request
	 */
	async match(
		request: Request,
		options?: CacheQueryOptions,
	): Promise<Response | undefined> {
		const key = generateCacheKey(request, options);
		const entry = this.#storage.get(key);

		if (!entry) {
			return undefined;
		}

		// Check if entry has expired
		if (this.#isExpired(entry)) {
			this.#storage.delete(key);
			this.#accessOrder.delete(key);
			return undefined;
		}

		// Update access order for LRU
		this.#accessOrder.set(key, ++this.#accessCounter);

		// Clone the response to avoid mutation
		return entry.response.clone();
	}

	/**
	 * Store a request/response pair in the cache
	 */
	async put(request: Request, response: Response): Promise<void> {
		const key = generateCacheKey(request);

		// Check if response is cacheable
		if (!this.#isCacheable(response)) {
			return;
		}

		// Clone request and response to avoid external mutation
		const clonedRequest = request.clone();
		const clonedResponse = response.clone();

		const entry: CacheEntry = {
			request: clonedRequest,
			response: clonedResponse,
			timestamp: Date.now(),
		};

		this.#storage.set(key, entry);
		this.#accessOrder.set(key, ++this.#accessCounter);

		// Enforce size limits
		this.#enforceMaxEntries();
	}

	/**
	 * Delete matching entries from the cache
	 */
	async delete(
		request: Request,
		options?: CacheQueryOptions,
	): Promise<boolean> {
		const key = generateCacheKey(request, options);
		const deleted = this.#storage.delete(key);

		if (deleted) {
			this.#accessOrder.delete(key);
		}

		return deleted;
	}

	/**
	 * Get all stored requests, optionally filtered by a request pattern
	 */
	async keys(
		request?: Request,
		options?: CacheQueryOptions,
	): Promise<readonly Request[]> {
		const keys: Request[] = [];

		for (const [_, entry] of this.#storage) {
			// Skip expired entries
			if (this.#isExpired(entry)) {
				continue;
			}

			// If no filter request provided, include all
			if (!request) {
				keys.push(entry.request.clone());
				continue;
			}

			// Check if entry matches the filter
			const entryKey = generateCacheKey(entry.request, options);
			const filterKey = generateCacheKey(request, options);

			if (entryKey === filterKey) {
				keys.push(entry.request.clone());
			}
		}

		return keys;
	}

	/**
	 * Clear all entries from the cache
	 */
	async clear(): Promise<void> {
		this.#storage.clear();
		this.#accessOrder.clear();
		this.#accessCounter = 0;
	}

	/**
	 * Get cache statistics
	 */
	getStats() {
		return {
			name: this.#name,
			size: this.#storage.size,
			maxEntries: this.#options.maxEntries,
			hitRate: 0, // Could be implemented with additional tracking
		};
	}

	/**
	 * Check if a cache entry has expired based on Cache-Control header
	 */
	#isExpired(entry: CacheEntry): boolean {
		const cacheControl = entry.response.headers.get("cache-control");
		if (!cacheControl) {
			return false; // No expiration set
		}

		// Parse max-age from Cache-Control header
		const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
		if (!maxAgeMatch) {
			return false;
		}

		const maxAge = parseInt(maxAgeMatch[1], 10) * 1000; // Convert to milliseconds
		return Date.now() - entry.timestamp > maxAge;
	}

	/**
	 * Check if a response should be cached
	 */
	#isCacheable(response: Response): boolean {
		// Don't cache error responses by default
		if (!response.ok) {
			return false;
		}

		// Check Cache-Control header
		const cacheControl = response.headers.get("cache-control");
		if (cacheControl) {
			if (
				cacheControl.includes("no-cache") ||
				cacheControl.includes("no-store")
			) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Enforce maximum entry limits using LRU eviction
	 */
	#enforceMaxEntries(): void {
		if (
			!this.#options.maxEntries ||
			this.#storage.size <= this.#options.maxEntries
		) {
			return;
		}

		// Sort by access order and remove oldest entries
		const entries = Array.from(this.#accessOrder.entries()).sort(
			(a, b) => a[1] - b[1],
		);

		const toRemove = this.#storage.size - this.#options.maxEntries;
		for (let i = 0; i < toRemove; i++) {
			const [key] = entries[i];
			this.#storage.delete(key);
			this.#accessOrder.delete(key);
		}
	}
}
