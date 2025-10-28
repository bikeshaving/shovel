/**
 * @b9g/platform - Platform interface for ServiceWorker entrypoint loading
 * 
 * Platform = "ServiceWorker entrypoint loader for JavaScript runtimes"
 * Core responsibility: Take a ServiceWorker-style app file and make it run in this environment.
 */

// Core types and interfaces
export type {
  Platform,
  CacheConfig,
  CacheBackendConfig,
  ServerOptions,
  CorsConfig,
  Handler,
  Server,
  ServiceWorkerOptions,
  ServiceWorkerInstance,
  PlatformDetection,
  PlatformRegistry,
} from './types.js';

// ServiceWorker runtime
export {
  ServiceWorkerRuntime,
  createServiceWorkerGlobals,
  type ShovelFetchEvent,
  type ShovelInstallEvent,
  type ShovelActivateEvent,
  type ShovelPlatformEvent,
  type ShovelStaticEvent,
} from './service-worker.js';

// Platform registry and detection
export {
  platformRegistry,
  detectPlatform,
  getPlatform,
} from './registry.js';

// Utility functions
export {
  parseTTL,
  mergeCacheConfig,
  validateCacheConfig,
  createCorsHeaders,
  mergeHeaders,
  isPreflightRequest,
  createPreflightResponse,
} from './utils.js';