# Changelog

All notable changes to Shovel will be documented in this file.

## [0.2.2] - 2026-01-30

### Bug Fixes

- **Fix asset manifest invalidation in dev mode** - Assets with new content hashes after client bundle changes no longer return 404. The root cause was build-time manifest resolution reading stale data from disk during rebuilds. ([#36](https://github.com/bikeshaving/shovel/pull/36), fixes [#35](https://github.com/bikeshaving/shovel/issues/35))

## [0.2.0-beta.12] - 2026-01-14

### Breaking Changes

- **`shovel activate` command removed** - Use `shovel build --lifecycle` instead
- **`loadServiceWorker()` removed** - Use `platform.serviceWorker.register()` instead
- **`getEntryWrapper()` removed** - Use `getProductionEntryPoints()` instead

### Build System Unification

Major refactor of the build system to be platform-driven and unified across all commands.

- **New `ServerBundler` class** - Unified bundler replacing separate build/watch logic
- **Platform-driven entry points** - Platforms define their output structure via `getProductionEntryPoints()`:
  - Node/Bun: `{ index: "<supervisor>", worker: "<worker>" }` - two files
  - Cloudflare: `{ worker: "<code>" }` - single file
- **Deleted `activate` command** - Replaced with `shovel build --lifecycle` flag
  - `--lifecycle` - runs activate stage (default)
  - `--lifecycle install` - runs install stage only

### API Changes

- **New `platform.serviceWorker.register()` API** - Mirrors browser's `navigator.serviceWorker.register()`
- **Deleted `loadServiceWorker()`** - Use `serviceWorker.register()` instead
- **New `platform.listen()` / `close()`** - Server lifecycle management
- **New `runLifecycle()` and `dispatchRequest()`** - Public runtime utilities

### Code Quality

- Extracted `mergeConfigWithDefaults()` helper to reduce duplication
- Added JSDoc to platform `create*` methods documenting defaults
- Standardized import organization (node builtins → external → @b9g/* → relative)
- Renamed `isDynamicCode` → `containsRuntimeExpressions` for clarity

### Package Updates

- `@b9g/platform` → 0.1.14-beta.0
- `@b9g/platform-node` → 0.1.14-beta.0
- `@b9g/platform-bun` → 0.1.12-beta.0
- `@b9g/platform-cloudflare` → 0.1.12-beta.0

### Deleted Files

- `src/commands/activate.ts` - Replaced by `build --lifecycle`
- `src/utils/watcher.ts` - Merged into `ServerBundler`
- `src/plugins/shovel.ts` - Split into `config.ts` + `entry.ts`
- `packages/platform/test/single-threaded.test.ts`
- `SingleThreadedRuntime` class - All platforms now use `ServiceWorkerPool`

---

## [0.2.0-beta.11] - 2026-01-10

### Changes since beta.10
- **ESBuild configuration support (#18)** - Custom esbuild options in shovel.json
- **Config expression syntax** - `$PORT || 3000`, `$DATABASE_URL ?? null`
- **Null fallback fix** - Allow intentional null fallbacks in config expressions
- **DatabaseStorage API redesign** - New open/get pattern with IndexedDB-style migrations
- **Migrated from Drizzle to @b9g/zen** - Simpler, more portable database layer
- **Logging DX improvements** - Better defaults, consolidated categories
- **`impl` key unification** - Simplified resource configuration
- **CI/lint enforcement** - ESLint and Prettier standardized
- **Documentation** - Comprehensive docs for all APIs

### Package Updates
- `@b9g/router` → 0.2.0-beta.1 (CORS middleware, trailingSlash moved)
- `@b9g/node-webworker` → 0.2.0-beta.1 (CloseEvent, onclose, env option)
- `@b9g/cache-redis` → 0.2.0-beta.1 (logger category fix)
- `@b9g/assets` → 0.2.0-beta.0
- `@b9g/async-context` → 0.2.0-beta.0
- `@b9g/cache` → 0.2.0-beta.0
- `@b9g/http-errors` → 0.2.0-beta.0
- `@b9g/match-pattern` → 0.2.0-beta.0

---

## [0.2.0-beta.10] - Previous Beta

This is a major release that establishes Shovel as a complete ServiceWorker-based meta-framework. The 0.2.0 beta introduces locked-down APIs for core packages, a unified configuration system, and comprehensive platform support.

### Breaking Changes

- **`self.buckets` renamed to `self.directories`** - The file system API now uses `directories` to align with web standards terminology
- **`@b9g/router` middleware moved** - `trailingSlash` middleware moved from main export to `@b9g/router/middleware`
- **`self.loggers.get()` signature changed** - Now takes an array: `self.loggers.get(["app", "db"])` instead of dot notation
- **Config `module`/`export` unified to `impl`** - Resource configurations now use a single `impl` key for reified implementations

### New Features

#### Consistent Worker Execution Model (#17)
ServiceWorker code now ALWAYS runs in a worker thread, never the main thread. This ensures:
- Same globals/environment in dev and prod (eliminates mode-only bugs)
- Worker isolation preserved
- Simplified mental model

#### ESBuild Configuration Support (#18)
Custom ESBuild options can now be specified in `shovel.json`:
```json
{
  "esbuild": {
    "external": ["lightningcss"],
    "define": { "DEBUG": "true" }
  }
}
```

#### Config Expression Syntax
Environment variables and expressions in `shovel.json`:
```json
{
  "port": "$PORT || 3000",
  "databases": {
    "main": {
      "url": "$DATABASE_URL"
    }
  }
}
```

#### Comprehensive Logging System
- Built-in LogTape integration with console sink by default
- Configurable sinks (file, OpenTelemetry, Sentry, etc.)
- Category-based log levels
- `shovel` category logs at `info` level by default

#### Database Storage API
New `self.databases` API with IndexedDB-style migrations:
```typescript
self.addEventListener("activate", (event) => {
  event.waitUntil(
    databases.open("main", 2, (e) => {
      e.waitUntil(e.db.exec`CREATE TABLE users (...)`);
    })
  );
});

// In fetch handlers
const db = databases.get("main");
const users = await db.all`SELECT * FROM users`;
```

#### CORS Middleware
New CORS middleware in `@b9g/router/middleware`:
```typescript
import { cors } from "@b9g/router/middleware";
router.use(cors({ origin: "https://example.com" }));
```

### Package Updates

#### Locked at 0.2.0-beta.0 (API stable)
- `@b9g/async-context` - AsyncContext polyfill
- `@b9g/match-pattern` - URLPattern implementation
- `@b9g/assets` - Static asset pipeline with content hashing
- `@b9g/cache` - Cache API implementation (memory, postmessage)
- `@b9g/http-errors` - HTTP error classes

#### Updated to 0.2.0-beta.1
- `@b9g/router` - Added CORS middleware, moved trailingSlash to /middleware
- `@b9g/node-webworker` - Added CloseEvent, onclose handler, env option
- `@b9g/cache-redis` - Logger category updates

#### Still Evolving (0.1.x)
- `@b9g/platform` - Core runtime and platform abstraction
- `@b9g/platform-bun` - Bun platform adapter
- `@b9g/platform-node` - Node.js platform adapter
- `@b9g/platform-cloudflare` - Cloudflare Workers adapter
- `@b9g/filesystem` - File System Access API implementation
- `@b9g/filesystem-s3` - S3 filesystem adapter

### CLI Changes

- `shovel develop` - Development server with hot reload (note: `dev` alias removed)
- `shovel build` - Production build (use `--lifecycle` flag to run lifecycle events)
- Removed `--verbose` flags (use logging config instead)

### Infrastructure

- Migrated from Drizzle ORM to `@b9g/zen` for database operations
- Added GitHub Actions CI with parallel test execution
- ESLint and Prettier configuration standardized
- Comprehensive test suites with `bun:test`

### Documentation

New documentation pages:
- Getting Started guide
- CLI reference
- Configuration (shovel.json) reference
- Deployment guide
- ServiceWorker lifecycle
- Routing and middleware
- Storage APIs (databases, caches, directories)
- Cookies and AsyncContext

---

## [0.1.x] - Previous Releases

Initial development releases establishing core architecture:
- ServiceWorker-based request handling
- Platform abstraction layer
- Router with generator-based middleware
- Cache API implementations
- File System Access API
- Hot reload in development
