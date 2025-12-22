/**
 * WPT FileSystemDirectoryHandle.getFileHandle tests
 *
 * Runs the actual WPT test script against MemoryDirectory.
 */

import {describe, test, expect} from "bun:test";
import {setupFilesystemTestGlobals} from "../src/wpt/filesystem-shim.js";
import {clearTestQueue, runQueuedTests} from "../src/harness/testharness.js";
import {MemoryDirectory} from "../../filesystem/src/memory.js";

// Setup globals at module load time
clearTestQueue();

setupFilesystemTestGlobals({
	getDirectory: () => new MemoryDirectory("wpt-test"),
});

describe("WPT: FileSystemDirectoryHandle.getFileHandle (MemoryDirectory)", () => {
	test("runs all WPT tests", async () => {
		// Clear any stale tests
		clearTestQueue();

		// Import the WPT test file - this registers tests via directory_test
		await import("../wpt/fs/script-tests/FileSystemDirectoryHandle-getFileHandle.js");

		// Run all queued tests
		const results = await runQueuedTests();

		// Report results
		const passed = results.filter((r) => r.passed);
		const failed = results.filter((r) => !r.passed);

		console.info(
			`\n  WPT Results: ${passed.length} passed, ${failed.length} failed\n`,
		);

		// Log failures with details
		for (const result of failed) {
			console.info(`  ✗ ${result.name}`);
			if (result.error) {
				console.info(`    ${result.error.message}\n`);
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
