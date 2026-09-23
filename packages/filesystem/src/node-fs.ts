/**
 * Node.js filesystem implementation using node:fs
 *
 * Provides NodeFSDirectory (root) and NodeFSBackend for storage operations
 * using Node.js fs module. Works in both Node.js and Bun.
 */

import * as FS from "fs/promises";
import * as Path from "path";

import {type FileSystemBackend, ShovelDirectoryHandle} from "./index.js";

/** Type guard for Node.js errors with error codes */
function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}

const kRootPath = Symbol("rootPath");

export interface NodeFSBackend {
	[kRootPath]: string;
}

/**
 * Node.js storage backend using node:fs
 */
export class NodeFSBackend implements FileSystemBackend {
	constructor(rootPath: string) {
		this[kRootPath] = rootPath;
	}

	async stat(filePath: string): Promise<{kind: "file" | "directory"} | null> {
		try {
			const fullPath = resolvePath(this, filePath);
			const stats = await FS.stat(fullPath);

			if (stats.isFile()) {
				return {kind: "file"};
			} else if (stats.isDirectory()) {
				return {kind: "directory"};
			} else {
				return null;
			}
		} catch (error) {
			if (isErrnoException(error) && error.code === "ENOENT") {
				return null;
			}
			throw error;
		}
	}

	async readFile(
		filePath: string,
	): Promise<{content: Uint8Array; lastModified?: number}> {
		try {
			const fullPath = resolvePath(this, filePath);
			// Read file content and stats together
			const [buffer, stats] = await Promise.all([
				FS.readFile(fullPath),
				FS.stat(fullPath),
			]);
			return {content: new Uint8Array(buffer), lastModified: stats.mtimeMs};
		} catch (error) {
			if (isErrnoException(error) && error.code === "ENOENT") {
				throw new DOMException("File not found", "NotFoundError");
			}
			throw error;
		}
	}

	async writeFile(filePath: string, data: Uint8Array): Promise<void> {
		try {
			const fullPath = resolvePath(this, filePath);
			// Ensure parent directory exists
			await FS.mkdir(Path.dirname(fullPath), {recursive: true});
			await FS.writeFile(fullPath, data);
		} catch (error) {
			throw new DOMException(
				`Failed to write file: ${error}`,
				"InvalidModificationError",
			);
		}
	}

	async listDir(
		dirPath: string,
	): Promise<Array<{name: string; kind: "file" | "directory"}>> {
		try {
			const fullPath = resolvePath(this, dirPath);
			const entries = await FS.readdir(fullPath, {withFileTypes: true});

			const results: Array<{name: string; kind: "file" | "directory"}> = [];

			for (const entry of entries) {
				if (entry.isFile()) {
					results.push({name: entry.name, kind: "file"});
				} else if (entry.isDirectory()) {
					results.push({name: entry.name, kind: "directory"});
				}
			}

			return results;
		} catch (error) {
			if (isErrnoException(error) && error.code === "ENOENT") {
				throw new DOMException("Directory not found", "NotFoundError");
			}
			throw error;
		}
	}

	async createDir(dirPath: string): Promise<void> {
		try {
			const fullPath = resolvePath(this, dirPath);
			await FS.mkdir(fullPath, {recursive: true});
		} catch (error) {
			throw new DOMException(
				`Failed to create directory: ${error}`,
				"InvalidModificationError",
			);
		}
	}

	async remove(entryPath: string, recursive?: boolean): Promise<void> {
		try {
			const fullPath = resolvePath(this, entryPath);
			const stats = await FS.stat(fullPath);

			if (stats.isFile()) {
				await FS.unlink(fullPath);
			} else if (stats.isDirectory()) {
				if (recursive) {
					await FS.rm(fullPath, {recursive: true, force: true});
				} else {
					// Check if directory is empty
					const entries = await FS.readdir(fullPath);
					if (entries.length > 0) {
						throw new DOMException(
							"Directory is not empty",
							"InvalidModificationError",
						);
					}
					await FS.rmdir(fullPath);
				}
			}
		} catch (error) {
			if (isErrnoException(error) && error.code === "ENOENT") {
				throw new DOMException("Entry not found", "NotFoundError");
			}
			throw error;
		}
	}
}

function resolvePath(backend: NodeFSBackend, relativePath: string): string {
	// Remove leading slash for Path.join
	const cleanPath = relativePath.startsWith("/")
		? relativePath.slice(1)
		: relativePath;

	if (!cleanPath) {
		return backend[kRootPath];
	}

	// Defense in depth: validate path components
	if (cleanPath.includes("..") || cleanPath.includes("\0")) {
		throw new DOMException(
			"Invalid path: contains path traversal or null bytes",
			"NotAllowedError",
		);
	}

	const resolvedPath = Path.resolve(backend[kRootPath], cleanPath);

	// Ensure the resolved path is still within our root directory
	if (!resolvedPath.startsWith(Path.resolve(backend[kRootPath]))) {
		throw new DOMException(
			"Invalid path: outside of root directory",
			"NotAllowedError",
		);
	}

	return resolvedPath;
}

const kDirectoryRootPath = Symbol("rootPath");

export interface NodeFSDirectory {
	[kDirectoryRootPath]: string;
}

/**
 * Node.js directory using node:fs - root entry point for local filesystem
 * Extends ShovelDirectoryHandle with "/" as root path
 */
export class NodeFSDirectory extends ShovelDirectoryHandle {
	/**
	 * Create a NodeFSDirectory
	 * @param name - Directory name (used for display)
	 * @param options - Options object containing the filesystem path
	 * @param options.path - The actual filesystem path to use as root
	 */
	constructor(name: string, options?: {path?: string}) {
		// Use options.path if provided, otherwise fall back to name as the path
		const rootPath = options?.path ?? name;
		super(new NodeFSBackend(rootPath), "/");
		this[kDirectoryRootPath] = rootPath;
	}

	// Override name to use the directory basename instead of "/"
	override get name(): string {
		return Path.basename(this[kDirectoryRootPath]) || "root";
	}
}

export default NodeFSDirectory;
