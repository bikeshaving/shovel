/**
 * In-memory implementation of File System Access API
 * 
 * Provides a complete filesystem interface using in-memory data structures.
 * Useful for testing, development, and temporary storage scenarios.
 */

import type {FileSystemAdapter, FileSystemConfig} from "./types.js";

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
 * In-memory implementation of FileSystemWritableFileStream
 */
class MemoryFileSystemWritableFileStream extends WritableStream<Uint8Array> {
	private chunks: Uint8Array[] = [];

	constructor(private onClose: (content: Uint8Array) => void) {
		super({
			write: (chunk: Uint8Array) => {
				this.chunks.push(chunk);
				return Promise.resolve();
			},
			close: () => {
				// Concatenate all chunks
				const totalLength = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
				const content = new Uint8Array(totalLength);
				let offset = 0;
				for (const chunk of this.chunks) {
					content.set(chunk, offset);
					offset += chunk.length;
				}
				this.onClose(content);
				return Promise.resolve();
			},
			abort: () => {
				this.chunks = [];
				return Promise.resolve();
			},
		});
	}
}

/**
 * In-memory implementation of FileSystemFileHandle
 */
class MemoryFileSystemFileHandle implements FileSystemFileHandle {
	readonly kind = "file" as const;
	readonly name: string;

	constructor(
		private file: MemoryFile,
		private updateFile: (content: Uint8Array, type?: string) => void,
	) {
		this.name = file.name;
	}

	async getFile(): Promise<File> {
		return new File([this.file.content], this.file.name, {
			lastModified: this.file.lastModified,
			type: this.file.type,
		});
	}

	async createWritable(): Promise<FileSystemWritableFileStream> {
		return new MemoryFileSystemWritableFileStream((content) => {
			this.updateFile(content);
		}) as any;
	}

	async createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle> {
		throw new DOMException(
			"Synchronous access handles are not supported in memory filesystem",
			"InvalidStateError",
		);
	}

	async isSameEntry(other: FileSystemHandle): Promise<boolean> {
		if (other.kind !== "file") return false;
		if (!(other instanceof MemoryFileSystemFileHandle)) return false;
		return this.file === other.file;
	}

	async queryPermission(): Promise<PermissionState> {
		return "granted";
	}

	async requestPermission(): Promise<PermissionState> {
		return "granted";
	}

}

/**
 * In-memory implementation of FileSystemDirectoryHandle
 */
class MemoryFileSystemDirectoryHandle implements FileSystemDirectoryHandle {
	readonly kind = "directory" as const;
	readonly name: string;

	constructor(private directory: MemoryDirectory) {
		this.name = directory.name;
	}

	async getFileHandle(
		name: string,
		options?: {create?: boolean},
	): Promise<FileSystemFileHandle> {
		const file = this.directory.files.get(name);

		if (!file && options?.create) {
			// Create new file
			const newFile: MemoryFile = {
				name,
				content: new Uint8Array(0),
				lastModified: Date.now(),
				type: "application/octet-stream",
			};
			this.directory.files.set(name, newFile);

			return new MemoryFileSystemFileHandle(newFile, (content, type) => {
				newFile.content = content;
				newFile.lastModified = Date.now();
				if (type) newFile.type = type;
			});
		} else if (!file) {
			throw new DOMException("File not found", "NotFoundError");
		}

		return new MemoryFileSystemFileHandle(file, (content, type) => {
			file.content = content;
			file.lastModified = Date.now();
			if (type) file.type = type;
		});
	}

	async getDirectoryHandle(
		name: string,
		options?: {create?: boolean},
	): Promise<FileSystemDirectoryHandle> {
		const dir = this.directory.directories.get(name);

		if (!dir && options?.create) {
			// Create new directory
			const newDir: MemoryDirectory = {
				name,
				files: new Map(),
				directories: new Map(),
			};
			this.directory.directories.set(name, newDir);
			return new MemoryFileSystemDirectoryHandle(newDir);
		} else if (!dir) {
			throw new DOMException("Directory not found", "NotFoundError");
		}

		return new MemoryFileSystemDirectoryHandle(dir);
	}

	async removeEntry(
		name: string,
		options?: {recursive?: boolean},
	): Promise<void> {
		// Try to remove as file first
		if (this.directory.files.has(name)) {
			this.directory.files.delete(name);
			return;
		}

		// Try to remove as directory
		const dir = this.directory.directories.get(name);
		if (dir) {
			if (dir.files.size > 0 || dir.directories.size > 0) {
				if (!options?.recursive) {
					throw new DOMException(
						"Directory is not empty",
						"InvalidModificationError",
					);
				}
			}
			this.directory.directories.delete(name);
			return;
		}

		throw new DOMException("Entry not found", "NotFoundError");
	}

	async resolve(
		possibleDescendant: FileSystemHandle,
	): Promise<string[] | null> {
		// Simple implementation - could be enhanced
		if (possibleDescendant instanceof MemoryFileSystemFileHandle) {
			if (this.directory.files.has(possibleDescendant.name)) {
				return [possibleDescendant.name];
			}
		}
		if (possibleDescendant instanceof MemoryFileSystemDirectoryHandle) {
			if (this.directory.directories.has(possibleDescendant.name)) {
				return [possibleDescendant.name];
			}
		}
		return null;
	}

	async *entries(): AsyncIterableIterator<[string, FileSystemHandle]> {
		// Yield files
		for (const [name, file] of this.directory.files) {
			yield [
				name,
				new MemoryFileSystemFileHandle(file, (content, type) => {
					file.content = content;
					file.lastModified = Date.now();
					if (type) file.type = type;
				}),
			];
		}

		// Yield directories
		for (const [name, dir] of this.directory.directories) {
			yield [name, new MemoryFileSystemDirectoryHandle(dir)];
		}
	}

	async *keys(): AsyncIterableIterator<string> {
		for (const name of this.directory.files.keys()) {
			yield name;
		}
		for (const name of this.directory.directories.keys()) {
			yield name;
		}
	}

	async *values(): AsyncIterableIterator<FileSystemHandle> {
		for (const [, handle] of this.entries()) {
			yield handle;
		}
	}

	async isSameEntry(other: FileSystemHandle): Promise<boolean> {
		if (other.kind !== "directory") return false;
		if (!(other instanceof MemoryFileSystemDirectoryHandle)) return false;
		return this.directory === other.directory;
	}

	async queryPermission(): Promise<PermissionState> {
		return "granted";
	}

	async requestPermission(): Promise<PermissionState> {
		return "granted";
	}

}

/**
 * Memory filesystem adapter
 */
export class MemoryFileSystemAdapter implements FileSystemAdapter {
	private config: FileSystemConfig;
	private filesystems = new Map<string, MemoryDirectory>();

	constructor(config: FileSystemConfig = {}) {
		this.config = {
			name: "memory",
			...config,
		};
	}

	async getFileSystemRoot(name = "default"): Promise<FileSystemDirectoryHandle> {
		if (!this.filesystems.has(name)) {
			// Create new in-memory filesystem
			const root: MemoryDirectory = {
				name: "root",
				files: new Map(),
				directories: new Map(),
			};
			this.filesystems.set(name, root);
		}

		const root = this.filesystems.get(name)!;
		return new MemoryFileSystemDirectoryHandle(root);
	}

	getConfig(): FileSystemConfig {
		return {...this.config};
	}

	async dispose(): Promise<void> {
		this.filesystems.clear();
	}
}