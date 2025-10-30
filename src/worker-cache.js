/**
 * Worker Cache Proxy
 * 
 * Implements the Cache API by forwarding all operations to the main thread
 * via postMessage. Uses structured cloning for Request/Response objects.
 */

import { parentPort } from 'worker_threads';

export class WorkerCache {
  constructor(name) {
    this.name = name;
    this.requestCounter = 0;
    this.pendingRequests = new Map();
    
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
        cacheName: this.name,
        requestId,
        ...data
      });
      
      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(new Error(`Cache operation timeout: ${type}`));
        }
      }, 30000);
    });
  }

  /**
   * Find a cached response for the given request
   */
  async match(request, options) {
    const response = await this.sendRequest('cache:match', {
      request,
      options
    });
    return response; // undefined if not found, Response if found
  }

  /**
   * Store a request/response pair in the cache
   */
  async put(request, response) {
    await this.sendRequest('cache:put', {
      request,
      response
    });
  }

  /**
   * Delete cached entries matching the request
   */
  async delete(request, options) {
    const deleted = await this.sendRequest('cache:delete', {
      request,
      options
    });
    return deleted;
  }

  /**
   * Get all keys (requests) in the cache
   */
  async keys(request, options) {
    const keys = await this.sendRequest('cache:keys', {
      request,
      options
    });
    return keys;
  }

  /**
   * Add multiple request/response pairs to the cache
   */
  async addAll(requests) {
    // Fetch all requests and add them to cache
    const responses = await Promise.all(
      requests.map(request => fetch(request))
    );
    
    await Promise.all(
      requests.map((request, index) => 
        this.put(request, responses[index])
      )
    );
  }

  /**
   * Add a single request to the cache (fetches it first)
   */
  async add(request) {
    const response = await fetch(request);
    await this.put(request, response);
  }
}