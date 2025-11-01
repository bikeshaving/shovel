/**
 * @b9g/cache - Universal Cache API implementation
 * 
 * Provides HTTP-aware caching with PostMessage coordination for worker environments
 */

// Core cache interface and utilities
export {Cache, type CacheQueryOptions, generateCacheKey, cloneResponse} from "./cache.js";

// CustomCacheStorage with factory pattern
export {CustomCacheStorage, type CacheFactory} from "./cache-storage.js";

// Memory cache implementation (main thread)
export {MemoryCache, MemoryCacheManager, type MemoryCacheOptions} from "./memory.js";

// PostMessage cache (worker thread coordination)
export {PostMessageCache, type PostMessageCacheOptions} from "./postmessage.js";