/**
 * Node.js platform implementation - ServiceWorker entrypoint loader for Node.js
 * 
 * Handles the complex ESBuild VM system, hot reloading, and module linking
 * to make ServiceWorker-style apps run in Node.js environments.
 */

import { 
  Platform, 
  CacheConfig, 
  Handler, 
  Server, 
  ServerOptions,
  ServiceWorkerOptions,
  ServiceWorkerInstance,
} from '@b9g/platform';
import { CacheStorage } from '@b9g/cache/cache-storage';
import { MemoryCache } from '@b9g/cache/memory-cache';
import { FilesystemCache } from '@b9g/cache/filesystem-cache';
import { createRequestListener } from '@remix-run/node-fetch-server';
import * as Http from 'http';
import * as Path from 'path';
import * as FS from 'fs/promises';
import { Watcher, executeInVM, createServiceWorkerGlobals } from '@b9g/shovel-compiler';
import { pathToFileURL } from 'url';

export interface NodePlatformOptions {
  /** Enable hot reloading (default: true in development) */
  hotReload?: boolean;
  /** Port for development server (default: 3000) */
  port?: number;
  /** Host for development server (default: localhost) */
  host?: string;
  /** Working directory for file resolution */
  cwd?: string;
}

/**
 * Node.js platform implementation
 * ServiceWorker entrypoint loader for Node.js with ESBuild VM system
 */
export class NodePlatform implements Platform {
  readonly name = 'node';

  private options: Required<NodePlatformOptions>;
  private watcher?: Watcher;

  constructor(options: NodePlatformOptions = {}) {
    this.options = {
      hotReload: process.env.NODE_ENV !== 'production',
      port: 3000,
      host: 'localhost',
      cwd: process.cwd(),
      ...options,
    };
  }

  /**
   * THE MAIN JOB - Load and run a ServiceWorker-style entrypoint in Node.js
   * This is where all the Node.js-specific complexity lives (ESBuild VM, hot reloading, etc.)
   */
  async loadServiceWorker(entrypoint: string, options: ServiceWorkerOptions = {}): Promise<ServiceWorkerInstance> {
    const entryPath = Path.resolve(this.options.cwd, entrypoint);
    let vmRuntime: any = null;
    let watcher: Watcher | undefined;
    
    // Create ServiceWorker instance that delegates to VM execution
    const instance: ServiceWorkerInstance = {
      runtime: null, // We'll set this after VM execution
      handleRequest: async (request: Request) => {
        if (!vmRuntime) {
          throw new Error('ServiceWorker not loaded');
        }
        return vmRuntime.handleRequest(request);
      },
      install: async () => {
        if (!vmRuntime) {
          throw new Error('ServiceWorker not loaded');
        }
        return vmRuntime.install();
      },
      activate: async () => {
        if (!vmRuntime) {
          throw new Error('ServiceWorker not loaded');
        }
        return vmRuntime.activate();
      },
      collectStaticRoutes: async (outDir: string, baseUrl?: string) => {
        // TODO: Implement static route collection
        return [];
      },
      get ready() { return vmRuntime !== null; },
      dispose: async () => {
        if (watcher) {
          await watcher.dispose();
        }
        vmRuntime = null;
      },
    };

    if (this.options.hotReload && options.hotReload !== false) {
      // Use hot reloading with ServiceWorker lifecycle
      watcher = new Watcher(async (record, w) => {
        try {
          console.log(`[SW] ${record.isInitial ? 'Installing' : 'Updating'} ServiceWorker`);
          
          if (record.result.errors.length > 0) {
            console.error('[SW] Build errors:', record.result.errors);
            return;
          }

          // Get compiled code
          const outputFile = record.result.outputFiles?.find(file => file.path.endsWith('.js'));
          if (!outputFile) {
            console.error('[SW] No output file found');
            return;
          }

          // Execute bundle in VM with ServiceWorker globals
          const moduleUrl = pathToFileURL(record.entry).href;
          const globals = createServiceWorkerGlobals();
          
          const vmResult = await executeInVM(outputFile.text, {
            identifier: moduleUrl,
            globals,
            hmr: true,
          });

          // Update our runtime reference
          vmRuntime = vmResult.runtime;
          
          // Install and activate the ServiceWorker
          await vmRuntime.install();
          await vmRuntime.activate();
          
          console.log(`[SW] ServiceWorker ${record.isInitial ? 'installed' : 'updated'} successfully`);
        } catch (error) {
          console.error('[SW] Failed to load ServiceWorker:', error);
        }
      });

      await watcher.build(entryPath);
    } else {
      // Static loading without hot reloading
      const code = await FS.readFile(entryPath, 'utf8');
      const moduleUrl = pathToFileURL(entryPath).href;
      const globals = createServiceWorkerGlobals();
      
      const vmResult = await executeInVM(code, {
        identifier: moduleUrl,
        globals,
        hmr: false,
      });

      // Set the runtime reference
      vmRuntime = vmResult.runtime;
      
      // Install and activate the ServiceWorker
      await vmRuntime.install();
      await vmRuntime.activate();
    }

    return instance;
  }

  /**
   * SUPPORTING UTILITY - Create cache storage optimized for Node.js
   */
  createCaches(config: CacheConfig = {}): CacheStorage {
    const caches = new CacheStorage();

    // Register default caches optimized for Node.js
    caches.register('memory', () => new MemoryCache('memory', {
      maxEntries: config.maxEntries || 1000,
      maxSize: config.maxSize || 50 * 1024 * 1024, // 50MB
    }));

    caches.register('filesystem', () => new FilesystemCache('filesystem', {
      cacheDir: config.cacheDir || Path.join(this.options.cwd, '.cache'),
      maxEntries: config.maxEntries || 10000,
      maxSize: config.maxSize || 500 * 1024 * 1024, // 500MB
    }));

    // Set filesystem as default for Node.js persistence
    caches.setDefault('filesystem');

    return caches;
  }

  /**
   * SUPPORTING UTILITY - Create HTTP server for Node.js
   */
  createServer(handler: Handler, options: ServerOptions = {}): Server {
    const port = options.port ?? this.options.port;
    const host = options.host ?? this.options.host;

    // Simple HTTP server using Remix request listener
    const requestListener = createRequestListener(handler);
    const httpServer = Http.createServer(requestListener);

    return {
      listen: (callback?: () => void) => {
        httpServer.listen(port, host, callback);
        return httpServer;
      },
      close: () => new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      }),
      address: () => ({ port, host }),
    };
  }

  /**
   * Dispose of platform resources
   */
  async dispose(): Promise<void> {
    if (this.watcher) {
      await this.watcher.dispose();
      this.watcher = undefined;
    }
  }
}

/**
 * Create a Node.js platform instance
 */
export function createNodePlatform(options?: NodePlatformOptions): NodePlatform {
  return new NodePlatform(options);
}

/**
 * Default export for easy importing
 */
export default createNodePlatform;