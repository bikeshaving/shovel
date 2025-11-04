/**
 * @b9g/cache-redis - Redis cache adapter for Shovel
 * 
 * Provides Redis-backed caching with HTTP-aware storage and retrieval
 */

export {RedisCache, type RedisCacheOptions} from "./redis-cache.js";
export {createRedisFactory} from "./factory.js";