/**
 * Tests for the filesystem WPT test runner
 *
 * This file runs the WPT-based filesystem tests against MemoryDirectory and NodeFSDirectory
 * to verify the test runner works correctly.
 */

import {runFilesystemTests} from "../src/runners/filesystem.js";
import {MemoryDirectory} from "../../filesystem/src/memory.js";
import {NodeFSDirectory} from "../../filesystem/src/node-fs.js";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

// Run WPT filesystem tests against MemoryDirectory
runFilesystemTests("MemoryDirectory", {
	getDirectory: () => new MemoryDirectory("test-root"),
	cleanup: async () => {
		// MemoryDirectory doesn't need cleanup - each test gets fresh instance
	},
});

// Run WPT filesystem tests against NodeFSDirectory
let nodeDirectoryTestDir: string | null = null;

runFilesystemTests("NodeFSDirectory", {
	getDirectory: async () => {
		// Create a temp directory for each test
		nodeDirectoryTestDir = await fs.mkdtemp(path.join(os.tmpdir(), "wpt-fs-"));
		return new NodeFSDirectory(nodeDirectoryTestDir);
	},
	cleanup: async () => {
		if (nodeDirectoryTestDir) {
			await fs.rm(nodeDirectoryTestDir, {recursive: true, force: true});
			nodeDirectoryTestDir = null;
		}
	},
});
