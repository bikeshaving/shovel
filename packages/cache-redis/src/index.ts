/**
 * @b9g/cache-redis - Redis cache adapter for Shovel
 * 
 * Provides Redis-backed caching with HTTP-aware storage and retrieval
 */

export {RedisCache, type RedisCacheOptions} from "./redis-cache.js";
export {createRedisFactory} from "./factory.js";

import {RedisCache, type RedisCacheOptions} from "./redis-cache.js";

/**
 * Platform adapter factory function
 * Creates a RedisCache instance with the given configuration
 */
export function createCache(config: RedisCacheOptions & { name?: string } = {}): RedisCache {
	const name = config.name || "default";
	return new RedisCache(name, config);
}