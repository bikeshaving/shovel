/**
 * @b9g/staticfiles - Static file handling for Shovel (like Django's staticfiles)
 * 
 * Provides both build-time plugin and runtime handler for seamless static file management
 * in cache-first applications.
 */

// Build-time plugin
export { staticFilesPlugin } from './plugin.js';

// Runtime handler
export { createStaticFilesHandler, createCachedStaticFilesHandler } from './handler.js';

// Shared types and configuration
export type {
  AssetsConfig,
  RuntimeConfig,
  AssetManifest,
  AssetManifestEntry,
} from './shared.js';

export {
  DEFAULT_CONFIG,
  mergeConfig,
  mergeRuntimeConfig,
} from './shared.js';

// TypeScript global declarations
export type {} from './global.js';

// Default exports for convenience
export { staticFilesPlugin as default } from './plugin.js';