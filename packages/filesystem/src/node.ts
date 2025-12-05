/**
 * Node.js filesystem implementation
 *
 * Provides NodeBucket (root) and NodeFileSystemBackend for storage operations
 * using Node.js fs module.
 */

import {type FileSystemBackend, ShovelDirectoryHandle} from "./index.js";
import * as FS from "fs/promises";
import * as Path from "path";

/** Type guard for Node.js errors with error codes */
function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}

/**
 * Node.js storage backend that implements FileSystemBackend
 */
export class NodeFileSystemBackend implements FileSystemBackend {
	#rootPath: string;

	constructor(rootPath: string) {
		this.#rootPath = rootPath;
	}

	async stat(filePath: string): Promise<{kind: "file" | "directory"} | null> {
		try {
			const fullPath = this.#resolvePath(filePath);
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
			const fullPath = this.#resolvePath(filePath);
			// Read file content and stats together
			const [buffer, stats] = await Promise.all([
				FS.readFile(fullPath),
				FS.stat(fullPath),
			]);
			return {
				content: new Uint8Array(buffer),
				lastModified: stats.mtimeMs,
			};
		} catch (error) {
			if (isErrnoException(error) && error.code === "ENOENT") {
				throw new DOMException("File not found", "NotFoundError");
			}
			throw error;
		}
	}

	async writeFile(filePath: string, data: Uint8Array): Promise<void> {
		try {
			const fullPath = this.#resolvePath(filePath);
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
			const fullPath = this.#resolvePath(dirPath);
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
			const fullPath = this.#resolvePath(dirPath);
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
			const fullPath = this.#resolvePath(entryPath);
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

	#resolvePath(relativePath: string): string {
		// Remove leading slash for Path.join
		const cleanPath = relativePath.startsWith("/")
			? relativePath.slice(1)
			: relativePath;

		if (!cleanPath) {
			return this.#rootPath;
		}

		// Defense in depth: validate path components
		if (cleanPath.includes("..") || cleanPath.includes("\0")) {
			throw new DOMException(
				"Invalid path: contains path traversal or null bytes",
				"NotAllowedError",
			);
		}

		const resolvedPath = Path.resolve(this.#rootPath, cleanPath);

		// Ensure the resolved path is still within our root directory
		if (!resolvedPath.startsWith(Path.resolve(this.#rootPath))) {
			throw new DOMException(
				"Invalid path: outside of root directory",
				"NotAllowedError",
			);
		}

		return resolvedPath;
	}
}

/**
 * Node bucket - root entry point for Node.js filesystem
 * Extends ShovelDirectoryHandle with "/" as root path
 */
export class NodeBucket extends ShovelDirectoryHandle {
	#rootPath: string;

	constructor(rootPath: string) {
		super(new NodeFileSystemBackend(rootPath), "/");
		this.#rootPath = rootPath;
	}

	// Override name to use the directory basename instead of "/"
	override get name(): string {
		return Path.basename(this.#rootPath) || "root";
	}
}
