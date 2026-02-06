import {
	Cache,
	generateCacheKey,
	toRequest,
	type CacheQueryOptions,
} from "./index.js";

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
 * Uses Map's insertion order for LRU tracking
 */
export class MemoryCache extends Cache {
	#storage: Map<string, CacheEntry>;
	#options: MemoryCacheOptions;

	constructor(_name: string, options: MemoryCacheOptions = {}) {
		super();
		this.#storage = new Map<string, CacheEntry>();
		this.#options = options;
	}

	/**
	 * Find a cached response for the given request
	 */
	async match(
		request: RequestInfo | URL,
		options?: CacheQueryOptions,
	): Promise<Response | undefined> {
		const req = toRequest(request);

		// When ignoreSearch is true, we need to iterate to find matches
		if (options?.ignoreSearch) {
			const filterKey = generateCacheKey(request, options);
			for (const [key, entry] of this.#storage) {
				if (this.#isExpired(entry)) {
					this.#storage.delete(key);
					continue;
				}
				const entryKey = generateCacheKey(entry.request, options);
				if (entryKey === filterKey) {
					// Check Vary header unless ignoreVary is true
					if (!options?.ignoreVary && !this.#matchesVary(req, entry)) {
						continue;
					}
					// Move to end for LRU (delete and re-add)
					this.#storage.delete(key);
					this.#storage.set(key, entry);
					return entry.response.clone();
				}
			}
			return undefined;
		}

		const key = generateCacheKey(request, options);
		const entry = this.#storage.get(key);

		if (!entry) {
			return undefined;
		}

		// Check if entry has expired
		if (this.#isExpired(entry)) {
			this.#storage.delete(key);
			return undefined;
		}

		// Check Vary header unless ignoreVary is true
		if (!options?.ignoreVary && !this.#matchesVary(req, entry)) {
			return undefined;
		}

		// Move to end for LRU (delete and re-add)
		this.#storage.delete(key);
		this.#storage.set(key, entry);

		// Clone the response to avoid mutation
		return entry.response.clone();
	}

	/**
	 * Store a request/response pair in the cache
	 */
	async put(request: RequestInfo | URL, response: Response): Promise<void> {
		const req = toRequest(request);
		const key = generateCacheKey(req);

		// Check if response body has already been used
		if (response.bodyUsed) {
			throw new TypeError("Response body has already been used");
		}

		// Clone request and response to avoid external mutation
		const clonedRequest = req.clone();
		const clonedResponse = response.clone();

		const entry: CacheEntry = {
			request: clonedRequest,
			response: clonedResponse,
			timestamp: Date.now(),
		};

		// If updating existing entry, delete first to move to end
		if (this.#storage.has(key)) {
			this.#storage.delete(key);
		}

		this.#storage.set(key, entry);

		// Enforce size limits
		this.#enforceMaxEntries();
	}

	/**
	 * Delete matching entries from the cache
	 */
	async delete(
		request: RequestInfo | URL,
		options?: CacheQueryOptions,
	): Promise<boolean> {
		// When ignoreSearch is true, we need to iterate to find matches
		if (options?.ignoreSearch) {
			const filterKey = generateCacheKey(request, options);
			let deleted = false;
			for (const [key, entry] of this.#storage) {
				const entryKey = generateCacheKey(entry.request, options);
				if (entryKey === filterKey) {
					this.#storage.delete(key);
					deleted = true;
				}
			}
			return deleted;
		}

		const key = generateCacheKey(request, options);
		return this.#storage.delete(key);
	}

	/**
	 * Get all stored requests, optionally filtered by a request pattern
	 */
	async keys(
		request?: RequestInfo | URL,
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
	 * Check if a request matches the Vary header of a cached entry
	 * Returns true if the request matches or if there's no Vary header
	 */
	#matchesVary(request: Request, entry: CacheEntry): boolean {
		const varyHeader = entry.response.headers.get("vary");

		// No Vary header means response doesn't vary on any headers
		if (!varyHeader) {
			return true;
		}

		// Vary: * means response varies on everything, never matches
		if (varyHeader === "*") {
			return false;
		}

		// Parse Vary header (comma-separated list of header names)
		const varyHeaders = varyHeader
			.split(",")
			.map((h) => h.trim().toLowerCase());

		// Check if all varying headers match between requests
		for (const headerName of varyHeaders) {
			const requestValue = request.headers.get(headerName);
			const cachedValue = entry.request.headers.get(headerName);

			// Headers must match exactly (null === null is okay)
			if (requestValue !== cachedValue) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Enforce maximum entry limits using LRU eviction
	 * Removes oldest entries (first in Map iteration order)
	 */
	#enforceMaxEntries(): void {
		if (
			!this.#options.maxEntries ||
			this.#storage.size <= this.#options.maxEntries
		) {
			return;
		}

		// Remove oldest entries until we're under the limit
		// Map iteration order is insertion order, so first entries are oldest
		const toRemove = this.#storage.size - this.#options.maxEntries;
		let removed = 0;
		for (const key of this.#storage.keys()) {
			if (removed >= toRemove) break;
			this.#storage.delete(key);
			removed++;
		}
	}
}

export default MemoryCache;
