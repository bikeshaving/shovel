/**
 * WPT testharness.js compatibility layer for bun:test
 *
 * Import from subpaths:
 * - Assertions: import from "@b9g/shovel-wpt/harness/assertions"
 * - Test harness: import from "@b9g/shovel-wpt/harness/testharness"
 */

throw new Error(
	"@b9g/shovel-wpt/harness has no default export. Import from subpaths:\n" +
		'  import {assert_equals, assert_true} from "@b9g/shovel-wpt/harness/assertions"\n' +
		'  import {promise_test, test} from "@b9g/shovel-wpt/harness/testharness"',
);
