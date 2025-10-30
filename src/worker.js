/**
 * Static Worker template for ServiceWorker execution
 * Uses Node.js Worker threads with ServiceWorker simulation
 */

import { createServiceWorkerGlobals } from './serviceworker.js';
import { WorkerCacheStorage } from './worker-cache-storage.js';
import { parentPort } from 'worker_threads';

// Create coordinated cache storage for this Worker
const caches = new WorkerCacheStorage();

// Set up ServiceWorker globals with coordinated cache
const globals = createServiceWorkerGlobals({ caches });
Object.assign(globalThis, globals);

let currentApp = null;
let serviceWorkerReady = false;

/**
 * Handle ServiceWorker fetch events
 */
async function handleFetchEvent(request) {
  if (!currentApp || !serviceWorkerReady) {
    throw new Error('ServiceWorker not ready');
  }

  // Simulate fetch event dispatch using standard ServiceWorker API
  let response = null;
  
  if (globalThis.self && globalThis.self.dispatchEvent) {
    const fetchEvent = new globalThis.FetchEvent('fetch', { 
      request,
      clientId: '',
      isReload: false
    });
    
    globalThis.self.dispatchEvent(fetchEvent);
    
    // Get response from standard FetchEvent API
    const eventResponse = fetchEvent._getResponse();
    if (eventResponse) {
      response = await eventResponse;
    }
  }
  
  // Fallback to direct router call if event dispatch didn't work
  if (!response && currentApp.default && currentApp.default.handler) {
    response = await currentApp.default.handler(request);
  }
  
  if (!response) {
    response = new Response('ServiceWorker did not provide a response', { 
      status: 500 
    });
  }
  
  return response;
}

/**
 * Load and activate ServiceWorker with proper lifecycle
 */
async function loadServiceWorker(version) {
  try {
    // Platform-standard cache busting with query parameters
    // Import from well-known path in current working directory
    const appModule = await import(`${process.cwd()}/dist/app.js?v=${version}`);
    currentApp = appModule;
    
    // ServiceWorker lifecycle simulation using standard ExtendableEvent
    if (globalThis.self && globalThis.self.dispatchEvent) {
      // Install event
      const installEvent = new globalThis.ExtendableEvent('install');
      globalThis.self.dispatchEvent(installEvent);
      await installEvent._waitForPromises();
      
      // Activate event  
      const activateEvent = new globalThis.ExtendableEvent('activate');
      globalThis.self.dispatchEvent(activateEvent);
      await activateEvent._waitForPromises();
    }
    
    serviceWorkerReady = true;
    console.log(`[Worker] ServiceWorker loaded and activated (v${version})`);
    
  } catch (error) {
    console.error('[Worker] Failed to load ServiceWorker:', error);
    serviceWorkerReady = false;
    throw error;
  }
}

// Node.js Worker thread message handling
parentPort.on('message', async (message) => {
  try {
    if (message.type === 'load') {
      await loadServiceWorker(message.version);
      parentPort.postMessage({ type: 'ready', version: message.version });
      
    } else if (message.type === 'request') {
      // Reconstruct Request object from serialized data
      const request = new Request(message.request.url, {
        method: message.request.method,
        headers: message.request.headers,
        body: message.request.body
      });
      
      const response = await handleFetchEvent(request);
      
      // Serialize response for Worker thread (can't clone Response objects)
      parentPort.postMessage({ 
        type: 'response', 
        response: {
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          body: await response.text()
        },
        requestId: message.requestId 
      });
      
    } else if (message.type.startsWith('cache:') || message.type.startsWith('cachestorage:')) {
      // Cache operations are handled by the WorkerCacheStorage and WorkerCache instances
      // They listen to parentPort messages directly, so we don't need to handle them here
      
    } else {
      console.warn('[Worker] Unknown message type:', message.type);
    }
    
  } catch (error) {
    parentPort.postMessage({
      type: 'error',
      error: error.message,
      stack: error.stack,
      requestId: message.requestId
    });
  }
});

// Signal that Worker is ready to receive messages
parentPort.postMessage({ type: 'worker-ready' });