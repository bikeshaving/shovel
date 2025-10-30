/**
 * Memory Cache Manager for Main Thread
 * 
 * Coordinates MemoryCache operations across Worker threads by managing
 * shared MemoryCache instances and handling postMessage requests.
 * 
 * Only MemoryCache needs coordination since it stores data in process memory.
 * Other cache types (FilesystemCache, SQLiteCache, etc.) can be used directly
 * by workers without coordination.
 */

import { MemoryCache } from '@b9g/cache/memory-cache';

export class MemoryCacheManager {
  constructor() {
    this.memoryCaches = new Map(); // name -> MemoryCache instance
  }

  /**
   * Handle memory cache-related message from a Worker
   */
  async handleMessage(worker, message) {
    const { type, requestId } = message;
    
    try {
      let result;
      
      switch (type) {
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
          
        case 'cache:clear':
          result = await this.handleClear(message);
          break;
          
        default:
          // Not a memory cache operation, ignore
          return;
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

  /**
   * Get or create a MemoryCache instance
   */
  getMemoryCache(name, options = {}) {
    if (!this.memoryCaches.has(name)) {
      this.memoryCaches.set(name, new MemoryCache(name, options));
    }
    return this.memoryCaches.get(name);
  }

  async handleMatch({ cacheName, request, options }) {
    const cache = this.getMemoryCache(cacheName);
    
    // Reconstruct Request object from serialized data
    const req = new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body
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
      body: await response.text()
    };
  }

  async handlePut({ cacheName, request, response }) {
    const cache = this.getMemoryCache(cacheName);
    
    // Reconstruct Request and Response objects
    const req = new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body
    });
    
    const res = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });
    
    await cache.put(req, res);
    return true;
  }

  async handleDelete({ cacheName, request, options }) {
    const cache = this.getMemoryCache(cacheName);
    
    const req = new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body
    });
    
    return await cache.delete(req, options);
  }

  async handleKeys({ cacheName, request, options }) {
    const cache = this.getMemoryCache(cacheName);
    
    let req;
    if (request) {
      req = new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body
      });
    }
    
    const keys = await cache.keys(req, options);
    
    // Serialize Request objects for transmission
    return keys.map(key => ({
      url: key.url,
      method: key.method,
      headers: Object.fromEntries(key.headers.entries()),
      body: undefined // Keys don't include bodies
    }));
  }

  async handleClear({ cacheName }) {
    const cache = this.getMemoryCache(cacheName);
    await cache.clear();
    return true;
  }

  /**
   * Dispose of all memory caches
   */
  async dispose() {
    const disposePromises = Array.from(this.memoryCaches.values()).map(cache => cache.dispose());
    await Promise.all(disposePromises);
    this.memoryCaches.clear();
  }
}