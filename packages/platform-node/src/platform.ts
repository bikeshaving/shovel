/**
 * Node.js platform implementation for Shovel with hot reloading
 */

import { 
  Platform, 
  CacheConfig, 
  StaticConfig, 
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
import { createStaticFilesHandler } from '@b9g/staticfiles';
import { createRequestHandler } from '@remix-run/node-fetch-server';
import * as Http from 'http';
import * as Path from 'path';
import * as FS from 'fs/promises';
import { Watcher, Hot, createModuleLinker, fixErrorStack } from './watcher.js';
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
 */
export class NodePlatform implements Platform {
  readonly name = 'node';
  readonly capabilities = {
    hotReload: true,
    sourceMaps: true,
    filesystem: true,
    serverSideRendering: true,
    staticGeneration: true,
  };

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
   * Create cache storage optimized for Node.js
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
   * Create static files handler optimized for Node.js
   */
  createStaticHandler(config: StaticConfig = {}): Handler {
    return createStaticFilesHandler({
      outputDir: config.outputDir || 'dist/static',
      publicPath: config.publicPath || '/static/',
      manifest: config.manifest || 'dist/static-manifest.json',
      dev: config.dev ?? (process.env.NODE_ENV !== 'production'),
      cache: {
        name: config.cacheName || 'filesystem',
        ttl: config.cacheTtl || 86400, // 24 hours
      },
    });
  }

  /**
   * Create HTTP server with hot reloading support
   */
  createServer(handler: Handler, options: ServerOptions = {}): Server {
    const port = options.port ?? this.options.port;
    const host = options.host ?? this.options.host;

    if (this.options.hotReload && options.entry) {
      return this.createHotReloadServer(handler, options.entry, { port, host });
    }

    // Production server without hot reloading
    const requestHandler = createRequestHandler(handler);
    const httpServer = Http.createServer(requestHandler);

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
   * Create development server with hot reloading
   */
  private createHotReloadServer(handler: Handler, entry: string, options: { port: number; host: string }): Server {
    let httpServer: Http.Server | null = null;
    let currentModule: VM.Module | null = null;
    let sourceMapConsumer: SourceMapConsumer | null = null;

    // Create watcher for hot reloading
    this.watcher = new Watcher(async (record, watcher) => {
      try {
        console.log(`[HMR] ${record.isInitial ? 'Building' : 'Rebuilding'} ${record.entry}`);
        
        if (record.result.errors.length > 0) {
          console.error('[HMR] Build errors:', record.result.errors);
          return;
        }

        // Get the compiled code
        const outputFile = record.result.outputFiles?.find(file => file.path.endsWith('.js'));
        if (!outputFile) {
          console.error('[HMR] No output file found');
          return;
        }

        // Load source map if available
        const mapFile = record.result.outputFiles?.find(file => file.path.endsWith('.js.map'));
        if (mapFile) {
          try {
            sourceMapConsumer = await new SourceMapConsumer(mapFile.text);
          } catch (error) {
            console.warn('[HMR] Failed to load source map:', error);
          }
        }

        // Create new module
        const moduleUrl = pathToFileURL(record.entry).href;
        const linker = createModuleLinker(watcher);
        
        // Dispose previous module if it exists
        if (currentModule && (currentModule as any).hot) {
          (currentModule as any).hot._dispose();
        }

        currentModule = new VM.SourceTextModule(outputFile.text, {
          identifier: moduleUrl,
          initializeImportMeta(meta: any) {
            meta.url = moduleUrl;
            meta.hot = new Hot();
          },
        });

        await currentModule.link(linker);
        const result = await currentModule.evaluate();

        // Get the handler from the module
        const namespace = currentModule.namespace;
        const newHandler = namespace.default || namespace.handler || handler;

        // Create or update HTTP server
        const requestHandler = createRequestHandler(newHandler);
        
        if (!httpServer) {
          httpServer = Http.createServer(requestHandler);
          httpServer.listen(options.port, options.host, () => {
            console.log(`[HMR] Server running at http://${options.host}:${options.port}`);
          });
        } else {
          // Hot swap the request handler
          httpServer.removeAllListeners('request');
          httpServer.on('request', requestHandler);
          console.log('[HMR] Handler updated');
        }
      } catch (error) {
        if (sourceMapConsumer) {
          fixErrorStack(error as Error, sourceMapConsumer);
        }
        console.error('[HMR] Failed to reload module:', error);
      }
    });

    // Start initial build
    const entryPath = Path.resolve(this.options.cwd, entry);
    this.watcher.build(entryPath).catch(console.error);

    return {
      listen: (callback?: () => void) => {
        // Server will be created by the watcher callback
        if (callback) {
          const checkServer = () => {
            if (httpServer) {
              callback();
            } else {
              setTimeout(checkServer, 100);
            }
          };
          checkServer();
        }
        return httpServer || new Http.Server();
      },
      close: async () => {
        if (this.watcher) {
          await this.watcher.dispose();
        }
        if (sourceMapConsumer) {
          sourceMapConsumer.destroy();
        }
        if (httpServer) {
          return new Promise<void>((resolve) => {
            httpServer!.close(() => resolve());
          });
        }
      },
      address: () => options,
    };
  }

  /**
   * Load and run a ServiceWorker-style entrypoint
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
          const linker = createModuleLinker(w);

          const currentModule = new VM.SourceTextModule(outputFile.text, {
            identifier: moduleUrl,
            initializeImportMeta(meta: any) {
              meta.url = moduleUrl;
              meta.hot = new Hot();
            },
          });

          await currentModule.link(linker);
          
          // Execute module with ServiceWorker globals
          const context = VM.createContext({
            ...globals,
            ...global, // Include Node.js globals
          });
          
          VM.runInContext(outputFile.text, context);

          // Emit platform event to the ServiceWorker
          const caches = options.caches ? this.createCaches(options.caches) : undefined;
          runtime.emitPlatformEvent({
            platform: this.name,
            capabilities: this.capabilities,
            caches,
          });

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
      
      const context = VM.createContext({
        ...globals,
        ...global,
      });
      
      VM.runInContext(code, context);

      // Emit platform event
      const caches = options.caches ? this.createCaches(options.caches) : undefined;
      runtime.emitPlatformEvent({
        platform: this.name,
        capabilities: this.capabilities,
        caches,
      });

      await runtime.install();
      await runtime.activate();
    }

    return instance;
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