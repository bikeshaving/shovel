/**
 * In-memory filesystem implementation
 *
 * Provides MemoryBucket (root) and MemoryFileSystemBackend for storage operations
 * using in-memory data structures.
 */

import {
	type FileSystemBackend,
	ShovelDirectoryHandle,
	ShovelFileHandle,
} from "./index.js";

/**
 * In-memory file data
 */
interface MemoryFile {
	name: string;
	content: Uint8Array;
	lastModified: number;
	type: string;
}

/**
 * In-memory directory data
 */
interface MemoryDirectory {
	name: string;
	files: Map<string, MemoryFile>;
	directories: Map<string, MemoryDirectory>;
}

/**
 * In-memory storage backend that implements FileSystemBackend
 */
export class MemoryFileSystemBackend implements FileSystemBackend {
	#root: MemoryDirectory;

	constructor(root: MemoryDirectory) {
		this.#root = root;
	}

	async stat(path: string): Promise<{kind: "file" | "directory"} | null> {
		const entry = this.#resolvePath(path);
		if (!entry) return null;

		if ("content" in entry) {
			return {kind: "file"};
		} else {
			return {kind: "directory"};
		}
	}

	async readFile(
		path: string,
	): Promise<{content: Uint8Array; lastModified?: number}> {
		const entry = this.#resolvePath(path);
		if (!entry || !("content" in entry)) {
			throw new DOMException("File not found", "NotFoundError");
		}
		return {
			content: entry.content,
			lastModified: entry.lastModified,
		};
	}

	async writeFile(path: string, data: Uint8Array): Promise<void> {
		const {parentDir, name} = this.#resolveParent(path);
		if (!parentDir) {
			throw new DOMException("Parent directory not found", "NotFoundError");
		}

		const existingFile = parentDir.files.get(name);
		if (existingFile) {
			// Update existing file
			existingFile.content = data;
			existingFile.lastModified = Date.now();
		} else {
			// Create new file
			parentDir.files.set(name, {
				name,
				content: data,
				lastModified: Date.now(),
				type: "application/octet-stream",
			});
		}
	}

	async listDir(
		path: string,
	): Promise<Array<{name: string; kind: "file" | "directory"}>> {
		const entry = this.#resolvePath(path);
		if (!entry || "content" in entry) {
			throw new DOMException("Directory not found", "NotFoundError");
		}

		const results: Array<{name: string; kind: "file" | "directory"}> = [];

		// Add files
		for (const fileName of entry.files.keys()) {
			results.push({name: fileName, kind: "file"});
		}

		// Add directories
		for (const dirName of entry.directories.keys()) {
			results.push({name: dirName, kind: "directory"});
		}

		return results;
	}

	async createDir(path: string): Promise<void> {
		const {parentDir, name} = this.#resolveParent(path);
		if (!parentDir) {
			throw new DOMException("Parent directory not found", "NotFoundError");
		}

		if (!parentDir.directories.has(name)) {
			parentDir.directories.set(name, {
				name,
				files: new Map(),
				directories: new Map(),
			});
		}
	}

	async remove(path: string, recursive?: boolean): Promise<void> {
		const {parentDir, name} = this.#resolveParent(path);
		if (!parentDir) {
			throw new DOMException("Entry not found", "NotFoundError");
		}

		// Try to remove as file
		if (parentDir.files.has(name)) {
			parentDir.files.delete(name);
			return;
		}

		// Try to remove as directory
		const dir = parentDir.directories.get(name);
		if (dir) {
			if ((dir.files.size > 0 || dir.directories.size > 0) && !recursive) {
				throw new DOMException(
					"Directory is not empty",
					"InvalidModificationError",
				);
			}
			parentDir.directories.delete(name);
			return;
		}

		throw new DOMException("Entry not found", "NotFoundError");
	}

	#resolvePath(path: string): MemoryFile | MemoryDirectory | null {
		// Defense in depth: validate path components
		if (path.includes("..") || path.includes("\0")) {
			throw new DOMException(
				"Invalid path: contains path traversal or null bytes",
				"NotAllowedError",
			);
		}

		// Normalize path
		const parts = path.split("/").filter(Boolean);

		if (parts.length === 0) {
			return this.#root;
		}

		// Validate each path component
		for (const part of parts) {
			if (
				part === "." ||
				part === ".." ||
				part.includes("/") ||
				part.includes("\\")
			) {
				throw new DOMException("Invalid path component", "NotAllowedError");
			}
		}

		let current: MemoryDirectory = this.#root;

		// Navigate through directories
		for (let i = 0; i < parts.length - 1; i++) {
			const nextDir = current.directories.get(parts[i]);
			if (!nextDir) return null;
			current = nextDir;
		}

		// Check final part
		const finalName = parts[parts.length - 1];

		// Try as file first
		const file = current.files.get(finalName);
		if (file) return file;

		// Try as directory
		const dir = current.directories.get(finalName);
		if (dir) return dir;

		return null;
	}

	#resolveParent(path: string): {
		parentDir: MemoryDirectory | null;
		name: string;
	} {
		const parts = path.split("/").filter(Boolean);
		const name = parts.pop() || "";

		if (parts.length === 0) {
			return {parentDir: this.#root, name};
		}

		let current: MemoryDirectory = this.#root;

		for (const part of parts) {
			const nextDir = current.directories.get(part);
			if (!nextDir) {
				return {parentDir: null, name};
			}
			current = nextDir;
		}

		return {parentDir: current, name};
	}
}

/**
 * Memory bucket - root entry point for in-memory filesystem
 * Implements FileSystemDirectoryHandle and owns the root data structure
 */
export class MemoryBucket implements FileSystemDirectoryHandle {
	readonly kind: "directory";
	readonly name: string;
	#backend: MemoryFileSystemBackend;

	constructor(name = "root") {
		this.kind = "directory";
		this.name = name;

		// Create root directory structure
		const root: MemoryDirectory = {
			name,
			files: new Map(),
			directories: new Map(),
		};

		this.#backend = new MemoryFileSystemBackend(root);
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

		// For memory bucket, check if the handle uses our backend
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
		return other instanceof MemoryBucket && other.name === this.name;
	}

	async queryPermission(): Promise<PermissionState> {
		return "granted";
	}

	async requestPermission(): Promise<PermissionState> {
		return "granted";
	}
}
