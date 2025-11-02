/**
 * @b9g/assets - Universal assets middleware for the self.dirs API
 *
 * Runtime middleware and build-time utilities for serving assets
 * using the new self.dirs.open(name) ServiceWorker API.
 *
 * Zero ESBuild dependencies in production builds.
 */

// Runtime middleware (production safe)
export {
	createAssetsMiddleware,
	type AssetsConfig,
	default as assets,
} from "./middleware.js";

// Build-time plugin (import only during build)
export {
	assetsPlugin,
	type AssetManifest,
	type AssetManifestEntry,
	DEFAULT_CONFIG,
	mergeConfig,
} from "./plugin.js";

// Build-time utilities (import only during build)
export {populateStaticAssets, type PopulateOptions} from "./populate.js";