/**
 * WPT FileSystemDirectoryHandle.getFileHandle tests
 *
 * Runs the actual WPT test script against MemoryDirectory.
 */

import {describe, test, expect} from "bun:test";
import {setupFilesystemTestGlobals} from "../src/wpt/filesystem-shim.js";
import {clearTestQueue, runQueuedTests} from "../src/harness/testharness.js";
import {MemoryDirectory} from "../../filesystem/src/memory.js";
import {getLogger} from "@logtape/logtape";

const logger = getLogger(["test", "wpt", "fs-getFileHandle"]);

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

		logger.info`WPT Results: ${passed.length} passed, ${failed.length} failed`;

		// Log failures with details
		for (const result of failed) {
			logger.info`✗ ${result.name}`;
			if (result.error) {
				logger.info`  ${result.error.message}`;
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
