/**
 * @b9g/shovel-wpt - Web Platform Tests runner for Shovel packages
 *
 * Runs vendored WPT tests against Cache and FileSystem implementations
 * to verify spec compliance.
 */

export * from "./harness/index.js";
export {runCacheTests, type CacheTestConfig} from "./runners/cache.js";
export {
	runFilesystemTests,
	type FilesystemTestConfig,
} from "./runners/filesystem.js";
export {runPlatformTests, type PlatformTestConfig} from "./runners/platform.js";
export {runRuntimeTests, type RuntimeTestConfig} from "./runners/runtime.js";

// WPT shims for running actual vendored WPT test files
export {setupCacheTestGlobals, type CacheShimConfig} from "./wpt/cache-shim.js";
export {
	setupFilesystemTestGlobals,
	type FilesystemShimConfig,
} from "./wpt/filesystem-shim.js";
