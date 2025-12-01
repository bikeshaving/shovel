/**
 * Tests for the filesystem WPT test runner
 *
 * This file runs the WPT-based filesystem tests against MemoryBucket and NodeBucket
 * to verify the test runner works correctly.
 */

import {runFilesystemTests} from "../src/runners/filesystem.js";
import {MemoryBucket} from "../../filesystem/src/memory.js";
import {NodeBucket} from "../../filesystem/src/node.js";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

// Run WPT filesystem tests against MemoryBucket
runFilesystemTests("MemoryBucket", {
	getDirectory: () => new MemoryBucket("test-root"),
	cleanup: async () => {
		// MemoryBucket doesn't need cleanup - each test gets fresh instance
	},
});

// Run WPT filesystem tests against NodeBucket
let nodeBucketTestDir: string | null = null;

runFilesystemTests("NodeBucket", {
	getDirectory: async () => {
		// Create a temp directory for each test
		nodeBucketTestDir = await fs.mkdtemp(path.join(os.tmpdir(), "wpt-fs-"));
		return new NodeBucket(nodeBucketTestDir);
	},
	cleanup: async () => {
		if (nodeBucketTestDir) {
			await fs.rm(nodeBucketTestDir, {recursive: true, force: true});
			nodeBucketTestDir = null;
		}
	},
});
