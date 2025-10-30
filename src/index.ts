/**
 * @b9g/shovel-compiler - Shovel's compilation and development infrastructure
 * 
 * This package provides the core compilation, bundling, and development features
 * that are shared across all Shovel platforms (Node, Bun, etc.).
 */

export { SimpleWatcher, type SimpleWatcherOptions } from './simple-watcher.js';

// Static files processing (build-time)
export { staticFilesPlugin } from './static-files.js';

// Static files handling (runtime)
export { 
  createStaticFilesMiddleware, 
  createCachedStaticFilesMiddleware
} from './handler.js';

// Configuration types
export type { AssetsConfig, RuntimeConfig, AssetManifest, AssetManifestEntry } from './shared.js';
export { mergeConfig, mergeRuntimeConfig, DEFAULT_CONFIG } from './shared.js';

// HTTP error handling (re-exported from @b9g/http-errors)
export {
  HTTPError,
  NotHandled,
  isHTTPError,
  createHTTPError,
  BadRequest,
  Unauthorized,
  Forbidden,
  NotFound,
  MethodNotAllowed,
  Conflict,
  UnprocessableEntity,
  TooManyRequests,
  InternalServerError,
  NotImplemented,
  BadGateway,
  ServiceUnavailable,
  GatewayTimeout,
  type HTTPErrorOptions
} from '@b9g/http-errors';

export { createServiceWorkerGlobals } from './serviceworker.js';

// Cache coordination for Worker threads (MemoryCache-specific)
export { MemoryCacheManager } from './memory-cache-manager.js';
export { WorkerAwareCacheStorage } from './worker-aware-cache-storage.js';

// TypeScript global declarations
export type {} from './global.js';