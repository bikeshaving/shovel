# Changelog

All notable changes to Shovel will be documented in this file.

## [0.2.19] - 2026-03-17

### Bug Fixes

- **Glob asset import clobbers individual import** — When the same file was imported both individually and via a glob pattern with different `assetBase` values, the glob import overwrote the individual import's manifest entry. Both URLs now coexist correctly. (fixes [#81](https://github.com/bikeshaving/shovel/issues/81))

## [0.2.18] - 2026-03-16

### Features

- **Glob asset imports** — Import multiple static files with a single glob pattern:
  `import urls from "./public/**/*" with { assetBase: "/", assetName: "[name].[ext]" }`
  Files flow through the existing asset pipeline (hashing, manifesting, dist/public/).
  Works across all platforms (Node, Bun, Cloudflare). ([#75](https://github.com/bikeshaving/shovel/issues/75), [PR #77](https://github.com/bikeshaving/shovel/pull/77))

### Dependencies

- Added `glob` package for glob pattern expansion in asset imports

## @b9g/platform-bun 0.1.17 - 2026-03-16

### Features

- **BroadcastChannel relay** — Worker code generation now includes BroadcastChannel message relay between supervisor and workers

## @b9g/broadcastchannel-redis 0.1.0 - 2026-03-16

### Features

- **Initial release** — Redis pub/sub backend for Shovel BroadcastChannel, enabling cross-process message broadcasting via Redis

## @b9g/platform-cloudflare 0.1.17 - 2026-03-03

### Bug Fixes

- **`@b9g/platform-cloudflare`** - Fix Miniflare dev server returning 404 for all routes by adding `routerConfig: {has_user_worker: true}` to assets config (#72)

## @b9g/platform-cloudflare 0.1.16, create-shovel 0.1.3 - 2026-03-02

### Features

- **`@b9g/platform-cloudflare`** - Miniflare dev server now configures static assets directory and `ASSETS` binding, matching Cloudflare Workers production behavior (#71)
- **`create-shovel`** - Cloudflare projects now generate a `wrangler.toml` with assets directory config (#71)

## [0.2.17] - 2026-02-26

### Bug Fixes

- **`@b9g/shovel`** - Config expressions (e.g. `"$MODE == production"`) now work in boolean build fields (`build.minify`, `build.treeShaking`, `build.sourcemap`). Schema validation was running before expression evaluation; now expressions are evaluated first (closes #69)

## [0.2.16] - 2026-02-26

### Bug Fixes

- **`@b9g/shovel`** - `build.minify` config in `shovel.json` now propagates to client asset builds. Previously client JS/CSS was always minified regardless of the setting (closes #67)

## @b9g/router 0.2.5 - 2026-02-25

### Bug Fixes

- **`@b9g/router`** - Trailing slash middleware now also redirects when a catch-all route or error-handling middleware returns a 404 Response (not just thrown `NotFound` errors). In 0.2.4 the middleware only caught thrown errors, so catch-all routes returning 404 responses would not trigger the redirect

## @b9g/router 0.2.4 - 2026-02-25

### Bug Fixes

- **`@b9g/router`** - Trailing slash middleware now only redirects as a last resort. Previously it eagerly redirected before route matching, so routes explicitly defined with (or without) a trailing slash would always be redirected. Now the middleware yields to route matching first and only redirects on 404
- **`@b9g/router`** - Added `"append"` as an alias for `"add"` in `trailingSlash()` mode

## [0.2.15] - 2026-02-25

### Bug Fixes

- **`create-shovel`** - Fixed linting in generated JS projects (missing browser globals)
- **`create-shovel`** - Fixed linting in generated Crank projects (now uses `eslint-plugin-crank`)
- **`create-shovel`** - Fixed Crank `Counter` to use `this.refresh()` callback pattern

## [0.2.14] - 2026-02-24

### Features

- **`create-shovel`** - All static-site and full-stack templates now use bundled client entry points through Shovel's asset pipeline instead of CDN links or inline scripts
- **`create-shovel`** - Added type declarations (`env.d.ts`) for htmx and Alpine in TypeScript projects
- **`create-shovel`** - Generated projects include ESLint configuration

### Bug Fixes

- **`@b9g/platform`** - Added `Window.addEventListener` overload for ServiceWorker event types in `globals.d.ts`

## [0.2.13] - 2026-02-24

### Bug Fixes

- **`@b9g/shovel`** - Fixed missing `esbuild-plugins-node-modules-polyfill` dependency causing "Cannot find package" errors at runtime

## [0.2.12] - 2026-02-24

### Bug Fixes

- **`@b9g/shovel`** - Plain `.js` and `.mjs` client assets are now bundled for the browser instead of copied raw. Previously only `.ts`/`.tsx`/`.jsx` were transpiled, so non-TypeScript Crank projects using `@b9g/crank/standalone` in client code failed with "Module name does not resolve to a valid URL" in the browser
- **`@b9g/shovel`** - Removed `.cts` from asset transpilation list (no CJS in client assets)
- **`@b9g/shovel`** - Replaced deprecated `@esbuild-plugins/node-modules-polyfill` and `@esbuild-plugins/node-globals-polyfill` with `esbuild-plugins-node-modules-polyfill`, eliminating deprecation warnings and audit vulnerabilities
- **`@b9g/router`** - Simplified logger middleware to a single response line (`200 GET / (3ms)`) instead of logging both request and response with arrow prefixes

### Improvements

- **`create-shovel`** - Added CSS owl selector (`main > * + *`) for consistent vertical spacing, removed inline margin styles
- **`create-shovel`** - Added interactive counter demo to static-site vanilla template
- **`create-shovel`** - Added API call demo to full-stack vanilla template
- **`create-shovel`** - Crank templates now include client-side hydration with `@b9g/assets`
- **`create-shovel`** - Initial project version is now `0.1.0` instead of `0.0.1`
- **`create-shovel`** - Bumped generated eslint to `^10.0.0` (fixes audit vulnerabilities in generated projects)

### Dependencies

- **`@b9g/crank`** `^0.7.2` → `^0.7.7` (type declarations)

## [0.2.11] - 2026-02-21

### Bug Fixes

- **Broken bin exports in published package** - Upgraded to `@b9g/libuild@0.1.24` which fixes `./dist/bin/` → `./bin/` rewriting in the exports map. `import "@b9g/shovel/bin/create.js"` now resolves correctly when installed from npm

### Dependencies

- **`@b9g/libuild`** `^0.1.22` → `^0.1.24`
- **`create-shovel`** `0.1.1` - README and metadata updates

## [0.2.10] - 2026-02-21

### Features

- **Crank JSX / tagged template choice** - `create-shovel` now prompts "Use JSX?" when Crank is selected. Choose JSX (`.tsx`) or tagged template literals (`.ts`, no build step)
- **Multi-file Crank templates** - Crank projects generate `server.{ext}` + `components.{ext}` with `@b9g/router` for route-based request handling
- **`--framework` and `--jsx` CLI flags** - `create-shovel --framework crank --no-jsx` skips prompts for CI/scripting
- **ESLint config for Crank projects** - Generates `eslint.config.js` with flat config format
- **Bun-aware next steps** - Post-scaffold instructions show `bun install` / `bun run develop` when bun platform is selected
- **Removed redundant `env.d.ts`** - `@b9g/platform` already ships `globals.d.ts`; scaffolded projects now use `"types": ["@b9g/platform/globals"]` in tsconfig instead

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
