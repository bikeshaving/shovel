/**
 * @b9g/staticfiles - Universal static files middleware
 * 
 * Runtime middleware and build-time utilities for serving static files
 * across all platforms using File System Access API.
 * 
 * Zero ESBuild dependencies in production builds.
 */

// Runtime middleware (production safe)
export { 
	createStaticFilesMiddleware,
	type StaticFilesConfig,
	default as staticFiles
} from './middleware.js';

// Build-time utilities (import only during build)
export { 
	populateStaticAssets,
	type PopulateOptions
} from './populate.js';

// Re-export for convenience
export { getFileSystemRoot } from '@b9g/platform';