# Changelog

All notable changes to Shovel will be documented in this file.

## [0.2.9] - 2026-02-20

### Features

- **Dev server Ctrl+O** - Open the dev server URL in the default browser with `Ctrl+O`
- **Dev server signal handling** - `Ctrl+Z` (suspend), `Ctrl+D` (quit), `Ctrl+\` (quit) now work correctly in raw mode instead of being silently swallowed
- **Dev server input passthrough** - Typing, Enter, and Backspace now echo to stdout instead of being dropped

### Dependencies

- **`@logtape/logtape`** `^1.2.0` → `^2.0.0` across all packages
- **`@logtape/file`** `^1.0.0` → `^2.0.0`
- **`@b9g/filesystem`** `0.2.0` - Version bump
- **`@b9g/filesystem-s3`** `0.2.0` - Version bump

### Documentation

- **`@b9g/filesystem` README rewritten** - All class names were fabricated in the previous README. Corrected to match actual exports: `MemoryDirectory`, `NodeFSDirectory`, `S3Directory`, `CustomDirectoryStorage`
- Fixed inaccurate config options in `@b9g/assets` README
- Fixed `PostMessageCache` constructor signature in `@b9g/cache` README
- Fixed import paths in `@b9g/oauth2` README (`@b9g/auth` → `@b9g/oauth2`)

## [0.2.8] - 2026-02-10

### Bug Fixes

- **Config file watching during develop** - `shovel.json` and `package.json` changes are now correctly detected during `shovel develop`. The previous `fs.watch()` approach broke on atomic saves (most editors write to a temp file then rename). Now uses esbuild's native `watchFiles` mechanism which handles this correctly. ([#59](https://github.com/bikeshaving/shovel/issues/59))

### Features

- **Dev server keyboard shortcuts** - `Ctrl+R` (reload), `Ctrl+L` (clear), `Ctrl+C` (quit), `?` (help) shortcuts in the dev server terminal. Only active when stdin is a TTY. ([#60](https://github.com/bikeshaving/shovel/issues/60))

## [0.2.7] - 2026-02-06

### Features

- **Request logger middleware** - New `logger()` middleware in `@b9g/router/middleware` logs requests and responses with timing via LogTape (default category: `["app", "router"]`)
- **CLI flags for create-shovel** - `--template`, `--typescript`/`--no-typescript`, `--platform` flags to bypass interactive prompts. `--template crank` is shorthand for static-site + Crank.js.
- **Logger in generated templates** - All Router-based templates (api, full-stack) now include `router.use(logger())` out of the box

### Dependencies

- **`@b9g/router`** `0.2.2` - Added `@logtape/logtape` as explicit dependency (was previously resolved via workspace only)

## [0.2.6] - 2026-02-06

### Features

- **UI framework selection in create-shovel** - Choose between Vanilla, HTMX, Alpine.js, and Crank.js when scaffolding static-site and full-stack templates ([#44](https://github.com/bikeshaving/shovel/pull/44))
- **Default `["app"]` logger category** - User application logs under `["app", ...]` now work out of the box without configuration. Framework logs under `["shovel", ...]`, third-party libraries remain silent unless opted in.
- **Default exports for cache and filesystem modules** - `@b9g/cache/memory`, `@b9g/cache-redis`, `@b9g/filesystem/node-fs`, `@b9g/filesystem/memory`, and `@b9g/filesystem/bun-s3` now have default exports, so `"export"` can be omitted from `shovel.json` config.

### Bug Fixes

- **Cache API compliance** - Wildcard pattern matching (`"*"`) for cache and directory configs, `PostMessageCache` now accepts `RequestInfo | URL` per spec, `matchPattern()` restored for config lookups ([#43](https://github.com/bikeshaving/shovel/pull/43))
- **Direct cache in single-worker dev mode** - Dev workers now use `MemoryCache` directly instead of `PostMessageCache` when `workers: 1`, avoiding unnecessary serialization overhead
- **Node.js Request body duplex** - Added `duplex: "half"` to Node.js Request construction to fix body streaming
- **Website 404 errors** - Views now throw `NotFound` from `@b9g/http-errors` instead of raw errors, returning proper 404 responses
- **Fixed `@b9g/cache-redis` module path in docs** - Documentation referenced `@b9g/cache/redis` instead of the correct `@b9g/cache-redis`

### Tests

- **PostMessageCache WPT tests** - 29 Web Platform Tests now run against PostMessageCache to verify serialization round-trip compliance
- **Pattern matching unit tests** - Wildcard, prefix, and exact-match priority tests for cache and directory factories
- **End-to-end cache tests** - Runtime tests for KV server, multi-cache independence, and wildcard priority

## [0.2.3] - 2026-02-02

### Features

- **Enable code splitting for client-side bundles** - Dynamic imports in client scripts now create separate chunks instead of being inlined, allowing heavy dependencies to be lazy-loaded. ([#39](https://github.com/bikeshaving/shovel/pull/39), fixes [#38](https://github.com/bikeshaving/shovel/issues/38))

### Bug Fixes

- **Use unique manifest keys for chunks** - Chunk files are now keyed by URL to avoid collisions when the same chunk appears in different assetBase directories.

## [0.2.2] - 2026-01-30

### Bug Fixes

- **Fix asset manifest invalidation in dev mode** - Assets with new content hashes after client bundle changes no longer return 404. The root cause was build-time manifest resolution reading stale data from disk during rebuilds. ([#36](https://github.com/bikeshaving/shovel/pull/36), fixes [#35](https://github.com/bikeshaving/shovel/issues/35))

## [0.2.1] - 2026-01-28

### Improvements

- **Improved create-shovel UX** - Better templates and user experience for project scaffolding

## [0.2.0] - 2026-01-28

This is a major release that establishes Shovel as a complete ServiceWorker-based meta-framework with locked-down APIs for core packages, a unified configuration system, and comprehensive platform support.

### Highlights

- **Consistent Worker Execution Model** - ServiceWorker code always runs in a worker thread
- **ESBuild Configuration Support** - Custom esbuild options in shovel.json
- **Config Expression Syntax** - `$PORT || 3000`, `$DATABASE_URL ?? null`
- **Comprehensive Logging System** - Built-in LogTape integration
- **Database Storage API** - IndexedDB-style migrations with `self.databases`
- **CORS Middleware** - New middleware in `@b9g/router/middleware`
- **Unified Build System** - New `ServerBundler` class, platform-driven entry points

### Breaking Changes

- `self.buckets` renamed to `self.directories`
- `shovel activate` command removed - Use `shovel build --lifecycle` instead
- `loadServiceWorker()` removed - Use `platform.serviceWorker.register()` instead
- `@b9g/router` trailingSlash middleware moved to `@b9g/router/middleware`
- `self.loggers.get()` now takes an array: `self.loggers.get(["app", "db"])`

### CLI

- `shovel develop` - Development server with hot reload
- `shovel build` - Production build with `--lifecycle` flag for lifecycle events
