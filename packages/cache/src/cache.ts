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
	): Promise<Request[]>;

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

/**
 * Clone a Response object for storage
 * Responses can only be consumed once, so we need to clone them for caching
 */
export async function cloneResponse(response: Response): Promise<Response> {
	return response.clone();
}
