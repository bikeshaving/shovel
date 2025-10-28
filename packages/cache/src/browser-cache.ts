import { Cache as AbstractCache, type CacheQueryOptions } from './cache.js';

/**
 * Configuration options for BrowserCache
 */
export interface BrowserCacheOptions {
  /** Whether to fallback to in-memory storage if CacheStorage is not available */
  fallbackToMemory?: boolean;
  /** Custom CacheStorage instance (for testing) */
  cacheStorage?: CacheStorage;
}

/**
 * Browser cache implementation that wraps the native Cache API
 * Works in Service Workers and browsers that support CacheStorage
 */
export class BrowserCache extends AbstractCache {
  private nativeCache: Promise<Cache | null>;
  private fallbackCache?: AbstractCache;

  constructor(
    private name: string,
    private options: BrowserCacheOptions = {}
  ) {
    super();
    
    this.nativeCache = this.initializeNativeCache();
  }

  /**
   * Find a cached response for the given request
   */
  async match(request: Request, options?: CacheQueryOptions): Promise<Response | undefined> {
    const cache = await this.nativeCache;
    
    if (cache) {
      // Use native cache API
      const result = await cache.match(request, this.convertCacheOptions(options));
      return result || undefined;
    }

    // Fall back to alternative implementation
    if (this.fallbackCache) {
      return this.fallbackCache.match(request, options);
    }

    return undefined;
  }

  /**
   * Store a request/response pair in the cache
   */
  async put(request: Request, response: Response): Promise<void> {
    const cache = await this.nativeCache;
    
    if (cache) {
      // Use native cache API
      await cache.put(request, response);
      return;
    }

    // Fall back to alternative implementation
    if (this.fallbackCache) {
      await this.fallbackCache.put(request, response);
      return;
    }

    throw new Error('BrowserCache: No cache implementation available');
  }

  /**
   * Delete a cached entry
   */
  async delete(request: Request, options?: CacheQueryOptions): Promise<boolean> {
    const cache = await this.nativeCache;
    
    if (cache) {
      // Use native cache API
      return await cache.delete(request, this.convertCacheOptions(options));
    }

    // Fall back to alternative implementation
    if (this.fallbackCache) {
      return this.fallbackCache.delete(request, options);
    }

    return false;
  }

  /**
   * Get all cached request keys
   */
  async keys(request?: Request, options?: CacheQueryOptions): Promise<Request[]> {
    const cache = await this.nativeCache;
    
    if (cache) {
      // Use native cache API
      return await cache.keys(request, this.convertCacheOptions(options));
    }

    // Fall back to alternative implementation
    if (this.fallbackCache) {
      return this.fallbackCache.keys(request, options);
    }

    return [];
  }

  /**
   * Check if native CacheStorage is available
   */
  static isSupported(): boolean {
    // Check if we're in a Service Worker context
    if (typeof self !== 'undefined' && 'caches' in self) {
      return true;
    }

    // Check if we're in a browser with CacheStorage support
    if (typeof window !== 'undefined' && 'caches' in window) {
      return true;
    }

    // Check for CacheStorage in global scope (for other environments)
    if (typeof globalThis !== 'undefined' && 'caches' in globalThis) {
      return true;
    }

    return false;
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      name: this.name,
      type: 'browser',
      nativeSupport: BrowserCache.isSupported(),
      hasFallback: !!this.fallbackCache
    };
  }

  /**
   * Clear all entries from the cache
   */
  async clear(): Promise<void> {
    // For browser cache, we need to delete and recreate the cache
    const cacheStorage = this.getCacheStorage();
    
    if (cacheStorage) {
      try {
        await cacheStorage.delete(this.name);
        // The cache will be recreated on next access
        this.nativeCache = this.initializeNativeCache();
      } catch (error) {
        console.warn(`Failed to clear browser cache '${this.name}':`, error);
      }
    }

    if (this.fallbackCache && 'clear' in this.fallbackCache) {
      await (this.fallbackCache as any).clear();
    }
  }

  /**
   * Dispose of the cache and clean up resources
   */
  async dispose(): Promise<void> {
    // For browser cache, we can optionally delete the cache entirely
    await this.clear();
    
    if (this.fallbackCache && this.fallbackCache.dispose) {
      await this.fallbackCache.dispose();
    }
  }

  /**
   * Initialize the native cache instance
   */
  private async initializeNativeCache(): Promise<Cache | null> {
    try {
      const cacheStorage = this.getCacheStorage();
      
      if (cacheStorage) {
        return await cacheStorage.open(this.name);
      }

      // If native cache is not available, set up fallback
      if (this.options.fallbackToMemory) {
        await this.initializeFallback();
      }

      return null;

    } catch (error) {
      console.warn(`Failed to initialize browser cache '${this.name}':`, error);
      
      // Try to set up fallback on error
      if (this.options.fallbackToMemory) {
        await this.initializeFallback();
      }
      
      return null;
    }
  }

  /**
   * Initialize fallback cache implementation
   */
  private async initializeFallback(): Promise<void> {
    if (this.fallbackCache) {
      return;
    }

    try {
      // Dynamically import MemoryCache to avoid circular dependencies
      const { MemoryCache } = await import('./memory-cache.js');
      this.fallbackCache = new MemoryCache(this.name);
    } catch (error) {
      console.warn(`Failed to initialize fallback cache:`, error);
    }
  }

  /**
   * Get the CacheStorage instance
   */
  private getCacheStorage(): CacheStorage | null {
    // Use provided CacheStorage (for testing)
    if (this.options.cacheStorage) {
      return this.options.cacheStorage;
    }

    // Try to get CacheStorage from various global contexts
    if (typeof self !== 'undefined' && 'caches' in self) {
      return self.caches;
    }

    if (typeof window !== 'undefined' && 'caches' in window) {
      return window.caches;
    }

    if (typeof globalThis !== 'undefined' && 'caches' in globalThis) {
      return (globalThis as any).caches;
    }

    return null;
  }

  /**
   * Convert our CacheQueryOptions to native CacheQueryOptions
   */
  private convertCacheOptions(options?: CacheQueryOptions): CacheQueryOptions | undefined {
    if (!options) {
      return undefined;
    }

    // The native Cache API uses the same option names, so we can pass through
    // We just need to exclude our custom options
    const { cacheName, ...nativeOptions } = options;
    return nativeOptions;
  }
}

/**
 * Utility function to create a BrowserCache with automatic fallback
 */
export function createBrowserCache(name: string, options: BrowserCacheOptions = {}): BrowserCache {
  return new BrowserCache(name, {
    fallbackToMemory: true,
    ...options
  });
}

/**
 * Check if the current environment supports browser caching
 */
export function isBrowserCacheSupported(): boolean {
  return BrowserCache.isSupported();
}

/**
 * Get information about the browser cache environment
 */
export function getBrowserCacheInfo() {
  const hasServiceWorker = typeof self !== 'undefined' && 'ServiceWorkerGlobalScope' in self;
  const hasWindow = typeof window !== 'undefined';
  const hasCacheStorage = BrowserCache.isSupported();
  
  let context = 'unknown';
  if (hasServiceWorker) {
    context = 'service-worker';
  } else if (hasWindow) {
    context = 'window';
  } else {
    context = 'worker';
  }

  return {
    supported: hasCacheStorage,
    context,
    hasServiceWorker,
    hasWindow,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'
  };
}