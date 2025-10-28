/**
 * @b9g/platform - Base Platform interface and utilities for Shovel deployment adapters
 * 
 * This package provides the core Platform interface and shared utilities that all
 * platform-specific adapters implement. Platform adapters handle deployment-specific
 * concerns like server setup, cache backends, and static file serving.
 */

// Core types and interfaces
export type {
  Platform,
  CacheConfig,
  CacheBackendConfig,
  StaticConfig,
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