# Shovel API Inventory

> Comprehensive API surface documentation for all packages in the Shovel monorepo.
> Last updated: 2025-11-16

---

## @b9g/platform (v0.1.4)

**Description**: ServiceWorker-first universal deployment platform. Write ServiceWorker apps once, deploy anywhere (Node/Bun/Cloudflare).

### Exports
- `.` → Main platform API
- `./runtime` → ServiceWorker runtime

### Classes

#### BasePlatform (abstract)
Base platform class with shared adapter loading logic.
- `async createCaches(config?: CacheConfig): Promise<CacheStorage>`
- `abstract loadServiceWorker(entrypoint: string, options?: any): Promise<any>`
- `abstract createServer(handler: any, options?: any): any`
- `abstract getDirectoryHandle(name: string): Promise<FileSystemDirectoryHandle>`

#### WorkerPool
Generic worker pool manager - self-similar to Worker API.
- `constructor(scriptURL: string, options?: {count?: number})`
- `async init(): Promise<void>`
- `postMessage(message: any, transfer?: Transferable[]): void`
- `async terminate(): Promise<void>`
- `get ready: boolean`

#### ServiceWorkerPool
ServiceWorker-specific worker pool with HTTP request handling.
- `constructor(options?: WorkerPoolOptions, appEntrypoint?: string, cacheStorage?: any)`
- `async init(): Promise<void>`
- `async handleRequest(request: Request): Promise<Response>`
- `async reloadWorkers(version?: number | string): Promise<void>`
- `async terminate(): Promise<void>`
- `get workerCount: number`
- `get ready: boolean`

#### ServiceWorker Runtime (from runtime.ts)

**Events**:
- `ExtendableEvent` - Base ServiceWorker event with waitUntil()
- `FetchEvent` - HTTP request event with respondWith()
- `InstallEvent` - ServiceWorker installation event
- `ActivateEvent` - ServiceWorker activation event

**Client API**:
- `Client` - ServiceWorker client representation
- `WindowClient` - Window client with focus() and navigate()
- `Clients` - Client container with claim() and matchAll()

**Registration**:
- `ServiceWorker` - ServiceWorker interface with state machine
- `ServiceWorkerRegistration` - Registration and lifecycle management
- `ServiceWorkerContainer` - Container for managing registrations
- `ShovelGlobalScope` - ServiceWorker global scope implementation

### Interfaces/Types
- `Platform` - Platform interface
- `CacheBackendConfig` - Cache backend configuration
- `CacheConfig` - Cache configuration for different cache types
- `ServerOptions` - Server options for platform implementations
- `Handler` - Request handler function (Web Fetch API compatible)
- `Server` - Server instance
- `ServiceWorkerOptions` - ServiceWorker entrypoint options
- `ServiceWorkerInstance` - ServiceWorker instance
- `WorkerPoolOptions` - Worker pool configuration
- `BucketStorage` - Bucket storage interface

### Functions

**Platform Detection**:
- `detectRuntime(): "bun" | "deno" | "node"` - Detect current JavaScript runtime
- `detectDeploymentPlatform(): string | null` - Detect deployment platform (Cloudflare Workers)
- `detectDevelopmentPlatform(): string` - Detect platform from package.json or runtime
- `resolvePlatform(options): string` - Resolve platform with fallback chain

**Platform Management**:
- `async createPlatform(platformName: string, options?: any): Promise<any>` - Create platform instance
- `getPlatform(name?: string): Platform` - Get platform by name
- `async getPlatformAsync(name?: string): Promise<Platform>` - Get platform with auto-registration
- `async getDirectoryHandle(name: string): Promise<FileSystemDirectoryHandle>` - Get filesystem handle

### Constants
- `platformRegistry` - Global platform registry

### Recent Changes
**Removed** (v0.1.4):
- `ShovelFetchEvent` - Use standard `FetchEvent`
- `ShovelInstallEvent` - Use standard `InstallEvent`
- `ShovelActivateEvent` - Use standard `ActivateEvent`
- Confidence-based platform detection - Now deterministic

**Added** (v0.1.4):
- Package.json-based platform detection
- Simplified to 3 launch platforms: Node, Bun, Cloudflare

---

## @b9g/platform-node (v0.1.6)

**Description**: Node.js platform adapter for Shovel with hot reloading and ESBuild integration.

### Exports
- `.` → Main platform implementation

### Classes

#### NodePlatform
Node.js platform implementation.
- `readonly name = "node"`
- `async loadServiceWorker(entrypoint: string, options?: ServiceWorkerOptions): Promise<ServiceWorkerInstance>`
- `createServer(handler: Handler, options?: ServerOptions): Server`
- `async getDirectoryHandle(name: string): Promise<FileSystemDirectoryHandle>`
- `async createCaches(config?: CacheConfig): Promise<CustomCacheStorage>`

### Re-exports
`Platform`, `CacheConfig`, `Handler`, `Server`, `ServerOptions` (from @b9g/platform)

---

## @b9g/platform-bun (v0.1.4)

**Description**: Bun platform adapter for Shovel with hot reloading and built-in TypeScript/JSX support.

### Exports
- `.` → Main platform implementation

### Classes

#### BunPlatform
Bun platform implementation.
- `readonly name = "bun"`
- `async loadServiceWorker(entrypoint: string, options?: ServiceWorkerOptions): Promise<ServiceWorkerInstance>`
- `createServer(handler: Handler, options?: ServerOptions): Server`
- `async getDirectoryHandle(name: string): Promise<FileSystemDirectoryHandle>`
- `async createCaches(config?: CacheConfig): Promise<CustomCacheStorage>`

### Re-exports
`Platform`, `CacheConfig`, `Handler`, `Server`, `ServerOptions`, `ServiceWorkerOptions`, `ServiceWorkerInstance` (from @b9g/platform)

---

## @b9g/platform-cloudflare (v0.1.4)

**Description**: Cloudflare Workers platform adapter - native ServiceWorker environment!

### Exports
- `.` → Main platform implementation
- `./wrangler` → Wrangler integration utilities

### Classes

#### CloudflarePlatform
Cloudflare Workers platform implementation.
- `readonly name = "cloudflare"`
- `async loadServiceWorker(entrypoint: string, options?: ServiceWorkerOptions): Promise<ServiceWorkerInstance>`
- `createServer(handler: Handler, options?: ServerOptions): Server`
- `async getDirectoryHandle(name: string): Promise<FileSystemDirectoryHandle>`
- `async createCaches(config?: CacheConfig): Promise<CacheStorage>`

### Functions
- `createOptionsFromEnv(env: any): CloudflarePlatformOptions` - Create platform options from Wrangler environment
- `generateWranglerConfig(options): string` - Generate wrangler.toml configuration

### Constants
- `cloudflareWorkerBanner` - ServiceWorker → ES Module banner
- `cloudflareWorkerFooter` - ServiceWorker → ES Module footer

### Re-exports
`Platform`, `CacheConfig`, `Handler`, `Server`, `ServerOptions`, `ServiceWorkerOptions`, `ServiceWorkerInstance` (from @b9g/platform)

---

## @b9g/cache (v0.1.3)

**Description**: Universal Cache API for ServiceWorker applications. Standard CacheStorage and Cache interfaces across all JavaScript runtimes.

### Exports
- `.` → Main cache exports
- `./cache` → Core cache interface
- `./cache-storage` → CacheStorage implementation
- `./memory` → Memory cache
- `./postmessage` → Worker thread cache

### Classes

#### Cache (abstract)
Abstract Cache class implementing Web Cache API.
- `abstract async match(request: Request, options?: CacheQueryOptions): Promise<Response | undefined>`
- `abstract async put(request: Request, response: Response): Promise<void>`
- `abstract async delete(request: Request, options?: CacheQueryOptions): Promise<boolean>`
- `abstract async keys(request?: Request, options?: CacheQueryOptions): Promise<Request[]>`
- `async add(request: Request): Promise<void>`
- `async addAll(requests: Request[]): Promise<void>`
- `async matchAll(request?: Request, options?: CacheQueryOptions): Promise<Response[]>`

#### CustomCacheStorage
CacheStorage implementation with factory pattern.
- `constructor(factory: CacheFactory)`
- `async open(name: string): Promise<Cache>`
- `async has(name: string): Promise<boolean>`
- `async delete(name: string): Promise<boolean>`
- `async keys(): Promise<string[]>`
- `getStats()` - Get cache statistics
- `async handleMessage(worker: any, message: any): Promise<void>` - Handle worker cache messages

#### MemoryCache
In-memory cache implementation.
- `constructor(name: string, options?: MemoryCacheOptions)`
- `async match(request, options?): Promise<Response | undefined>`
- `async put(request, response): Promise<void>`
- `async delete(request, options?): Promise<boolean>`
- `async keys(request?, options?): Promise<Request[]>`
- `async clear(): Promise<void>`
- `getStats()` - Get cache statistics

#### PostMessageCache
Worker-side cache forwarding to main thread via postMessage.
- `constructor(name: string, options?: PostMessageCacheOptions)`
- `async match(request, options?): Promise<Response | undefined>`
- `async put(request, response): Promise<void>`
- `async delete(request, options?): Promise<boolean>`
- `async keys(request?, options?): Promise<Request[]>`
- `async clear(): Promise<void>`

### Interfaces/Types
- `CacheQueryOptions` - Cache query options for matching requests
- `CacheFactory` - Factory function: `(name: string) => Cache | Promise<Cache>`
- `MemoryCacheOptions` - Memory cache configuration
- `PostMessageCacheOptions` - PostMessage cache configuration

### Functions
- `generateCacheKey(request: Request, options?: CacheQueryOptions): string` - Generate cache key from request

---

## @b9g/cache-redis (v0.1.2)

**Description**: Redis cache adapter for Shovel cache system.

### Exports
- `.` → Redis cache implementation

### Classes

#### RedisCache
Redis-backed cache implementation.
- `constructor(name: string, options?: RedisCacheOptions)`
- `async match(request, options?): Promise<Response | undefined>`
- `async put(request, response): Promise<void>`
- `async delete(request, options?): Promise<boolean>`
- `async keys(request?, options?): Promise<Request[]>`
- `async getStats()` - Get cache statistics

### Interfaces/Types
- `RedisCacheOptions` - Redis cache configuration

---

## @b9g/filesystem (v0.1.4)

**Description**: Universal File System Access API implementations for all platforms.

### Exports
- `.` → Main filesystem exports
- `./memory` → Memory filesystem
- `./node` → Node.js filesystem
- `./bun-s3` → Bun S3 filesystem
- `./registry` → Filesystem registry
- `./types` → Type definitions
- `./directory-storage` → Directory storage utilities

### Classes

#### ShovelHandle (abstract)
Base FileSystemHandle implementation.
- `constructor(backend: FileSystemBackend, path: string)`
- `abstract readonly kind: "file" | "directory"`
- `readonly name: string`
- `async isSameEntry(other: FileSystemHandle): Promise<boolean>`
- `async queryPermission(descriptor?): Promise<PermissionState>`
- `async requestPermission(descriptor?): Promise<PermissionState>`

#### ShovelFileHandle
FileSystemFileHandle implementation.
- Extends `ShovelHandle`
- `readonly kind = "file"`
- `async getFile(): Promise<File>`
- `async createWritable(): Promise<FileSystemWritableFileStream>`
- `async createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle>`

#### ShovelDirectoryHandle
FileSystemDirectoryHandle implementation.
- Extends `ShovelHandle`
- `readonly kind = "directory"`
- `async getFileHandle(name: string, options?: {create?: boolean}): Promise<FileSystemFileHandle>`
- `async getDirectoryHandle(name: string, options?: {create?: boolean}): Promise<FileSystemDirectoryHandle>`
- `async removeEntry(name: string, options?: {recursive?: boolean}): Promise<void>`
- `async resolve(possibleDescendant: FileSystemHandle): Promise<string[] | null>`
- `async *entries(): AsyncIterableIterator<[string, FileSystemHandle]>`
- `async *keys(): AsyncIterableIterator<string>`
- `async *values(): AsyncIterableIterator<FileSystemHandle>`

#### Backend Implementations
- `MemoryBucket` - Memory-based filesystem
- `NodeBucket` - Node.js filesystem
- `S3Bucket` - S3-based filesystem

#### CustomBucketStorage
BucketStorage with factory pattern.
- `constructor(factory: BucketFactory)`
- `async open(name: string): Promise<FileSystemDirectoryHandle>`
- `async getDirectoryHandle(name: string): Promise<FileSystemDirectoryHandle>`
- `async has(name: string): Promise<boolean>`
- `async delete(name: string): Promise<boolean>`
- `async keys(): Promise<string[]>`

#### FileSystemRegistry
Registry for filesystem adapters.
- `static register(name: string, handle: FileSystemDirectoryHandle): void`
- `static get(name: string): FileSystemDirectoryHandle | undefined`
- `static has(name: string): boolean`
- `static list(): string[]`

### Interfaces/Types
- `FileSystemConfig` - Filesystem adapter configuration
- `Bucket` - Type alias for FileSystemDirectoryHandle
- `FileSystemBackend` - Storage backend interface
- `BucketFactory` - Factory function: `(name: string) => FileSystemDirectoryHandle | Promise<FileSystemDirectoryHandle>`

### Functions
- `getDirectoryHandle(name: string): Promise<FileSystemDirectoryHandle>` - Get directory handle from registry

---

## @b9g/filesystem-r2 (v0.1.3)

**Description**: Cloudflare R2 implementation of File System Access API.

### Exports
- `.` → R2 filesystem implementation

### Classes

#### R2FileSystemFileHandle
R2 implementation of FileSystemFileHandle.
- `constructor(r2Bucket: R2Bucket, key: string)`
- `readonly kind = "file"`
- `async getFile(): Promise<File>`
- `async createWritable(): Promise<FileSystemWritableFileStream>`

#### R2FileSystemDirectoryHandle
R2 implementation of FileSystemDirectoryHandle.
- `constructor(r2Bucket: R2Bucket, prefix: string)`
- `readonly kind = "directory"`
- `async getFileHandle(name, options?): Promise<FileSystemFileHandle>`
- `async getDirectoryHandle(name, options?): Promise<FileSystemDirectoryHandle>`
- `async removeEntry(name, options?): Promise<void>`
- `async *entries(): AsyncIterableIterator<[string, FileSystemHandle]>`

#### R2FileSystemAdapter
R2 filesystem adapter.
- `constructor(r2Bucket: R2Bucket, config?: FileSystemConfig)`
- `async getFileSystemRoot(name?: string): Promise<FileSystemDirectoryHandle>`

---

## @b9g/filesystem-s3 (v0.1.3)

**Description**: AWS S3 implementation of File System Access API.

### Exports
- `.` → S3 filesystem implementation

### Classes

#### S3FileSystemFileHandle
S3 implementation of FileSystemFileHandle.
- `constructor(s3Client: any, bucket: string, key: string)`
- `readonly kind = "file"`
- `async getFile(): Promise<File>`
- `async createWritable(): Promise<FileSystemWritableFileStream>`

#### S3FileSystemDirectoryHandle
S3 implementation of FileSystemDirectoryHandle.
- `constructor(s3Client: any, bucket: string, prefix: string)`
- `readonly kind = "directory"`
- `async getFileHandle(name, options?): Promise<FileSystemFileHandle>`
- `async getDirectoryHandle(name, options?): Promise<FileSystemDirectoryHandle>`
- `async removeEntry(name, options?): Promise<void>`
- `async *entries(): AsyncIterableIterator<[string, FileSystemHandle]>`

#### S3FileSystemAdapter
S3 filesystem adapter using AWS SDK.
- `constructor(s3Client: any, bucket: string, config?: FileSystemConfig)`
- `async getFileSystemRoot(name?: string): Promise<FileSystemDirectoryHandle>`

---

## @b9g/router (v0.1.5)

**Description**: Universal request router for ServiceWorker applications. Cache-aware routing with generator-based middleware.

### Exports
- `.` → Main router exports
- `./router` → Router implementation

### Classes

#### Router
Request/Response router with middleware support.
- `constructor(options?: RouterOptions)`
- `use(middleware: Middleware): void` - Register global middleware
- `use(pattern: string, handler: Handler): void` - Register pattern handler
- `route(pattern: string): RouteBuilder` - Create route builder
- `route(config: RouteConfig): RouteBuilder` - Create route builder with cache config
- `handler: (request: Request) => Promise<Response>` - Main ServiceWorker entrypoint
- `async match(request: Request): Promise<Response | null>` - Match and execute handler chain
- `mount(mountPath: string, subrouter: Router): void` - Mount subrouter
- `getRoutes(): RouteEntry[]` - Get routes for debugging
- `getMiddlewares(): MiddlewareEntry[]` - Get middleware for debugging
- `getStats()` - Get route statistics

### Interfaces/Types
- `RouteContext` - Context passed to handlers and middleware
- `Handler` - Handler function: `(request: Request, context: RouteContext) => Response | Promise<Response>`
- `GeneratorMiddleware` - Generator middleware
- `FunctionMiddleware` - Function middleware
- `Middleware` - Union of all middleware types
- `HttpMethod` - HTTP methods: "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS"
- `RouteCacheConfig` - Cache configuration for routes
- `RouteConfig` - Route configuration options
- `RouterOptions` - Router configuration options

---

## @b9g/http-errors (v0.1.3)

**Description**: Standard HTTP error responses for ServiceWorker applications. Returns Response objects, not thrown exceptions.

### Exports
- `.` → HTTP error classes and utilities

### Classes

#### HTTPError
Base HTTP error class.
- `constructor(status: number, message?: string, options?: HTTPErrorOptions)`
- `readonly status: number`
- `readonly expose: boolean`
- `readonly headers?: Record<string, string>`
- `toJSON()` - Serialize to plain object
- `toResponse(): Response` - Create Response object

#### Error Classes
All extend `HTTPError`:
- `BadRequest` (400)
- `Unauthorized` (401)
- `Forbidden` (403)
- `NotFound` (404)
- `MethodNotAllowed` (405)
- `Conflict` (409)
- `UnprocessableEntity` (422)
- `TooManyRequests` (429)
- `InternalServerError` (500)
- `NotImplemented` (501)
- `BadGateway` (502)
- `ServiceUnavailable` (503)
- `GatewayTimeout` (504)

#### NotHandled
Special error for middleware fallthrough (not an HTTP error).

### Interfaces/Types
- `HTTPErrorOptions` - Options for creating HTTP errors

### Functions
- `isHTTPError(value: any): value is HTTPError` - Type guard
- `createHTTPError(status: number, message?: string, options?: HTTPErrorOptions): HTTPError` - Factory function

---

## @b9g/match-pattern (v0.1.6)

**Description**: Enhanced URLPattern with order-independent search parameter matching.

### Exports
- `.` → MatchPattern implementation

### Classes

#### MatchPattern
Enhanced URLPattern with routing capabilities.
- `constructor(input: string | URLPatternInit, baseURL?: string)`
- `exec(input: string | URL): MatchPatternResult | null` - Enhanced exec with unified params
- `test(input: string | URL): boolean` - Enhanced test with order-independent search params

### Interfaces/Types
- `MatchPatternResult` - Enhanced URLPattern result with unified params

---

## @b9g/assets (v0.1.4)

**Description**: Universal assets processing and serving.

### Exports
- `.` → Main exports
- `./middleware` → Middleware implementation

### Functions
- `assets` - Assets middleware function

---

## @b9g/node-webworker (v0.1.2)

**Description**: Minimal Web Worker shim for Node.js until native support arrives.

### Exports
- `.` → Worker implementation
- `./worker-wrapper` → Worker wrapper script

### Classes

#### Worker
Web Worker API for Node.js using worker_threads.
- `constructor(scriptURL: string, options?: {type?: "classic" | "module"})`
- `postMessage(message: any, transfer?: Transferable[]): void`
- `addEventListener(type: "message" | "error", listener: (event: any) => void): void`
- `removeEventListener(type: "message" | "error", listener: (event: any) => void): void`
- `async terminate(): Promise<number>`

### Interfaces/Types
- `MessageEvent` - Message event object
- `ErrorEvent` - Error event object

---

## Summary Statistics

### Package Count: 14

**Platform Packages** (4):
- @b9g/platform - Core platform abstraction
- @b9g/platform-node - Node.js adapter
- @b9g/platform-bun - Bun adapter
- @b9g/platform-cloudflare - Cloudflare Workers adapter

**Core Infrastructure** (2):
- @b9g/cache - Universal cache API
- @b9g/filesystem - Universal filesystem API

**Adapters** (4):
- @b9g/cache-redis - Redis cache
- @b9g/filesystem-r2 - Cloudflare R2
- @b9g/filesystem-s3 - AWS S3
- @b9g/node-webworker - Web Worker shim

**Application Framework** (4):
- @b9g/router - Request router
- @b9g/http-errors - HTTP error handling
- @b9g/match-pattern - Enhanced URLPattern
- @b9g/assets - Assets processing

### API Surface Overview
- **50+ exported classes**
- **40+ exported interfaces/types**
- **30+ exported functions**
- **Consistent patterns**: Factory, Registry, Adapter, Worker Pool

### Architectural Principles

1. **Web Standards First**: ServiceWorker API, Cache API, File System Access API, URLPattern
2. **Platform Abstraction**: Write once, run anywhere (Node/Bun/Cloudflare)
3. **Factory Pattern**: Dynamic adapter loading for cache and filesystem backends
4. **Registry Pattern**: Centralized platform and filesystem management
5. **Worker Pool**: Multi-threaded ServiceWorker execution for Node/Bun
6. **TypeScript-First**: Comprehensive type definitions across all packages

### Launch Status (v0.1.x)

**Supported Platforms**:
- ✅ Node.js (v18+)
- ✅ Bun
- ✅ Cloudflare Workers

**Platform Detection**:
- ✅ Package.json-based (checks for @b9g/platform-* dependencies)
- ✅ Runtime-based (Bun/Node/Deno detection)
- ✅ Environment-based (Cloudflare Workers detection)

**Recent Cleanups**:
- Removed confidence-based platform detection
- Removed legacy Shovel*Event interfaces
- Removed unused dependencies
- Simplified to 3 launch platforms
