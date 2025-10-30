/**
 * @b9g/shovel-compiler - Shovel's compilation and development infrastructure
 * 
 * This package provides the core compilation, bundling, and development features
 * that are shared across all Shovel platforms (Node, Bun, etc.).
 */

// Watcher and hot reload
export { Watcher, createModuleLinker, fixErrorStack } from './watcher.js';

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

// HTTP error handling
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
} from './http-errors.js';

// VM execution engine
export {
  executeInVM,
  createServiceWorkerGlobals,
  Hot,
  type ServiceWorkerRuntime,
  type VMExecutionOptions,
  type VMExecutionResult
} from './vm-execution.js';

// Worker runtime (VM in Worker for double isolation)
export {
  WorkerRuntime,
  createWorkerRuntime,
  type WorkerRuntimeOptions
} from './worker-runtime.js';

// TypeScript global declarations
export type {} from './global.js';