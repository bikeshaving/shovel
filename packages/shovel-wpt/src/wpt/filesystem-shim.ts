/**
 * WPT File System Access API test shim
 *
 * Provides the globals needed to run actual WPT filesystem tests
 * with a custom FileSystemDirectoryHandle implementation.
 */

import {promise_test, type TestContext} from "../harness/testharness.js";
import * as assertions from "../harness/assertions.js";

export interface FilesystemShimConfig {
	/** Factory function to get a clean test directory */
	getDirectory: () =>
		| FileSystemDirectoryHandle
		| Promise<FileSystemDirectoryHandle>;
	/** Optional cleanup function */
	cleanup?: () => void | Promise<void>;
}

/**
 * Cleanup all entries in a directory
 */
async function cleanupDirectory(dir: FileSystemDirectoryHandle): Promise<void> {
	const entries: FileSystemHandle[] = [];
	for await (const entry of dir.values()) {
		entries.push(entry);
	}

	const removePromises = entries.map((entry) =>
		dir
			.removeEntry(entry.name, {recursive: entry.kind === "directory"})
			.catch(() => {
				// Ignore errors - entry may already be deleted
			}),
	);

	await Promise.allSettled(removePromises);
}

/**
 * Setup globals for WPT filesystem tests
 *
 * Call this before loading WPT test files to inject the filesystem implementation.
 */
export function setupFilesystemTestGlobals(config: FilesystemShimConfig): void {
	// WPT constants
	const kCurrentDirectory = ".";
	const kParentDirectory = "..";
	const kPathSeparators = ["/", "\\"];

	// WPT helper: getFileSize
	async function getFileSize(handle: FileSystemFileHandle): Promise<number> {
		const file = await handle.getFile();
		return file.size;
	}

	// WPT helper: getFileContents
	async function getFileContents(
		handle: FileSystemFileHandle,
	): Promise<string> {
		const file = await handle.getFile();
		return new Response(file).text();
	}

	// WPT helper: getDirectoryEntryCount
	async function getDirectoryEntryCount(
		handle: FileSystemDirectoryHandle,
	): Promise<number> {
		let result = 0;
		for await (const _entry of handle) {
			result++;
		}
		return result;
	}

	// WPT helper: getSortedDirectoryEntries
	async function getSortedDirectoryEntries(
		handle: FileSystemDirectoryHandle,
	): Promise<string[]> {
		const result: string[] = [];
		for await (const entry of handle.values()) {
			if (entry.kind === "directory") {
				result.push(entry.name + "/");
			} else {
				result.push(entry.name);
			}
		}
		result.sort();
		return result;
	}

	// WPT helper: createDirectory
	async function createDirectory(
		name: string,
		parent: FileSystemDirectoryHandle,
	): Promise<FileSystemDirectoryHandle> {
		return parent.getDirectoryHandle(name, {create: true});
	}

	// WPT helper: createEmptyFile
	async function createEmptyFile(
		name: string,
		parent: FileSystemDirectoryHandle,
	): Promise<FileSystemFileHandle> {
		const handle = await parent.getFileHandle(name, {create: true});
		assertions.assert_equals(await getFileSize(handle), 0);
		return handle;
	}

	// WPT helper: createFileWithContents
	async function createFileWithContents(
		name: string,
		contents: string,
		parent: FileSystemDirectoryHandle,
	): Promise<FileSystemFileHandle> {
		const handle = await createEmptyFile(name, parent);
		const writer = await handle.createWritable();
		await writer.write(new Blob([contents]));
		await writer.close();
		return handle;
	}

	// WPT helper: directory_test
	function directory_test(
		func: (t: TestContext, dir: FileSystemDirectoryHandle) => Promise<void>,
		description: string,
	): void {
		promise_test(async (t) => {
			const dir = await config.getDirectory();

			// Cleanup before test
			await cleanupDirectory(dir);

			// Cleanup after test
			t.add_cleanup(async () => {
				await cleanupDirectory(dir);
				await config.cleanup?.();
			});

			await func(t, dir);
		}, description);
	}

	// WPT helper: getFileSystemType
	function getFileSystemType(): string {
		return "sandboxed"; // Or could be configurable
	}

	// WPT helper: createFileHandles
	function createFileHandles(
		dir: FileSystemDirectoryHandle,
		...fileNames: string[]
	): Promise<FileSystemFileHandle[]> {
		return Promise.all(
			fileNames.map((fileName) => dir.getFileHandle(fileName, {create: true})),
		);
	}

	// WPT helper: createDirectoryHandles
	function createDirectoryHandles(
		dir: FileSystemDirectoryHandle,
		...dirNames: string[]
	): Promise<FileSystemDirectoryHandle[]> {
		return Promise.all(
			dirNames.map((dirName) =>
				dir.getDirectoryHandle(dirName, {create: true}),
			),
		);
	}

	// Inject globals
	Object.assign(globalThis, {
		// Core harness
		promise_test,
		...assertions,

		// Constants
		kCurrentDirectory,
		kParentDirectory,
		kPathSeparators,

		// Filesystem helpers
		directory_test,
		getFileSize,
		getFileContents,
		getDirectoryEntryCount,
		getSortedDirectoryEntries,
		createDirectory,
		createEmptyFile,
		createFileWithContents,
		getFileSystemType,
		createFileHandles,
		createDirectoryHandles,
		cleanupDirectory,
	});
}
