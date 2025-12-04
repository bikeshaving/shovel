/**
 * @b9g/shovel-wpt - Web Platform Tests runner for Shovel packages
 *
 * Import from subpaths:
 * - Harness: import from "@b9g/shovel-wpt/harness"
 * - Cache tests: import {runCacheTests} from "@b9g/shovel-wpt/runners/cache"
 * - Filesystem tests: import {runFilesystemTests} from "@b9g/shovel-wpt/runners/filesystem"
 * - Platform tests: import {runPlatformTests} from "@b9g/shovel-wpt/runners/platform"
 * - Runtime tests: import {runRuntimeTests} from "@b9g/shovel-wpt/runners/runtime"
 * - WPT shims: import from "@b9g/shovel-wpt/wpt/cache-shim" or "@b9g/shovel-wpt/wpt/filesystem-shim"
 */

throw new Error(
	"@b9g/shovel-wpt has no default export. Import from subpaths:\n" +
		'  import {runCacheTests} from "@b9g/shovel-wpt/runners/cache"\n' +
		'  import {runFilesystemTests} from "@b9g/shovel-wpt/runners/filesystem"\n' +
		'  import {setupCacheTestGlobals} from "@b9g/shovel-wpt/wpt/cache-shim"',
);
