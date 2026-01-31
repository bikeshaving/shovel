# Changelog

All notable changes to Shovel will be documented in this file.

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
