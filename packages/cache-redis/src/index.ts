/**
 * @b9g/cache-redis - Redis cache adapter for Shovel
 *
 * Provides Redis-backed caching with HTTP-aware storage and retrieval
 */

import {Cache, type CacheQueryOptions, generateCacheKey} from "@b9g/cache";
import {createClient, type RedisClientOptions} from "redis";
import {getLogger} from "@logtape/logtape";

const logger = getLogger(["server"]);

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
		if (!this.#connected && !this.#client.isReady) {
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
	async #serializeResponse(response: Response): Promise<CacheEntry> {
		// Check response size before serialization
		const cloned = response.clone();
		const body = await cloned.arrayBuffer();

		if (body.byteLength > this.#maxEntrySize) {
			throw new Error(
				`Response body too large: ${body.byteLength} bytes (max: ${this.#maxEntrySize})`,
			);
		}

		// Convert headers to plain object
		const headers: Record<string, string> = {};
		response.headers.forEach((value, key) => {
			headers[key] = value;
		});

		return {
			status: response.status,
			statusText: response.statusText,
			headers,
			body: uint8ArrayToBase64(new Uint8Array(body)),
			cachedAt: Date.now(),
			TTL: this.#defaultTTL,
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
			const entry = await this.#serializeResponse(response);
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
					const [method, url] = cacheKey.split(":", 2);

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
	 * Get cache statistics
	 */
	async getStats() {
		try {
			await this.#ensureConnected();

			const pattern = `${this.#prefix}:*`;
			let keyCount = 0;
			let totalSize = 0;

			for await (const key of this.#client.scanIterator({
				MATCH: pattern,
				COUNT: 100,
			})) {
				keyCount++;
				try {
					const value = await this.#client.get(key);
					if (value) {
						// Use web-standard text encoding instead of Node.js Buffer
						totalSize += new TextEncoder().encode(value).length;
					}
				} catch (err) {
					// Skip individual key errors but log them for debugging
					logger.debug("Error reading key {key}: {error}", {key, error: err});
				}
			}

			return {
				connected: this.#connected,
				keyCount,
				totalSize,
				prefix: this.#prefix,
				defaultTTL: this.#defaultTTL,
				maxEntrySize: this.#maxEntrySize,
			};
		} catch (error) {
			logger.error("Failed to get stats: {error}", {error});
			return {
				connected: false,
				keyCount: 0,
				totalSize: 0,
				prefix: this.#prefix,
				defaultTTL: this.#defaultTTL,
				maxEntrySize: this.#maxEntrySize,
			};
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
