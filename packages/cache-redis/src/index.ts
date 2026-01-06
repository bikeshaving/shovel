/**
 * @b9g/cache-redis - Redis cache adapter for Shovel
 *
 * Provides Redis-backed caching with HTTP-aware storage and retrieval
 */

import {Cache, type CacheQueryOptions, generateCacheKey} from "@b9g/cache";
import {createClient, type RedisClientOptions} from "redis";
import {getLogger} from "@logtape/logtape";

const logger = getLogger(["shovel", "cache"]);

/** Encode Uint8Array to base64 string (no spread operator for efficiency) */
function uint8ArrayToBase64(bytes: Uint8Array): string {
	let binary = "";
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

/** Decode base64 string to Uint8Array */
function base64ToUint8Array(base64: string): Uint8Array {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

// ============================================================================
// TYPES
// ============================================================================

export interface RedisCacheOptions {
	/** Redis connection options */
	redis?: RedisClientOptions;
	/** Cache name prefix for Redis keys */
	prefix?: string;
	/** Default TTL in seconds (0 = no expiration) */
	defaultTTL?: number;
	/** Maximum cache entry size in bytes */
	maxEntrySize?: number;
}

interface CacheEntry {
	/** Response status code */
	status: number;
	/** Response status text */
	statusText: string;
	/** Response headers as key-value pairs */
	headers: Record<string, string>;
	/** Response body as base64-encoded string */
	body: string;
	/** Timestamp when cached */
	cachedAt: number;
	/** TTL in seconds (0 = no expiration) */
	TTL: number;
	/** Request headers for Vary checking */
	requestHeaders: Record<string, string>;
}

// ============================================================================
// IMPLEMENTATION
// ============================================================================

/**
 * Redis-backed cache implementation
 * Stores HTTP responses with proper serialization and TTL support
 */
export class RedisCache extends Cache {
	#client: ReturnType<typeof createClient>;
	#prefix: string;
	#defaultTTL: number;
	#maxEntrySize: number;
	#connected: boolean;

	constructor(name: string, options: RedisCacheOptions = {}) {
		super();

		this.#client = createClient(options.redis || {});
		this.#prefix = options.prefix
			? `${options.prefix}:${name}`
			: `cache:${name}`;
		this.#defaultTTL = options.defaultTTL || 0; // 0 = no expiration
		this.#maxEntrySize = options.maxEntrySize || 10 * 1024 * 1024; // 10MB default
		this.#connected = false;

		// Set up error handling
		this.#client.on("error", (err) => {
			logger.error("Redis error: {error}", {error: err});
		});

		this.#client.on("connect", () => {
			logger.info("Connected to Redis", {cache: name});
			this.#connected = true;
		});

		this.#client.on("disconnect", () => {
			logger.warn("Disconnected from Redis", {cache: name});
			this.#connected = false;
		});
	}

	/**
	 * Ensure Redis client is connected
	 */
	async #ensureConnected(): Promise<void> {
		if (!this.#client.isOpen && !this.#client.isReady) {
			await this.#client.connect();
		}
	}

	/**
	 * Generate Redis key for cache entry
	 */
	#getRedisKey(request: Request, options?: CacheQueryOptions): string {
		const cacheKey = generateCacheKey(request, options);
		return `${this.#prefix}:${cacheKey}`;
	}

	/**
	 * Serialize Response to cache entry
	 */
	async #serializeResponse(
		request: Request,
		response: Response,
	): Promise<CacheEntry> {
		// Check response size before serialization
		const cloned = response.clone();
		const body = await cloned.arrayBuffer();

		if (body.byteLength > this.#maxEntrySize) {
			throw new Error(
				`Response body too large: ${body.byteLength} bytes (max: ${this.#maxEntrySize})`,
			);
		}

		// Convert response headers to plain object
		const headers: Record<string, string> = {};
		response.headers.forEach((value, key) => {
			headers[key] = value;
		});

		// Convert request headers to plain object (for Vary checking)
		const requestHeaders: Record<string, string> = {};
		request.headers.forEach((value, key) => {
			requestHeaders[key] = value;
		});

		// Determine TTL from Cache-Control header or use default
		let ttl = this.#defaultTTL;
		const cacheControl = response.headers.get("cache-control");
		if (cacheControl) {
			const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
			if (maxAgeMatch) {
				ttl = parseInt(maxAgeMatch[1], 10);
			}
		}

		return {
			status: response.status,
			statusText: response.statusText,
			headers,
			body: uint8ArrayToBase64(new Uint8Array(body)),
			cachedAt: Date.now(),
			TTL: ttl,
			requestHeaders,
		};
	}

	/**
	 * Deserialize cache entry to Response
	 */
	#deserializeResponse(entry: CacheEntry): Response {
		const body = base64ToUint8Array(entry.body);

		return new Response(body as unknown as BodyInit, {
			status: entry.status,
			statusText: entry.statusText,
			headers: entry.headers,
		});
	}

	/**
	 * Check if a request matches the Vary header of a cached entry
	 * Returns true if the request matches or if there's no Vary header
	 */
	#matchesVary(request: Request, entry: CacheEntry): boolean {
		const varyHeader = entry.headers["vary"] || entry.headers["Vary"];
		if (!varyHeader) {
			return true; // No Vary header means always matches
		}

		// Vary: * means never matches
		if (varyHeader === "*") {
			return false;
		}

		// Parse comma-separated header names
		const varyHeaders = varyHeader
			.split(",")
			.map((h) => h.trim().toLowerCase());

		// Check if all vary headers match
		for (const headerName of varyHeaders) {
			const requestValue = request.headers.get(headerName);
			const cachedValue = entry.requestHeaders[headerName] || null;

			if (requestValue !== cachedValue) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Returns a Promise that resolves to the response associated with the first matching request
	 */
	async match(
		request: Request,
		options?: CacheQueryOptions,
	): Promise<Response | undefined> {
		try {
			await this.#ensureConnected();

			const key = this.#getRedisKey(request, options);
			const cached = await this.#client.get(key);

			if (!cached) {
				return undefined;
			}

			const entry: CacheEntry = JSON.parse(cached);

			// Check if entry has expired (TTL > 0 means it expires)
			if (entry.TTL > 0) {
				const ageInSeconds = (Date.now() - entry.cachedAt) / 1000;
				if (ageInSeconds > entry.TTL) {
					// Entry expired, delete it
					await this.#client.del(key);
					return undefined;
				}
			}

			// Check Vary header unless ignoreVary is true
			if (!options?.ignoreVary && !this.#matchesVary(request, entry)) {
				return undefined;
			}

			return this.#deserializeResponse(entry);
		} catch (error) {
			logger.error("Failed to match: {error}", {error});
			return undefined;
		}
	}

	/**
	 * Puts a request/response pair into the cache
	 */
	async put(request: Request, response: Response): Promise<void> {
		try {
			await this.#ensureConnected();

			const key = this.#getRedisKey(request);
			const entry = await this.#serializeResponse(request, response);
			const serialized = JSON.stringify(entry);

			// Set with TTL if specified
			if (entry.TTL > 0) {
				await this.#client.setEx(key, entry.TTL, serialized);
			} else {
				await this.#client.set(key, serialized);
			}
		} catch (error) {
			logger.error("Failed to put: {error}", {error});
			throw error;
		}
	}

	/**
	 * Finds the cache entry whose key is the request, and if found, deletes it and returns true
	 */
	async delete(
		request: Request,
		options?: CacheQueryOptions,
	): Promise<boolean> {
		try {
			await this.#ensureConnected();

			const key = this.#getRedisKey(request, options);
			const result = await this.#client.del(key);
			return result > 0;
		} catch (error) {
			logger.error("Failed to delete: {error}", {error});
			return false;
		}
	}

	/**
	 * Returns a Promise that resolves to an array of cache keys (Request objects)
	 */
	async keys(
		request?: Request,
		options?: CacheQueryOptions,
	): Promise<Request[]> {
		try {
			await this.#ensureConnected();

			// If specific request provided, check if it exists
			if (request) {
				const key = this.#getRedisKey(request, options);
				const exists = await this.#client.exists(key);
				return exists ? [request] : [];
			}

			// Otherwise, scan for all keys with our prefix
			const pattern = `${this.#prefix}:*`;
			const keys: string[] = [];

			for await (const key of this.#client.scanIterator({
				MATCH: pattern,
				COUNT: 100,
			})) {
				keys.push(key);
			}

			// Convert Redis keys back to Request objects
			// This is approximate since we can't fully reconstruct the original request
			const requests: Request[] = [];
			for (const key of keys) {
				try {
					// Extract the cache key part and parse it
					const cacheKey = key.replace(`${this.#prefix}:`, "");
					// Split on first colon only (URL may contain colons)
					const colonIndex = cacheKey.indexOf(":");
					if (colonIndex === -1) continue;

					const method = cacheKey.substring(0, colonIndex);
					const url = cacheKey.substring(colonIndex + 1);

					if (method && url) {
						requests.push(new Request(url, {method}));
					}
				} catch (err) {
					if (!(err instanceof TypeError)) throw err; // URL parse error
				}
			}

			return requests;
		} catch (error) {
			logger.error("Failed to get keys: {error}", {error});
			return [];
		}
	}

	/**
	 * Dispose of Redis client connection
	 * Call this during graceful shutdown to properly close Redis connections
	 */
	async dispose(): Promise<void> {
		if (this.#connected || this.#client.isReady) {
			try {
				await this.#client.quit(); // Graceful shutdown - waits for pending commands
				logger.info("Redis connection closed", {prefix: this.#prefix});
			} catch (error) {
				logger.error("Error closing Redis connection: {error}", {error});
				// Force disconnect if graceful quit fails
				try {
					await this.#client.disconnect();
				} catch (disconnectError) {
					logger.error("Error forcing Redis disconnect: {error}", {
						error: disconnectError,
					});
				}
			}
		}
	}
}
