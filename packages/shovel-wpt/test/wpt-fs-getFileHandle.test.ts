/**
 * WPT FileSystemDirectoryHandle.getFileHandle tests
 *
 * Runs the actual WPT test script against MemoryBucket.
 */

import {describe, test, expect} from "bun:test";
import {setupFilesystemTestGlobals} from "../src/wpt/filesystem-shim.js";
import {
	clearTestQueue,
	runQueuedTests,
	type TestResult,
} from "../src/harness/testharness.js";
import {MemoryBucket} from "../../filesystem/src/memory.js";

// Setup globals at module load time
clearTestQueue();

setupFilesystemTestGlobals({
	getDirectory: () => new MemoryBucket("wpt-test"),
});

describe("WPT: FileSystemDirectoryHandle.getFileHandle (MemoryBucket)", () => {
	test("runs all WPT tests", async () => {
		// Clear any stale tests
		clearTestQueue();

		// Import the WPT test file - this registers tests via directory_test
		await import(
			"../wpt/fs/script-tests/FileSystemDirectoryHandle-getFileHandle.js"
		);

		// Run all queued tests
		const results = await runQueuedTests();

		// Report results
		const passed = results.filter((r) => r.passed);
		const failed = results.filter((r) => !r.passed);

		console.log(`\n  WPT Results: ${passed.length} passed, ${failed.length} failed\n`);

		// Log failures with details
		for (const result of failed) {
			console.log(`  ✗ ${result.name}`);
			if (result.error) {
				console.log(`    ${result.error.message}\n`);
			}
		}

		// Assert all tests passed
		if (failed.length > 0) {
			const failedNames = failed.map((r) => r.name).join("\n  - ");
			throw new Error(
				`${failed.length}/${results.length} WPT tests failed:\n  - ${failedNames}`,
			);
		}

		expect(results.length).toBeGreaterThan(0);
	});
});
