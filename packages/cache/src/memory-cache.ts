import { Cache, generateCacheKey, cloneResponse, type CacheQueryOptions } from './cache.js';

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
    private options: MemoryCacheOptions = {}
  ) {
    super();
  }

  /**
   * Find a cached response for the given request
   */
  async match(request: Request, options?: CacheQueryOptions): Promise<Response | undefined> {
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
    
    // Return a clone of the response since responses can only be consumed once
    return cloneResponse(entry.response);
  }

  /**
   * Store a request/response pair in the cache
   */
  async put(request: Request, response: Response): Promise<void> {
    const key = generateCacheKey(request);
    
    // Clone the response since it can only be consumed once
    const clonedResponse = await cloneResponse(response);
    
    const entry: CacheEntry = {
      request: new Request(request),
      response: clonedResponse,
      timestamp: Date.now()
    };

    this.storage.set(key, entry);
    this.accessOrder.set(key, ++this.accessCounter);

    // Evict entries if we're over the limit
    this.evictIfNeeded();
  }

  /**
   * Delete a cached entry
   */
  async delete(request: Request, options?: CacheQueryOptions): Promise<boolean> {
    const key = generateCacheKey(request, options);
    const had = this.storage.has(key);
    
    this.storage.delete(key);
    this.accessOrder.delete(key);
    
    return had;
  }

  /**
   * Get all cached request keys
   */
  async keys(request?: Request, options?: CacheQueryOptions): Promise<Request[]> {
    const requests: Request[] = [];
    
    // Clean up expired entries first
    this.cleanupExpired();
    
    for (const [key, entry] of this.storage) {
      // If a specific request is provided, only return matching keys
      if (request) {
        const requestKey = generateCacheKey(request, options);
        if (key !== requestKey) {
          continue;
        }
      }
      
      requests.push(new Request(entry.request));
    }
    
    return requests;
  }

  /**
   * Get cache statistics
   */
  getStats() {
    this.cleanupExpired();
    
    return {
      name: this.name,
      entryCount: this.storage.size,
      maxEntries: this.options.maxEntries,
      maxAge: this.options.maxAge
    };
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
   * Remove expired entries from the cache
   */
  private cleanupExpired(): void {
    if (!this.options.maxAge) {
      return;
    }

    const now = Date.now();
    const keysToDelete: string[] = [];
    
    for (const [key, entry] of this.storage) {
      if (now - entry.timestamp > this.options.maxAge) {
        keysToDelete.push(key);
      }
    }
    
    keysToDelete.forEach(key => {
      this.storage.delete(key);
      this.accessOrder.delete(key);
    });
  }

  /**
   * Evict least recently used entries if over the maximum
   */
  private evictIfNeeded(): void {
    if (!this.options.maxEntries || this.storage.size <= this.options.maxEntries) {
      return;
    }

    // Find the least recently used entries
    const sortedByAccess = Array.from(this.accessOrder.entries())
      .sort(([, accessA], [, accessB]) => accessA - accessB);

    const entriesToEvict = this.storage.size - this.options.maxEntries;
    
    for (let i = 0; i < entriesToEvict; i++) {
      const [keyToEvict] = sortedByAccess[i];
      this.storage.delete(keyToEvict);
      this.accessOrder.delete(keyToEvict);
    }
  }
}