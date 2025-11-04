import {type CacheFactory} from "@b9g/cache";
import {RedisCache, type RedisCacheOptions} from "./redis-cache.js";

/**
 * Create a Redis cache factory for use with CustomCacheStorage
 * 
 * Example usage:
 * ```typescript
 * import {CustomCacheStorage} from "@b9g/cache";
 * import {createRedisFactory} from "@b9g/cache-redis";
 * 
 * const cacheStorage = new CustomCacheStorage(createRedisFactory({
 *   redis: { url: "redis://localhost:6379" },
 *   defaultTTL: 3600 // 1 hour
 * }));
 * 
 * const cache = await cacheStorage.open("my-cache");
 * ```
 */
export function createRedisFactory(options: RedisCacheOptions = {}): CacheFactory {
	return (name: string) => {
		return new RedisCache(name, options);
	};
}