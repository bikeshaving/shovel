/**
 * Unified ServiceWorker globals and event simulation
 * Provides standard ServiceWorker API surface for all execution contexts
 */

/**
 * Standard ServiceWorker API interfaces
 */

/**
 * Create ServiceWorker-compatible globals
 * This provides the standard ServiceWorker API surface for any execution context
 */
export function createServiceWorkerGlobals(options = {}) {
  const events = new Map();

  // Base Event class
  const EventClass = globalThis.Event || class Event {
    constructor(type, options = {}) {
      this.type = type;
      this.bubbles = options.bubbles || false;
      this.cancelable = options.cancelable || false;
      this.composed = options.composed || false;
    }
  };

  // ExtendableEvent class - used for install/activate events
  class ExtendableEvent extends EventClass {
    constructor(type, eventInit = {}) {
      super(type, eventInit);
      this.#promises = [];
    }
    
    #promises = [];
    
    waitUntil(promise) {
      if (!(promise instanceof Promise)) {
        throw new TypeError('ExtendableEvent.waitUntil() requires a Promise');
      }
      this.#promises.push(promise);
    }
    
    // Internal method to await all promises (used by ServiceWorker runtime)
    _waitForPromises() {
      return Promise.all(this.#promises).then(() => {});
    }
  }

  // FetchEvent class - used for fetch events
  class FetchEvent extends ExtendableEvent {
    constructor(type, eventInit) {
      super(type, eventInit);
      
      if (type !== 'fetch') {
        throw new TypeError('FetchEvent constructor expects type "fetch"');
      }
      
      if (!eventInit || !eventInit.request) {
        throw new TypeError('FetchEvent constructor requires a request');
      }
      
      // Standard FetchEvent properties (all read-only)
      this.request = eventInit.request;
      this.clientId = eventInit.clientId || '';
      this.isReload = eventInit.isReload || false;
      this.replacesClientId = eventInit.replacesClientId || '';
      this.resultingClientId = eventInit.resultingClientId || '';
      this.preloadResponse = eventInit.preloadResponse;
      
      this.handled = new Promise((resolve) => {
        this.#handledResolve = resolve;
      });
    }
    
    #response = null;
    #handledResolve = null;
    #responseHandled = false;
    
    respondWith(response) {
      if (this.#responseHandled) {
        throw new Error('FetchEvent.respondWith() has already been called');
      }
      
      this.#responseHandled = true;
      this.#response = Promise.resolve(response);
      
      // Resolve handled promise when response settles
      this.#response.then(
        (res) => this.#handledResolve(res),
        (err) => this.#handledResolve(undefined)
      );
    }
    
    // Internal method to get response (used by ServiceWorker runtime)
    _getResponse() {
      return this.#response;
    }
  }

  // ServiceWorker self object with event system
  const self = {
    addEventListener(type, listener) {
      if (!events.has(type)) {
        events.set(type, []);
      }
      events.get(type).push(listener);
    },
    
    removeEventListener(type, listener) {
      const listeners = events.get(type);
      if (listeners) {
        const index = listeners.indexOf(listener);
        if (index > -1) {
          listeners.splice(index, 1);
        }
      }
    },
    
    dispatchEvent(event) {
      const listeners = events.get(event.type) || [];
      for (const listener of listeners) {
        try {
          if (typeof listener === 'function') {
            listener.call(this, event);
          } else if (listener && typeof listener.handleEvent === 'function') {
            listener.handleEvent(event);
          }
        } catch (error) {
          console.error(`Error in ${event.type} event listener:`, error);
        }
      }
      return true;
    }
  };

  const globals = {
    // ServiceWorker-specific globals (not available in Node.js)
    self,
    addEventListener: self.addEventListener.bind(self),
    removeEventListener: self.removeEventListener.bind(self),
    
    // ServiceWorker-specific event constructors
    ExtendableEvent,
    FetchEvent,
    
    // Override Event class only if needed (Node.js has Event but might not be compatible)
    Event: EventClass,
  };

  // Inject cache storage if provided (for Worker coordination)
  if (options.caches) {
    globals.caches = options.caches;
  }

  return globals;
}