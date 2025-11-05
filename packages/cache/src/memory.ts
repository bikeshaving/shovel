import {
	Cache,
	generateCacheKey,
	cloneResponse,
	type CacheQueryOptions,
} from "./cache.js";

/**
 * Configuration options for MemoryCache
 */
export interface MemoryCacheOptions {
	/** Maximum number of entries to store */
	maxEntries?: number;
	/** Maximum age of entries in milliseconds */
	maxAge?: number;
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
	private storage = new Map<string, CacheEntry>();
	private accessOrder = new Map<string, number>(); // For LRU tracking
	private accessCounter = 0;

	constructor(
		private name: string,
		private options: MemoryCacheOptions = {},
	) {
		super();
	}

	/**
	 * Find a cached response for the given request
	 */
	async match(
		request: Request,
		options?: CacheQueryOptions,
	): Promise<Response | undefined> {
		const key = generateCacheKey(request, options);
		const entry = this.storage.get(key);

		if (!entry) {
			return undefined;
		}

		// Check if entry has expired
		if (this.isExpired(entry)) {
			this.storage.delete(key);
			this.accessOrder.delete(key);
			return undefined;
		}

		// Update access order for LRU
		this.accessOrder.set(key, ++this.accessCounter);

		// Clone the response to avoid mutation
		return cloneResponse(entry.response);
	}

	/**
	 * Store a request/response pair in the cache
	 */
	async put(request: Request, response: Response): Promise<void> {
		const key = generateCacheKey(request);

		// Check if response is cacheable
		if (!this.isCacheable(response)) {
			return;
		}

		// Clone request and response to avoid external mutation
		const clonedRequest = request.clone();
		const clonedResponse = cloneResponse(response);

		const entry: CacheEntry = {
			request: clonedRequest,
			response: clonedResponse,
			timestamp: Date.now(),
		};

		this.storage.set(key, entry);
		this.accessOrder.set(key, ++this.accessCounter);

		// Enforce size limits
		this.enforceMaxEntries();
	}

	/**
	 * Delete matching entries from the cache
	 */
	async delete(
		request: Request,
		options?: CacheQueryOptions,
	): Promise<boolean> {
		const key = generateCacheKey(request, options);
		const deleted = this.storage.delete(key);
		
		if (deleted) {
			this.accessOrder.delete(key);
		}
		
		return deleted;
	}

	/**
	 * Get all stored requests, optionally filtered by a request pattern
	 */
	async keys(
		request?: Request,
		options?: CacheQueryOptions,
	): Promise<Request[]> {
		const keys: Request[] = [];

		for (const [_, entry] of this.storage) {
			// Skip expired entries
			if (this.isExpired(entry)) {
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
		this.storage.clear();
		this.accessOrder.clear();
		this.accessCounter = 0;
	}

	/**
	 * Get cache statistics
	 */
	getStats() {
		return {
			name: this.name,
			size: this.storage.size,
			maxEntries: this.options.maxEntries,
			maxAge: this.options.maxAge,
			hitRate: 0, // Could be implemented with additional tracking
		};
	}

	/**
	 * Dispose of the cache and clean up resources
	 */
	async dispose(): Promise<void> {
		await this.clear();
	}

	/**
	 * Check if a cache entry has expired
	 */
	private isExpired(entry: CacheEntry): boolean {
		if (!this.options.maxAge) {
			return false;
		}

		return Date.now() - entry.timestamp > this.options.maxAge;
	}

	/**
	 * Check if a response should be cached
	 */
	private isCacheable(response: Response): boolean {
		// Don't cache error responses by default
		if (!response.ok) {
			return false;
		}

		// Check Cache-Control header
		const cacheControl = response.headers.get("cache-control");
		if (cacheControl) {
			if (cacheControl.includes("no-cache") || cacheControl.includes("no-store")) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Enforce maximum entry limits using LRU eviction
	 */
	private enforceMaxEntries(): void {
		if (!this.options.maxEntries || this.storage.size <= this.options.maxEntries) {
			return;
		}

		// Sort by access order and remove oldest entries
		const entries = Array.from(this.accessOrder.entries())
			.sort((a, b) => a[1] - b[1]);

		const toRemove = this.storage.size - this.options.maxEntries;
		for (let i = 0; i < toRemove; i++) {
			const [key] = entries[i];
			this.storage.delete(key);
			this.accessOrder.delete(key);
		}
	}
}

/**
 * Memory Cache Manager for Main Thread
 *
 * Coordinates MemoryCache operations across Worker threads by managing
 * shared MemoryCache instances and handling postMessage requests.
 *
 * Only MemoryCache needs coordination since it stores data in process memory.
 * Other cache types can be used directly by workers without coordination.
 */

// Use web standard Worker type for platform independence
interface WorkerLike {
	postMessage(value: any): void;
	on(event: string, listener: (data: any) => void): void;
}

interface CacheMessage {
	type: string;
	requestId: string;
	cacheName: string;
	request?: SerializedRequest;
	response?: SerializedResponse;
	options?: any;
}

interface SerializedRequest {
	url: string;
	method: string;
	headers: Record<string, string>;
	body?: string;
}

interface SerializedResponse {
	status: number;
	statusText: string;
	headers: Record<string, string>;
	body: string;
}

export class MemoryCacheManager {
	private memoryCaches = new Map<string, MemoryCache>();

	/**
	 * Handle memory cache-related message from a Worker
	 */
	async handleMessage(worker: WorkerLike, message: CacheMessage): Promise<void> {
		const {type, requestId} = message;

		try {
			let result: any;

			switch (type) {
				case "cache:match":
					result = await this.handleMatch(message);
					break;
				case "cache:put":
					result = await this.handlePut(message);
					break;
				case "cache:delete":
					result = await this.handleDelete(message);
					break;
				case "cache:keys":
					result = await this.handleKeys(message);
					break;
				case "cache:clear":
					result = await this.handleClear(message);
					break;
				default:
					throw new Error(`Unknown cache operation: ${type}`);
			}

			worker.postMessage({
				type: "cache:response",
				requestId,
				result,
			});
		} catch (error) {
			worker.postMessage({
				type: "cache:error",
				requestId,
				error: error.message,
			});
		}
	}

	/**
	 * Get or create a MemoryCache instance
	 */
	private getMemoryCache(name: string, options?: MemoryCacheOptions): MemoryCache {
		if (!this.memoryCaches.has(name)) {
			this.memoryCaches.set(name, new MemoryCache(name, options));
		}
		return this.memoryCaches.get(name)!;
	}

	private async handleMatch(
		message: CacheMessage,
	): Promise<SerializedResponse | undefined> {
		const {cacheName, request, options} = message;
		if (!request) throw new Error("Request is required for match operation");

		const cache = this.getMemoryCache(cacheName);

		// Reconstruct Request object
		const req = new Request(request.url, {
			method: request.method,
			headers: request.headers,
			body: request.body,
		});

		const response = await cache.match(req, options);

		if (!response) {
			return undefined;
		}

		// Serialize response for transmission
		return {
			status: response.status,
			statusText: response.statusText,
			headers: Object.fromEntries(response.headers.entries()),
			body: await response.text(),
		};
	}

	private async handlePut(message: CacheMessage): Promise<boolean> {
		const {cacheName, request, response} = message;
		if (!request || !response)
			throw new Error("Request and response are required for put operation");

		const cache = this.getMemoryCache(cacheName);

		// Reconstruct Request and Response objects
		const req = new Request(request.url, {
			method: request.method,
			headers: request.headers,
			body: request.body,
		});

		const res = new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers,
		});

		await cache.put(req, res);
		return true;
	}

	private async handleDelete(message: CacheMessage): Promise<boolean> {
		const {cacheName, request, options} = message;
		if (!request) throw new Error("Request is required for delete operation");

		const cache = this.getMemoryCache(cacheName);

		// Reconstruct Request object
		const req = new Request(request.url, {
			method: request.method,
			headers: request.headers,
			body: request.body,
		});

		return await cache.delete(req, options);
	}

	private async handleKeys(
		message: CacheMessage,
	): Promise<SerializedRequest[]> {
		const {cacheName, request, options} = message;
		const cache = this.getMemoryCache(cacheName);

		let req: Request | undefined;
		if (request) {
			req = new Request(request.url, {
				method: request.method,
				headers: request.headers,
				body: request.body,
			});
		}

		const keys = await cache.keys(req, options);

		// Serialize requests for transmission
		return keys.map((r) => ({
			url: r.url,
			method: r.method,
			headers: Object.fromEntries(r.headers.entries()),
			body: undefined, // Keys typically don't need body
		}));
	}

	private async handleClear(message: CacheMessage): Promise<boolean> {
		const {cacheName} = message;
		const cache = this.getMemoryCache(cacheName);
		await cache.clear();
		return true;
	}

	/**
	 * Dispose of all memory caches
	 */
	async dispose(): Promise<void> {
		const disposePromises = Array.from(this.memoryCaches.values()).map((cache) =>
			cache.dispose(),
		);
		await Promise.all(disposePromises);
		this.memoryCaches.clear();
	}
}