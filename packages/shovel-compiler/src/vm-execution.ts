/**
 * VM execution engine for Shovel applications
 * Provides isolated execution of bundled ServiceWorker code with proper globals
 */

import * as VM from 'vm';
import { pathToFileURL } from 'url';

/**
 * ServiceWorker runtime interface
 * Platforms implement this to provide ServiceWorker-like APIs
 */
export interface ServiceWorkerRuntime {
  /** Install event handler */
  install(): Promise<void>;
  /** Activate event handler */
  activate(): Promise<void>;
  /** Handle incoming requests */
  handleRequest(request: Request): Promise<Response>;
}

/**
 * VM execution options
 */
export interface VMExecutionOptions {
  /** Entry point identifier (file path or URL) */
  identifier: string;
  /** ServiceWorker globals to inject */
  globals: Record<string, any>;
  /** Additional context properties */
  context?: Record<string, any>;
  /** Enable hot module replacement */
  hmr?: boolean;
}

/**
 * Hot module replacement support
 */
export class Hot {
  private disposeCallbacks: (() => void)[] = [];

  /**
   * Accept hot updates (basic implementation)
   */
  accept(callback?: () => void): void {
    if (callback) {
      throw new Error('Hot.accept with callback not implemented yet');
    }
  }

  /**
   * Invalidate this module
   */
  invalidate(): void {
    throw new Error('Hot.invalidate not implemented yet');
  }

  /**
   * Register cleanup callback
   */
  dispose(callback: () => void): void {
    this.disposeCallbacks.push(callback);
  }

  /**
   * Mark module as non-updatable
   */
  decline(): void {
    // No-op for now
  }

  /**
   * Execute all dispose callbacks
   */
  _dispose(): void {
    for (const callback of this.disposeCallbacks) {
      try {
        callback();
      } catch (error) {
        console.error('Error in hot dispose callback:', error);
      }
    }
    this.disposeCallbacks.length = 0;
  }
}

/**
 * VM execution result
 */
export interface VMExecutionResult {
  /** ServiceWorker runtime instance */
  runtime: ServiceWorkerRuntime;
  /** VM context for future operations */
  context: VM.Context;
  /** Cleanup function */
  dispose: () => void;
}

/**
 * Execute bundled code in isolated VM context with ServiceWorker globals
 */
export async function executeInVM(
  bundleCode: string,
  options: VMExecutionOptions
): Promise<VMExecutionResult> {
  // Create isolated VM context with ServiceWorker globals
  const context = VM.createContext({
    ...options.globals,
    ...global, // Include Node.js globals for compatibility
    process, // Explicitly include process
    ...options.context, // User-provided context overrides
  });

  // Create module with proper identifier and context
  const module = new VM.SourceTextModule(bundleCode, {
    identifier: options.identifier,
    context,
    initializeImportMeta(meta: any) {
      meta.url = options.identifier;
      if (options.hmr) {
        meta.hot = new Hot();
      }
    },
    async importModuleDynamically(specifier: string, referencingModule: VM.Module) {
      // For bundled code, dynamic imports should be resolved by the bundle
      // This is a fallback that shouldn't normally be hit
      throw new Error(`Dynamic import not supported in bundled code: ${specifier}`);
    },
  });

  // Link the module - handle external Node.js modules that ESBuild didn't bundle
  await module.link(async (specifier: string) => {
    // For bundled code, we still need to handle external packages (Node.js modules)
    try {
      const importedModule = await import(specifier);
      const exports = Object.keys(importedModule);
      
      return new VM.SyntheticModule(exports, function () {
        for (const key of exports) {
          this.setExport(key, importedModule[key]);
        }
      }, {
        identifier: specifier,
        context,
      });
    } catch (error) {
      throw new Error(`Failed to import external module: ${specifier} - ${error.message}`);
    }
  });

  // Execute the module
  await module.evaluate();

  // Extract the ServiceWorker runtime from the context
  const runtime = extractServiceWorkerRuntime(context);

  return {
    runtime,
    context,
    dispose: () => {
      // VM contexts don't need explicit disposal in Node.js
      // This is here for future cleanup if needed
    },
  };
}

/**
 * Extract ServiceWorker runtime from VM context
 * The user's code should have set up event listeners that we can access
 */
function extractServiceWorkerRuntime(context: VM.Context): ServiceWorkerRuntime {
  // Get the global object from the VM context
  const vmGlobal = VM.runInContext('globalThis', context);
  
  // Create runtime that delegates to the VM context's event system
  return {
    async install(): Promise<void> {
      // Dispatch install event in VM context
      const installCode = `
        if (typeof self !== 'undefined' && self.dispatchEvent) {
          const event = new Event('install');
          event.waitUntil = (promise) => promise; // Simple implementation
          self.dispatchEvent(event);
        }
      `;
      VM.runInContext(installCode, context);
    },

    async activate(): Promise<void> {
      // Dispatch activate event in VM context
      const activateCode = `
        if (typeof self !== 'undefined' && self.dispatchEvent) {
          const event = new Event('activate');
          event.waitUntil = (promise) => promise; // Simple implementation
          self.dispatchEvent(event);
        }
      `;
      VM.runInContext(activateCode, context);
    },

    async handleRequest(request: Request): Promise<Response> {
      // Create fetch event and dispatch in VM context
      const handlerCode = `
        (function(request) {
          console.log('[VM] Handling request:', request.url);
          if (typeof self !== 'undefined' && self.dispatchEvent) {
            console.log('[VM] Dispatching fetch event');
            const event = new FetchEvent('fetch', { request });
            let response = null;
            event.respondWith = (responsePromise) => {
              console.log('[VM] respondWith called');
              response = responsePromise;
            };
            const dispatched = self.dispatchEvent(event);
            console.log('[VM] Event dispatched:', dispatched, 'Response:', response);
            return response;
          }
          throw new Error('No fetch handler registered');
        })
      `;
      
      const handler = VM.runInContext(handlerCode, context);
      const result = await handler(request);
      
      console.log('[VM] Handler result:', result);
      
      if (!result) {
        throw new Error('No response provided by ServiceWorker');
      }
      
      return result;
    },
  };
}

/**
 * Create ServiceWorker-compatible globals
 * This provides the standard ServiceWorker API surface
 */
export function createServiceWorkerGlobals(runtime?: ServiceWorkerRuntime): Record<string, any> {
  const events = new Map<string, Function[]>();

  return {
    self: {
      addEventListener(type: string, listener: Function) {
        if (!events.has(type)) {
          events.set(type, []);
        }
        events.get(type)!.push(listener);
      },
      
      removeEventListener(type: string, listener: Function) {
        const listeners = events.get(type);
        if (listeners) {
          const index = listeners.indexOf(listener);
          if (index > -1) {
            listeners.splice(index, 1);
          }
        }
      },
      
      dispatchEvent(event: Event) {
        const listeners = events.get(event.type) || [];
        for (const listener of listeners) {
          try {
            listener.call(this, event);
          } catch (error) {
            console.error(`Error in ${event.type} event listener:`, error);
          }
        }
        return true;
      },
    },

    addEventListener(type: string, listener: Function) {
      return this.self.addEventListener(type, listener);
    },

    // Fetch API (should be provided by platform)
    fetch: globalThis.fetch,
    Request: globalThis.Request,
    Response: globalThis.Response,
    Headers: globalThis.Headers,

    // Event constructors
    Event: class Event {
      constructor(public type: string, options?: EventInit) {}
      waitUntil?(promise: Promise<any>): void {}
    },

    FetchEvent: class FetchEvent extends Event {
      constructor(type: 'fetch', init: { request: Request }) {
        super(type);
        this.request = init.request;
      }
      
      request: Request;
      private _response?: Promise<Response>;
      
      respondWith(response: Promise<Response> | Response) {
        this._response = Promise.resolve(response);
      }
      
      get response(): Promise<Response> | undefined {
        return this._response;
      }
    },

    // Console (from Node.js)
    console,

    // Timers
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    setImmediate,
    clearImmediate,
  };
}