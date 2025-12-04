/**
 * WPT test shims
 *
 * Import from subpaths:
 * - Cache shim: import from "@b9g/shovel-wpt/wpt/cache-shim"
 * - Filesystem shim: import from "@b9g/shovel-wpt/wpt/filesystem-shim"
 */

throw new Error(
	"@b9g/shovel-wpt/wpt has no default export. Import from subpaths:\n" +
		'  import {setupCacheTestGlobals} from "@b9g/shovel-wpt/wpt/cache-shim"\n' +
		'  import {setupFilesystemTestGlobals} from "@b9g/shovel-wpt/wpt/filesystem-shim"',
);
