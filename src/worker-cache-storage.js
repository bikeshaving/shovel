/**
 * Worker CacheStorage Proxy
 * 
 * Implements the CacheStorage API by forwarding operations to the main thread
 * and returning WorkerCache proxy instances for coordinated cache access.
 */

import { parentPort } from 'worker_threads';
import { WorkerCache } from './worker-cache.js';

export class WorkerCacheStorage {
  constructor() {
    this.requestCounter = 0;
    this.pendingRequests = new Map();
    this.cacheInstances = new Map(); // Cache WorkerCache instances
    
    // Listen for responses from main thread
    if (parentPort) {
      parentPort.on('message', (message) => {
        if (message.type === 'cache:response' || message.type === 'cache:error') {
          this.handleResponse(message);
        }
      });
    }
  }

  handleResponse(message) {
    const { requestId, result, error } = message;
    const pending = this.pendingRequests.get(requestId);
    
    if (pending) {
      this.pendingRequests.delete(requestId);
      
      if (message.type === 'cache:error') {
        pending.reject(new Error(error));
      } else {
        pending.resolve(result);
      }
    }
  }

  async sendRequest(type, data = {}) {
    if (!parentPort) {
      throw new Error('parentPort not available in Worker');
    }
    
    const requestId = ++this.requestCounter;
    
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(requestId, { resolve, reject });
      
      parentPort.postMessage({
        type,
        requestId,
        ...data
      });
      
      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(new Error(`CacheStorage operation timeout: ${type}`));
        }
      }, 30000);
    });
  }

  /**
   * Open a cache with the given name
   */
  async open(name) {
    // Send request to main thread to ensure cache exists
    await this.sendRequest('cache:open', { name });
    
    // Return or create WorkerCache instance
    if (!this.cacheInstances.has(name)) {
      this.cacheInstances.set(name, new WorkerCache(name));
    }
    
    return this.cacheInstances.get(name);
  }

  /**
   * Check if a cache with the given name exists
   */
  async has(name) {
    const exists = await this.sendRequest('cachestorage:has', { name });
    return exists;
  }

  /**
   * Delete a cache with the given name
   */
  async delete(name) {
    const deleted = await this.sendRequest('cachestorage:delete', { name });
    
    // Remove from local cache instances
    if (deleted && this.cacheInstances.has(name)) {
      this.cacheInstances.delete(name);
    }
    
    return deleted;
  }

  /**
   * Get all cache names
   */
  async keys() {
    const keys = await this.sendRequest('cachestorage:keys');
    return keys;
  }

  /**
   * Match a request across all caches
   */
  async match(request, options) {
    // For simplicity, we'll iterate through caches on the main thread
    // This could be optimized in the future
    const keys = await this.keys();
    
    for (const name of keys) {
      const cache = await this.open(name);
      const response = await cache.match(request, options);
      if (response) {
        return response;
      }
    }
    
    return undefined;
  }

  /**
   * Register a cache factory (compatibility method)
   * In the Worker context, this forwards to the main thread
   */
  register(name, factory) {
    // This would need to be handled by the main thread CacheStorage
    // For now, we'll just log a warning
    console.warn('WorkerCacheStorage.register() is not implemented. Use main thread CacheStorage.register() instead.');
  }

  /**
   * Set default cache (compatibility method)
   */
  setDefault(name) {
    // This would need to be handled by the main thread CacheStorage
    console.warn('WorkerCacheStorage.setDefault() is not implemented. Use main thread CacheStorage.setDefault() instead.');
  }
}