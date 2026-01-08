# Logging Analysis

## Current Categories (after consolidation)

| Category | Package/File | Used For |
|----------|-------------|----------|
| `["shovel"]` | `src/commands/*`, `src/utils/watcher.ts`, `src/plugins/assets.ts` | CLI and build system |
| `["shovel", "platform"]` | `packages/platform/*`, `packages/platform-bun/*`, `packages/platform-node/*`, `packages/platform-cloudflare/*` | Worker lifecycle, server internals |
| `["shovel", "router"]` | `packages/router/src/index.ts` | Router errors |
| `["shovel", "cache"]` | `packages/cache-redis/src/index.ts` | Cache operations |
| `["test", "wpt", "*"]` | `packages/shovel-wpt/*` | WPT test harness |

---

## All Messages by Current Category

### `["shovel"]` - CLI and Build System

| Level | Message | File |
|-------|---------|------|
| info | "Starting development server" | develop.ts |
| debug | "Platform: {platform}" | develop.ts |
| debug | "Worker count: {workerCount}" | develop.ts |
| info | "Reloaded" | develop.ts |
| info | "Server running at http://{host}:{port}" | develop.ts |
| debug | "Shutting down ({signal})" | develop.ts |
| debug | "Shutdown complete" | develop.ts |
| error | "Initial build failed..." | develop.ts |
| error | "Failed to start development server" | develop.ts |
| info | "Building ServiceWorker for activation" | activate.ts |
| info | "Activating ServiceWorker" | activate.ts |
| info | "ServiceWorker activated successfully" | activate.ts |
| debug | "Platform/Worker count" | activate.ts |
| debug | "Building entrypoint" | activate.ts |
| error | "ServiceWorker activation failed" | activate.ts |
| info | "Shovel Platform Information" | info.ts |
| debug | "Built app to..." | build.ts |
| debug | "Entry/Output/Target platform/Project root" | build.ts |
| debug | "Copied/Generated package.json" | build.ts |
| warn | "Entry point is empty" | build.ts |
| info | "Building..." | watcher.ts |
| info | "Config changed: {filename}, rebuilding..." | watcher.ts |
| debug | "Build complete" | watcher.ts |
| debug | "Starting esbuild watch mode" | watcher.ts |
| debug | "Generated asset manifest" | assets.ts |
| debug | "Explicitly watching user entry file" | watcher.ts |
| debug | "Native watcher detected change" | watcher.ts |
| debug | "Watching X source files in Y directories" | watcher.ts |
| error | "Non-analyzable dynamic import..." | watcher.ts |
| error | "Unexpected external import" | watcher.ts |
| error | "Build errors" | watcher.ts |
| error | "Rebuild failed" | watcher.ts |
| warn | "Failed to watch {file}" | watcher.ts |
| warn | "Failed to write asset manifest" | assets.ts |

### `["shovel", "platform"]` - Worker Lifecycle and Server

| Level | Message | File |
|-------|---------|------|
| debug | "SingleThreadedRuntime created/initialized/terminated" | platform/index.ts |
| debug | "Reloading/Loading ServiceWorker" | platform/index.ts |
| debug | "ServiceWorker loaded and activated" | platform/index.ts |
| debug | "Waiting for worker ready signal" | platform/index.ts |
| debug | "Worker ready" | platform/index.ts |
| debug | "Worker message received" | platform/index.ts |
| debug | "ServiceWorker ready" | platform/index.ts |
| debug | "Cache message received" | platform/index.ts |
| debug | "No workers available, waiting" | platform/index.ts |
| debug | "Dispatching to worker" | platform/index.ts |
| debug | "Reloading/All workers reloaded" | platform/index.ts |
| debug | "Using platform config (no config.js)" | platform-bun, platform-node |
| info | "Using @b9g/node-webworker shim" | platform/index.ts |
| info | "skipWaiting() called" | platform/runtime.ts |
| info | "Creating single-threaded ServiceWorker runtime" | platform-bun, platform-node |
| info | "Creating ServiceWorker pool" | platform-bun, platform-node |
| info | "ServiceWorker installed/activated/loaded/disposed" | platform-bun, platform-node |
| info | "Bun server running" | platform-bun |
| info | "Server started" | platform-node |
| info | "Starting production server" | platform-node (prod) |
| info | "Workers" | platform-node (prod) |
| info | "Server running" | platform-node (prod) |
| info | "Load balancing" | platform-node (prod) |
| info | "Shutting down server" | platform-node (prod) |
| info | "Server stopped" | platform-node (prod) |
| info | "Worker started" | platform-bun (prod) |
| info | "Spawned workers" | platform-bun (prod) |
| info | "Worker handler ready/stopped" | platform-cloudflare |
| info | "Starting miniflare dev server" | platform-cloudflare |
| info | "Setting up ASSETS binding" | platform-cloudflare |
| info | "Miniflare dev server ready" | platform-cloudflare |
| warn | "Worker shutdown timed out" | platform/index.ts |
| error | "Worker error" | platform/index.ts |
| error | "Worker error message received" | platform/index.ts |
| error | "Cache message handling failed" | platform/index.ts |
| error | "reportError" | platform/runtime.ts |
| error | "Request error" | platform-bun, platform-node |

### `["shovel", "router"]` - Router

| Level | Message | File |
|-------|---------|------|
| error | "Unhandled error" | router/index.ts |

### `["shovel", "cache"]` - Cache Operations

| Level | Message | File |
|-------|---------|------|
| info | "Connected to Redis" | cache-redis |
| info | "Redis connection closed" | cache-redis |
| warn | "Disconnected from Redis" | cache-redis |
| error | "Redis error" | cache-redis |
| error | "Failed to match/put/delete/get keys" | cache-redis |

---

## Observations

1. **Categories are now consistent** - all under `["shovel"]` hierarchy
2. **No HTTP request logging** - `["shovel", "router"]` only has error logging
3. **Many INFO messages in platform** - might be too verbose for production
4. **"ServiceWorker installed/activated"** comes from both platform code AND user code

---

## Summary

Categories are now consolidated:

| Category | Package(s) | What logs here |
|----------|------------|----------------|
| `["shovel"]` | `@b9g/shovel` | CLI and build system |
| `["shovel", "platform"]` | `@b9g/platform`, `@b9g/platform-*` | Worker lifecycle, server internals |
| `["shovel", "router"]` | `@b9g/router` | Router errors (no request logging yet) |
| `["shovel", "cache"]` | `@b9g/cache-redis` | Cache operations |

### Completed

1. ~~Merge `["shovel", "cli"]` and `["shovel", "build"]`~~ → `["shovel"]`
2. ~~Fix inconsistent `["platform"]`~~ → `["shovel", "platform"]` everywhere
3. ~~Remove `--verbose` CLI flags~~ → Use log levels instead

### Remaining

See [RFC: Logging Architecture](./rfc-logging.md) for open questions about:
- User API (`self.loggers` vs direct LogTape import)
- Configuration schema
- Defaults vs explicit configuration
- Multi-threaded sink architecture
- Request logging middleware
