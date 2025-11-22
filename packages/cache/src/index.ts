/**
 * @b9g/cache - Universal Cache API implementation
 *
 * Provides HTTP-aware caching with PostMessage coordination for worker environments
 */

// ============================================================================
// CACHE INTERFACE & UTILITIES
// ============================================================================

/**
 * Cache query options for matching requests
 * Based on the Cache API specification
 */
export interface CacheQueryOptions {
	/** Ignore the search portion of the request URL */
	ignoreSearch?: boolean;
	/** Ignore the request method */
	ignoreMethod?: boolean;
	/** Ignore the Vary header */
	ignoreVary?: boolean;
	/** Custom cache name for scoped operations */
	cacheName?: string;
}

/**
 * Abstract Cache class implementing the Cache API interface
 * Provides shared implementations for add() and addAll() while requiring
 * concrete implementations to handle the core storage operations
 */
export abstract class Cache {
	/**
	 * Returns a Promise that resolves to the response associated with the first matching request
	 */
	abstract match(
		request: Request,
		options?: CacheQueryOptions,
	): Promise<Response | undefined>;

	/**
	 * Puts a request/response pair into the cache
	 */
	abstract put(request: Request, response: Response): Promise<void>;

	/**
	 * Finds the cache entry whose key is the request, and if found, deletes it and returns true
	 */
	abstract delete(
		request: Request,
		options?: CacheQueryOptions,
	): Promise<boolean>;

	/**
	 * Returns a Promise that resolves to an array of cache keys (Request objects)
	 */
	abstract keys(
		request?: Request,
		options?: CacheQueryOptions,
	): Promise<readonly Request[]>;

	/**
	 * Takes a URL, retrieves it and adds the resulting response object to the cache
	 * Shared implementation using fetch() and put()
	 */
	async add(request: Request): Promise<void> {
		const response = await fetch(request);
		if (!response.ok) {
			throw new TypeError(
				`Failed to fetch ${request.url}: ${response.status} ${response.statusText}`,
			);
		}
		await this.put(request, response);
	}

	/**
	 * Takes an array of URLs, retrieves them, and adds the resulting response objects to the cache
	 * Shared implementation using add()
	 */
	async addAll(requests: Request[]): Promise<void> {
		// Process all requests in parallel
		await Promise.all(requests.map((request) => this.add(request)));
	}

	/**
	 * Returns a Promise that resolves to an array of all matching responses
	 * Default implementation using keys() and match() - can be overridden for efficiency
	 */
	async matchAll(
		request?: Request,
		options?: CacheQueryOptions,
	): Promise<Response[]> {
		const keys = await this.keys(request, options);
		const responses: Response[] = [];

		for (const key of keys) {
			const response = await this.match(key, options);
			if (response) {
				responses.push(response);
			}
		}

		return responses;
	}
}

/**
 * Generate a cache key from a Request object
 * Normalizes the request for consistent cache key generation
 */
export function generateCacheKey(
	request: Request,
	options?: CacheQueryOptions,
): string {
	const url = new URL(request.url);

	// Normalize search parameters if ignoreSearch is true
	if (options?.ignoreSearch) {
		url.search = "";
	}

	// Include method unless ignoreMethod is true
	const method = options?.ignoreMethod ? "GET" : request.method;

	// For now, create a simple key - can be enhanced with vary header handling
	return `${method}:${url.href}`;
}

// ============================================================================
// CACHE STORAGE
// ============================================================================

/**
 * Factory function for creating Cache instances based on cache name
 */
export type CacheFactory = (name: string) => Cache | Promise<Cache>;

/**
 * CustomCacheStorage implements CacheStorage interface with a configurable factory
 * The factory function receives the cache name and can return different cache types
 */
export class CustomCacheStorage {
	#instances: Map<string, Cache>;
	#factory: CacheFactory;

	constructor(factory: CacheFactory) {
		this.#instances = new Map<string, Cache>();
		this.#factory = factory;
	}

	/**
	 * Matches a request across all caches
	 */
	async match(
		request: Request,
		options?: CacheQueryOptions,
	): Promise<Response | undefined> {
		// Try each cache in order until we find a match
		for (const cache of this.#instances.values()) {
			const response = await cache.match(request, options);
			if (response) {
				return response;
			}
		}
		return undefined;
	}

	/**
	 * Opens a cache with the given name
	 * Returns existing instance if already opened, otherwise creates a new one
	 */
	async open(name: string): Promise<Cache> {
		// Return existing instance if already opened
		const existingInstance = this.#instances.get(name);
		if (existingInstance) {
			return existingInstance;
		}

		// Create new instance using factory function
		const cache = await this.#factory(name);
		this.#instances.set(name, cache);
		return cache;
	}

	/**
	 * Returns true if a cache with the given name exists (has been opened)
	 */
	async has(name: string): Promise<boolean> {
		return this.#instances.has(name);
	}

	/**
	 * Deletes a cache with the given name
	 */
	async delete(name: string): Promise<boolean> {
		const instance = this.#instances.get(name);
		if (instance) {
			this.#instances.delete(name);
			return true;
		}
		return false;
	}

	/**
	 * Returns a list of all opened cache names
	 */
	async keys(): Promise<string[]> {
		return Array.from(this.#instances.keys());
	}

	/**
	 * Get statistics about the cache storage
	 */
	getStats() {
		return {
			openInstances: this.#instances.size,
			cacheNames: Array.from(this.#instances.keys()),
		};
	}

	/**
	 * Dispose of all cache instances
	 * Calls dispose() on each cache if it exists (e.g., RedisCache needs to close connections)
	 */
	async dispose(): Promise<void> {
		const disposePromises: Promise<void>[] = [];

		for (const cache of this.#instances.values()) {
			// Check if cache has a dispose method (RedisCache, etc.)
			if (typeof (cache as any).dispose === "function") {
				disposePromises.push((cache as any).dispose());
			}
		}

		// Wait for all caches to dispose
		await Promise.allSettled(disposePromises);

		// Clear the instances map
		this.#instances.clear();
	}

	/**
	 * Handle cache messages from worker threads (PostMessageCache coordination)
	 */
	async handleMessage(worker: any, message: any): Promise<void> {
		const {type, requestId, cacheName} = message;

		try {
			const cache = await this.open(cacheName);
			let result: any;

			switch (type) {
				case "cache:match": {
					const req = new Request(message.request.url, message.request);
					const response = await cache.match(req, message.options);
					result = response
						? {
								status: response.status,
								statusText: response.statusText,
								headers: Object.fromEntries(response.headers),
								body: await response.text(),
							}
						: undefined;
					break;
				}
				case "cache:put": {
					const req = new Request(message.request.url, message.request);
					const res = new Response(message.response.body, message.response);
					await cache.put(req, res);
					result = true;
					break;
				}
				case "cache:delete": {
					const req = new Request(message.request.url, message.request);
					result = await cache.delete(req, message.options);
					break;
				}
				case "cache:keys": {
					const req = message.request
						? new Request(message.request.url, message.request)
						: undefined;
					const keys = await cache.keys(req, message.options);
					result = keys.map((r) => ({
						url: r.url,
						method: r.method,
						headers: Object.fromEntries(r.headers.entries()),
					}));
					break;
				}
				case "cache:clear":
					await (cache as any).clear?.();
					result = true;
					break;
			}

			worker.postMessage({type: "cache:response", requestId, result});
		} catch (error: any) {
			worker.postMessage({
				type: "cache:error",
				requestId,
				error: error.message,
			});
		}
	}
}
