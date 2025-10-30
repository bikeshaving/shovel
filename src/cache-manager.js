/**
 * Cache Manager for Main Thread
 * 
 * Coordinates cache operations across all Worker threads by managing
 * a shared CacheStorage instance and handling postMessage requests.
 */

export class CacheManager {
  constructor(cacheStorage) {
    this.cacheStorage = cacheStorage;
    this.requestCounter = 0;
    this.pendingRequests = new Map();
  }

  /**
   * Handle cache-related message from a Worker
   */
  async handleMessage(worker, message) {
    const { type, requestId } = message;
    
    try {
      let result;
      
      switch (type) {
        case 'cache:open':
          result = await this.handleOpen(message);
          break;
          
        case 'cache:match':
          result = await this.handleMatch(message);
          break;
          
        case 'cache:put':
          result = await this.handlePut(message);
          break;
          
        case 'cache:delete':
          result = await this.handleDelete(message);
          break;
          
        case 'cache:keys':
          result = await this.handleKeys(message);
          break;
          
        case 'cachestorage:has':
          result = await this.handleStorageHas(message);
          break;
          
        case 'cachestorage:delete':
          result = await this.handleStorageDelete(message);
          break;
          
        case 'cachestorage:keys':
          result = await this.handleStorageKeys(message);
          break;
          
        default:
          throw new Error(`Unknown cache operation: ${type}`);
      }
      
      // Send success response
      worker.postMessage({
        type: 'cache:response',
        requestId,
        result
      });
      
    } catch (error) {
      // Send error response
      worker.postMessage({
        type: 'cache:error',
        requestId,
        error: error.message
      });
    }
  }

  async handleOpen({ name }) {
    const cache = await this.cacheStorage.open(name);
    // Return a cache identifier (name) instead of the cache instance
    return name;
  }

  async handleMatch({ cacheName, request, options }) {
    const cache = await this.cacheStorage.open(cacheName);
    const response = await cache.match(request, options);
    return response; // Response objects are structured cloneable
  }

  async handlePut({ cacheName, request, response }) {
    const cache = await this.cacheStorage.open(cacheName);
    await cache.put(request, response);
    return true;
  }

  async handleDelete({ cacheName, request, options }) {
    const cache = await this.cacheStorage.open(cacheName);
    const deleted = await cache.delete(request, options);
    return deleted;
  }

  async handleKeys({ cacheName, request, options }) {
    const cache = await this.cacheStorage.open(cacheName);
    const keys = await cache.keys(request, options);
    return keys; // Request arrays are structured cloneable
  }

  async handleStorageHas({ name }) {
    const exists = await this.cacheStorage.has(name);
    return exists;
  }

  async handleStorageDelete({ name }) {
    const deleted = await this.cacheStorage.delete(name);
    return deleted;
  }

  async handleStorageKeys() {
    const keys = await this.cacheStorage.keys();
    return keys;
  }
}