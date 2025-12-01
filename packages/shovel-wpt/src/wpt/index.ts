/**
 * WPT test shims
 *
 * Provides functions to setup the global environment for running
 * actual WPT test files with custom implementations.
 */

export {setupCacheTestGlobals, type CacheShimConfig} from "./cache-shim.js";
export {
	setupFilesystemTestGlobals,
	type FilesystemShimConfig,
} from "./filesystem-shim.js";
