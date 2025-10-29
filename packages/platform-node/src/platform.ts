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
  ServiceWorkerRuntime,
  createServiceWorkerGlobals 
} from '@b9g/platform';
import { CacheStorage } from '@b9g/cache/cache-storage';
import { MemoryCache } from '@b9g/cache/memory-cache';
import { FilesystemCache } from '@b9g/cache/filesystem-cache';
import { createRequestListener } from '@remix-run/node-fetch-server';
import * as Http from 'http';
import * as Path from 'path';
import * as FS from 'fs/promises';
import { Watcher, Hot, createModuleLinker, fixErrorStack } from '@b9g/shovel-compiler';
import * as VM from 'vm';
import { fileURLToPath, pathToFileURL } from 'url';
import { SourceMapConsumer } from 'source-map';

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
    const runtime = new ServiceWorkerRuntime();
    const entryPath = Path.resolve(this.options.cwd, entrypoint);
    
    // Create ServiceWorker instance
    const instance: ServiceWorkerInstance = {
      runtime,
      handleRequest: (request: Request) => runtime.handleRequest(request),
      install: () => runtime.install(),
      activate: () => runtime.activate(),
      collectStaticRoutes: (outDir: string, baseUrl?: string) => runtime.collectStaticRoutes(outDir, baseUrl),
      get ready() { return runtime.ready; },
      dispose: async () => {
        runtime.reset();
        if (watcher) {
          await watcher.dispose();
        }
      },
    };

    let watcher: Watcher | undefined;

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

          // Reset runtime for reload
          runtime.reset();

          // Create VM context with ServiceWorker globals
          const globals = createServiceWorkerGlobals(runtime);
          const moduleUrl = pathToFileURL(record.entry).href;
          
          const context = VM.createContext({
            ...globals,
            ...global, // Include Node.js globals
            process, // Explicitly include process
          });
          
          const linker = createModuleLinker(w, context);

          const currentModule = new VM.SourceTextModule(outputFile.text, {
            identifier: moduleUrl,
            context,
            initializeImportMeta(meta: any) {
              meta.url = moduleUrl;
              meta.hot = new Hot();
            },
          });

          await currentModule.link(linker);
          
          // Execute module with ServiceWorker globals
          await currentModule.evaluate();

          // Platform provides standard web APIs transparently
          // No need to tell the app about platform details

          // Install and activate
          await runtime.install();
          await runtime.activate();
          
          console.log(`[SW] ServiceWorker ${record.isInitial ? 'installed' : 'updated'} successfully`);
        } catch (error) {
          console.error('[SW] Failed to load ServiceWorker:', error);
        }
      });

      await watcher.build(entryPath);
    } else {
      // Static loading without hot reloading
      const code = await FS.readFile(entryPath, 'utf8');
      const globals = createServiceWorkerGlobals(runtime);
      const moduleUrl = pathToFileURL(entryPath).href;
      
      const context = VM.createContext({
        ...globals,
        ...global,
        process, // Explicitly include process
      });
      
      const module = new VM.SourceTextModule(code, {
        identifier: moduleUrl,
        context,
        initializeImportMeta(meta: any) {
          meta.url = moduleUrl;
        },
      });

      // Create a simple linker for static loading (no module resolution needed for simple cases)
      await module.link(async (specifier: string) => {
        throw new Error(`Dynamic imports not supported in static loading: ${specifier}`);
      });
      
      // Execute module with ServiceWorker globals  
      await module.evaluate();

      // Platform provides standard web APIs transparently

      await runtime.install();
      await runtime.activate();
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