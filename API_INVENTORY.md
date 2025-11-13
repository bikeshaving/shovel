# Comprehensive API Inventory for Shovel Packages

## Main Package: @b9g/shovel

**Package Name:** `@b9g/shovel`
**Version:** 0.1.10
**Description:** ServiceWorker-first universal deployment platform

### Exports (from package.json)
- `./cli` - CLI tools
- `./global` - Global TypeScript declarations for asset imports
- `./shared` - Shared configuration types
- `./serviceworker` - ServiceWorker runtime
- `./assets` - Assets processing configuration
- `./config` - Configuration utilities
- `./populate` - Populate utilities
- `./watcher` - File watching utilities

### From `/shared` export:
#### Interfaces/Types
- `AssetsConfig` - Configuration for build plugin and runtime
- `RuntimeConfig` - Runtime-specific configuration
- `AssetManifestEntry` - Asset manifest entry structure
- `AssetManifest` - Asset manifest structure

#### Constants
- `DEFAULT_CONFIG` - Default configuration values

#### Functions
- `mergeConfig(userConfig?)` - Merge user config with defaults
- `mergeRuntimeConfig(userConfig?)` - Merge runtime config with defaults

---

## @b9g/assets

**Package Name:** `@b9g/assets`
**Version:** 0.1.4
**Type:** module

### Exports
- `./index` - Main exports
- `./middleware` - Middleware exports

### From `/index` export:
#### Functions
- `assets` - Assets processing and serving middleware (re-exported from middleware)

---

## @b9g/cache

**Package Name:** `@b9g/cache`
**Version:** 0.1.3
**Description:** Universal Cache API for ServiceWorker applications

### Exports
- `./index` - Main exports
- `./cache` - Core cache interface
- `./cache-storage` - CacheStorage implementation
- `./memory` - Memory cache implementation
- `./postmessage` - PostMessage cache for workers

### From `/index` export:
#### Classes
- `Cache` - Base cache interface
- `CustomCacheStorage` - CacheStorage with factory pattern
- `MemoryCache` - Memory-backed cache implementation (main thread)
- `MemoryCacheManager` - Manager for memory caches
- `PostMessageCache` - PostMessage cache (worker thread coordination)

#### Interfaces/Types
- `CacheQueryOptions` - Cache query options
- `CacheFactory` - Factory function type for cache creation
- `MemoryCacheOptions` - Memory cache configuration options
- `PostMessageCacheOptions` - PostMessage cache configuration options

#### Functions
- `generateCacheKey(request, options?)` - Generate cache key from request
- `cloneResponse(response)` - Clone a Response object
- `createCache(config?)` - Factory function to create MemoryCache instance

---

## @b9g/cache-redis

**Package Name:** `@b9g/cache-redis`
**Version:** 0.1.2
**Description:** Redis cache adapter for Shovel cache system

### Exports
- `./index` - Main exports

### From `/index` export:
#### Classes
- `RedisCache` - Redis-backed cache implementation

#### Interfaces/Types
- `RedisCacheOptions` - Redis cache configuration

---

## @b9g/filesystem

**Package Name:** `@b9g/filesystem`
**Version:** 0.1.4
**Description:** Universal File System Access API implementations

### Exports
- `./index` - Main exports
- `./memory` - Memory filesystem
- `./node` - Node.js filesystem
- `./bun-s3` - Bun S3 filesystem
- `./registry` - Filesystem registry
- `./types` - Type definitions
- `./directory-storage` - Directory storage utilities

### From `/index` export:
#### Classes
- `ShovelHandle` - Base FileSystemHandle implementation
- `ShovelFileHandle` - FileSystemFileHandle implementation
- `ShovelDirectoryHandle` - FileSystemDirectoryHandle implementation
- `MemoryBucket` - In-memory filesystem
- `MemoryFileSystemBackend` - Memory backend
- `NodeBucket` - Node.js filesystem
- `NodeFileSystemBackend` - Node.js backend
- `S3Bucket` - S3 filesystem (from bun-s3)
- `S3FileSystemBackend` - S3 backend
- `FileSystemRegistry` - Registry for filesystem buckets
- `CustomBucketStorage` - BucketStorage with factory pattern

#### Interfaces/Types
- `FileSystemConfig` - Configuration for filesystem adapters
- `Bucket` - Type alias for FileSystemDirectoryHandle
- `FileSystemPermissionDescriptor` - Permission descriptor
- `FileSystemBackend` - Storage backend interface
- `BucketFactory` - Factory function type for bucket creation

#### Functions
- `getDirectoryHandle(name)` - Get directory handle from registry

---

## @b9g/filesystem-r2

**Package Name:** `@b9g/filesystem-r2`
**Version:** 0.1.3
**Description:** Cloudflare R2 implementation of File System Access API

### Exports
- `./index` - Main exports

### From `/index` export:
#### Classes
- `R2FileSystemWritableFileStream` - R2 writable stream
- `R2FileSystemFileHandle` - R2 file handle
- `R2FileSystemDirectoryHandle` - R2 directory handle
- `R2FileSystemAdapter` - R2 filesystem adapter

---

## @b9g/filesystem-s3

**Package Name:** `@b9g/filesystem-s3`
**Version:** 0.1.3
**Description:** AWS S3 implementation of File System Access API

### Exports
- `./index` - Main exports

### From `/index` export:
#### Classes
- `S3FileSystemWritableFileStream` - S3 writable stream
- `S3FileSystemFileHandle` - S3 file handle
- `S3FileSystemDirectoryHandle` - S3 directory handle
- `S3FileSystemAdapter` - S3 filesystem adapter

---

## @b9g/http-errors

**Package Name:** `@b9g/http-errors`
**Version:** 0.1.3
**Description:** Standard HTTP error responses for ServiceWorker applications

### Exports
- `./index` - Main exports

### From `/index` export:
#### Classes (All extend HTTPError)
- `HTTPError` - Base HTTP error class
- `NotHandled` - Special error for middleware fallthrough
- `BadRequest` - 400 error
- `Unauthorized` - 401 error
- `Forbidden` - 403 error
- `NotFound` - 404 error
- `MethodNotAllowed` - 405 error
- `Conflict` - 409 error
- `UnprocessableEntity` - 422 error
- `TooManyRequests` - 429 error
- `InternalServerError` - 500 error
- `NotImplemented` - 501 error
- `BadGateway` - 502 error
- `ServiceUnavailable` - 503 error
- `GatewayTimeout` - 504 error

#### Interfaces/Types
- `HTTPErrorOptions` - Options for creating HTTP errors

#### Functions
- `isHTTPError(value)` - Type guard for HTTP errors
- `createHTTPError(status, message?, options?)` - Create HTTP error (default export)

---

## @b9g/match-pattern

**Package Name:** `@b9g/match-pattern`
**Version:** 0.1.6
**Type:** module

### Exports
- `./index` - Main exports

### From `/index` export:
#### Classes
- `MatchPattern` - Enhanced URLPattern with routing capabilities

#### Interfaces/Types
- `MatchPatternResult` - Enhanced URLPattern result with unified params

---

## @b9g/router

**Package Name:** `@b9g/router`
**Version:** 0.1.5
**Description:** Universal request router for ServiceWorker applications

### Exports
- `./index` - Main exports
- `./router` - Router implementation

### From `/index` export:
#### Classes
- `Router` - Request/Response router with middleware support

#### Interfaces/Types
- `RouteContext` - Context passed to handlers/middleware
- `Handler` - Handler function signature
- `GeneratorMiddleware` - Generator middleware signature
- `FunctionMiddleware` - Function middleware signature
- `Middleware` - Union of all middleware types
- `HttpMethod` - HTTP methods type
- `RouteCacheConfig` - Cache configuration for routes
- `RouteConfig` - Route configuration options
- `RouterOptions` - Router configuration options

---

## @b9g/node-webworker

**Package Name:** `@b9g/node-webworker`
**Version:** 0.1.2
**Description:** Minimal Web Worker shim for Node.js

### Exports
- `./index` - Main exports
- `./worker-wrapper` - Worker wrapper script

### From `/index` export:
#### Classes
- `Worker` - Web Worker API implementation for Node.js (default export)

#### Interfaces/Types
- `MessageEvent` - Message event interface
- `ErrorEvent` - Error event interface

---

## @b9g/platform

**Package Name:** `@b9g/platform`
**Version:** 0.1.4
**Description:** ServiceWorker-first universal deployment platform

### Exports
- `./index` - Main exports
- `./types` - Type definitions
- `./adapter-registry` - Adapter registry
- `./base-platform` - Base platform class
- `./filesystem` - Filesystem utilities
- `./registry` - Platform registry
- `./service-worker` - ServiceWorker runtime
- `./utils` - Utility functions
- `./detection` - Platform detection
- `./directory-storage` - Directory storage
- `./worker-pool` - Worker pool management
- `./worker-web` - Web worker utilities

### From `/index` export:
#### Classes
- `BasePlatform` - Base platform implementation
- `ShovelGlobalScope` - ServiceWorker global scope
- `ServiceWorkerRegistration` - ServiceWorker registration API
- `PlatformBucketStorage` - Bucket storage implementation
- `WorkerPool` - Worker pool manager
- `CustomBucketStorage` - Custom bucket storage (re-export from filesystem)
- `Client` - ServiceWorker Client API
- `Clients` - ServiceWorker Clients API
- `WindowClient` - ServiceWorker WindowClient API
- `ExtendableMessageEvent` - ExtendableMessageEvent API
- `ServiceWorker` - ServiceWorker API
- `ServiceWorkerContainer` - ServiceWorker container API
- `NavigationPreloadManager` - Navigation preload manager
- `Notification` - Notification API
- `NotificationEvent` - Notification event
- `PushEvent` - Push event
- `PushMessageData` - Push message data
- `SyncEvent` - Sync event
- `ServiceWorkerAPI` - Complete ServiceWorker API shim

#### Interfaces/Types
- `Platform` - Platform interface
- `CacheConfig` - Cache configuration
- `CacheBackendConfig` - Cache backend configuration
- `ServerOptions` - Server options
- `CorsConfig` - CORS configuration
- `Handler` - Request handler type
- `Server` - Server interface
- `ServiceWorkerOptions` - ServiceWorker options
- `ServiceWorkerInstance` - ServiceWorker instance
- `PlatformDetection` - Platform detection result
- `PlatformRegistry` - Platform registry interface
- `ShovelFetchEvent` - Shovel fetch event
- `ShovelInstallEvent` - Shovel install event
- `ShovelActivateEvent` - Shovel activate event
- `ShovelStaticEvent` - Shovel static event
- `BucketStorageInterface` - Bucket storage interface
- `ShovelGlobalScopeOptions` - Global scope options
- `BucketFactory` - Bucket factory type
- `PlatformWorker` - Platform worker interface
- `WorkerPoolOptions` - Worker pool options

#### Functions
- `platformRegistry` - Global platform registry
- `detectPlatform()` - Detect current platform
- `getPlatform(name)` - Get platform by name
- `getPlatformAsync(name)` - Get platform asynchronously
- `detectRuntime()` - Detect JavaScript runtime
- `detectDevelopmentPlatform()` - Detect development platform
- `detectPlatforms()` - Detect all available platforms
- `getBestPlatformDetection(detections)` - Get best platform detection
- `resolvePlatform(detections)` - Resolve platform from detections
- `createPlatform(detection)` - Create platform instance
- `displayPlatformInfo(detection)` - Display platform info
- `parseTTL(ttl)` - Parse TTL string/number
- `mergeCacheConfig(base, override)` - Merge cache configs
- `validateCacheConfig(config)` - Validate cache config
- `createCorsHeaders(config)` - Create CORS headers
- `mergeHeaders(base, override)` - Merge headers
- `isPreflightRequest(request)` - Check if request is preflight
- `createPreflightResponse(config)` - Create preflight response
- `getDirectoryHandle(name)` - Get directory handle
- `getBucket(name)` - Get bucket by name
- `getFileSystemRoot(name?)` - Get filesystem root

---

## @b9g/platform-node

**Package Name:** `@b9g/platform-node`
**Version:** 0.1.6
**Description:** Node.js platform adapter for Shovel

### Exports
- `./index` - Main exports
- `./platform` - Platform implementation

### From `/index` export:
#### Classes
- `NodePlatform` - Node.js platform implementation (default export)

#### Interfaces/Types
- `NodePlatformOptions` - Node.js platform options
- `Platform` - Platform interface (re-export)
- `CacheConfig` - Cache config (re-export)
- `StaticConfig` - Static config (re-export)
- `Handler` - Handler type (re-export)
- `Server` - Server interface (re-export)
- `ServerOptions` - Server options (re-export)

---

## @b9g/platform-bun

**Package Name:** `@b9g/platform-bun`
**Version:** 0.1.4
**Description:** Bun platform adapter for Shovel

### Exports
- `./index` - Main exports
- `./platform` - Platform implementation

### From `/index` export:
#### Classes
- `BunPlatform` - Bun platform implementation (default export)

#### Interfaces/Types
- `BunPlatformOptions` - Bun platform options
- `Platform` - Platform interface (re-export)
- `CacheConfig` - Cache config (re-export)
- `StaticConfig` - Static config (re-export)
- `Handler` - Handler type (re-export)
- `Server` - Server interface (re-export)
- `ServerOptions` - Server options (re-export)
- `ServiceWorkerOptions` - ServiceWorker options (re-export)
- `ServiceWorkerInstance` - ServiceWorker instance (re-export)

---

## @b9g/platform-cloudflare

**Package Name:** `@b9g/platform-cloudflare`
**Version:** 0.1.4
**Description:** Cloudflare Workers platform adapter for Shovel

### Exports
- `./index` - Main exports
- `./platform` - Platform implementation
- `./wrangler` - Wrangler integration utilities
- `./wrapper` - Wrapper utilities

### From `/index` export:
#### Classes
- `CloudflarePlatform` - Cloudflare platform implementation (default export)

#### Interfaces/Types
- `CloudflarePlatformOptions` - Cloudflare platform options
- `Platform` - Platform interface (re-export)
- `CacheConfig` - Cache config (re-export)
- `StaticConfig` - Static config (re-export)
- `Handler` - Handler type (re-export)
- `Server` - Server interface (re-export)
- `ServerOptions` - Server options (re-export)
- `ServiceWorkerOptions` - ServiceWorker options (re-export)
- `ServiceWorkerInstance` - ServiceWorker instance (re-export)

#### Functions
- `createOptionsFromEnv(env)` - Create platform options from Wrangler environment
- `generateWranglerConfig(options)` - Generate wrangler.toml configuration

#### Constants
- `cloudflareWorkerBanner` - Banner code for ServiceWorker to ES Module conversion
- `cloudflareWorkerFooter` - Footer code for ServiceWorker to ES Module conversion

---

## Summary Statistics

**Total Packages:** 14
- Main package: 1 (@b9g/shovel)
- Core packages: 4 (@b9g/cache, @b9g/filesystem, @b9g/http-errors, @b9g/router)
- Cache adapters: 1 (@b9g/cache-redis)
- Filesystem adapters: 2 (@b9g/filesystem-r2, @b9g/filesystem-s3)
- Utility packages: 3 (@b9g/assets, @b9g/match-pattern, @b9g/node-webworker)
- Platform packages: 4 (@b9g/platform, @b9g/platform-node, @b9g/platform-bun, @b9g/platform-cloudflare)

**API Surface Overview:**
- 50+ exported classes
- 40+ exported interfaces/types
- 30+ exported functions
- Multiple constants and utilities

All packages follow a consistent pattern with TypeScript-first development and comprehensive type definitions.
