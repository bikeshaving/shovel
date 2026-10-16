/**
 * Tests for the filesystem WPT test runner
 *
 * This file runs the WPT-based filesystem tests against MemoryDirectory and NodeFSDirectory
 * to verify the test runner works correctly.
 */

import * as Fs from "fs/promises";
import * as Os from "os";
import * as Path from "path";

import {MemoryDirectory} from "../../filesystem/src/memory.js";
import {NodeFSDirectory} from "../../filesystem/src/node-fs.js";
import {runFilesystemTests} from "../src/runners/filesystem.js";

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
		nodeDirectoryTestDir = await Fs.mkdtemp(Path.join(Os.tmpdir(), "wpt-fs-"));
		return new NodeFSDirectory(nodeDirectoryTestDir);
	},
	cleanup: async () => {
		if (nodeDirectoryTestDir) {
			await Fs.rm(nodeDirectoryTestDir, {recursive: true, force: true});
			nodeDirectoryTestDir = null;
		}
	},
});
