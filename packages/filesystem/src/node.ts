/**
 * Node.js filesystem implementation
 *
 * Provides NodeBucket (root) and NodeFileSystemBackend for storage operations
 * using Node.js fs module.
 */

import {
	type FileSystemBackend,
	ShovelDirectoryHandle,
	ShovelFileHandle,
} from "./index.js";
import * as FS from "fs/promises";
import * as Path from "path";

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
			if ((error as any).code === "ENOENT") {
				return null;
			}
			throw error;
		}
	}

	async readFile(filePath: string): Promise<Uint8Array> {
		try {
			const fullPath = this.#resolvePath(filePath);
			const buffer = await FS.readFile(fullPath);
			return new Uint8Array(buffer);
		} catch (error) {
			if ((error as any).code === "ENOENT") {
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
			if ((error as any).code === "ENOENT") {
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
			if ((error as any).code === "ENOENT") {
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
 * Implements FileSystemDirectoryHandle for local filesystem access
 */
export class NodeBucket implements FileSystemDirectoryHandle {
	readonly kind: "directory";
	readonly name: string;
	#backend: NodeFileSystemBackend;

	constructor(rootPath: string) {
		this.kind = "directory";
		this.#backend = new NodeFileSystemBackend(rootPath);
		this.name = Path.basename(rootPath) || "root";
	}

	async getFileHandle(
		name: string,
		options?: {create?: boolean},
	): Promise<FileSystemFileHandle> {
		const filePath = `/${name}`;
		const stat = await this.#backend.stat(filePath);

		if (!stat && options?.create) {
			await this.#backend.writeFile(filePath, new Uint8Array(0));
		} else if (!stat) {
			throw new DOMException("File not found", "NotFoundError");
		} else if (stat.kind !== "file") {
			throw new DOMException(
				"Path exists but is not a file",
				"TypeMismatchError",
			);
		}

		return new ShovelFileHandle(this.#backend, filePath);
	}

	async getDirectoryHandle(
		name: string,
		options?: {create?: boolean},
	): Promise<FileSystemDirectoryHandle> {
		const dirPath = `/${name}`;
		const stat = await this.#backend.stat(dirPath);

		if (!stat && options?.create) {
			await this.#backend.createDir(dirPath);
		} else if (!stat) {
			throw new DOMException("Directory not found", "NotFoundError");
		} else if (stat.kind !== "directory") {
			throw new DOMException(
				"Path exists but is not a directory",
				"TypeMismatchError",
			);
		}

		return new ShovelDirectoryHandle(this.#backend, dirPath);
	}

	async removeEntry(
		name: string,
		options?: {recursive?: boolean},
	): Promise<void> {
		const entryPath = `/${name}`;
		await this.#backend.remove(entryPath, options?.recursive);
	}

	async resolve(
		possibleDescendant: FileSystemHandle,
	): Promise<string[] | null> {
		if (
			!(
				possibleDescendant instanceof ShovelDirectoryHandle ||
				possibleDescendant instanceof ShovelFileHandle
			)
		) {
			return null;
		}

		// For node bucket, check if the handle uses our backend
		const descendantPath = (possibleDescendant as any).path;
		if (typeof descendantPath === "string" && descendantPath.startsWith("/")) {
			return descendantPath.split("/").filter(Boolean);
		}

		return null;
	}

	async *entries(): AsyncIterableIterator<
		[string, FileSystemFileHandle | FileSystemDirectoryHandle]
	> {
		const entries = await this.#backend.listDir("/");

		for (const entry of entries) {
			const entryPath = `/${entry.name}`;
			if (entry.kind === "file") {
				yield [entry.name, new ShovelFileHandle(this.#backend, entryPath)];
			} else {
				yield [entry.name, new ShovelDirectoryHandle(this.#backend, entryPath)];
			}
		}
	}

	async *keys(): AsyncIterableIterator<string> {
		for await (const [name] of this.entries()) {
			yield name;
		}
	}

	async *values(): AsyncIterableIterator<
		FileSystemFileHandle | FileSystemDirectoryHandle
	> {
		for await (const [, handle] of this.entries()) {
			yield handle;
		}
	}

	[Symbol.asyncIterator](): AsyncIterableIterator<
		[string, FileSystemFileHandle | FileSystemDirectoryHandle]
	> {
		return this.entries();
	}

	async isSameEntry(other: FileSystemHandle): Promise<boolean> {
		if (other.kind !== "directory") return false;
		return other instanceof NodeBucket && other.name === this.name;
	}

	async queryPermission(): Promise<PermissionState> {
		return "granted";
	}

	async requestPermission(): Promise<PermissionState> {
		return "granted";
	}
}
