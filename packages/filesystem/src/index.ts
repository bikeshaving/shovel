// ============================================================================
// CORE TYPES
// ============================================================================

/**
 * Configuration for filesystem adapters
 */
export interface FileSystemConfig {
  /** Human readable name for this filesystem */
  name?: string;
  /** Platform-specific configuration */
  [key: string]: any;
}

/**
 * Bucket is a semantic alias for FileSystemDirectoryHandle
 * Represents a named storage bucket that provides direct filesystem access
 */
export type Bucket = FileSystemDirectoryHandle;

// ============================================================================
// BACKEND INTERFACE
// ============================================================================

/**
 * Storage backend interface that abstracts filesystem operations
 * across different storage types (memory, local disk, S3, R2, etc.)
 */
export interface FileSystemBackend {
	/**
	 * Check if entry exists and return its type
	 * @param path Path to the entry
	 * @returns Entry info if exists, null if not found
	 */
	stat(path: string): Promise<{kind: 'file' | 'directory'} | null>;

	/**
	 * Read file content as bytes
	 * @param path Path to the file
	 * @returns File content as Uint8Array
	 * @throws NotFoundError if file doesn't exist
	 */
	readFile(path: string): Promise<Uint8Array>;

	/**
	 * Write file content
	 * @param path Path to the file
	 * @param data File content as Uint8Array
	 * @throws Error if write fails
	 */
	writeFile(path: string, data: Uint8Array): Promise<void>;

	/**
	 * List directory entries
	 * @param path Path to the directory
	 * @returns Array of entry info (name + type)
	 * @throws NotFoundError if directory doesn't exist
	 */
	listDir(path: string): Promise<Array<{name: string, kind: 'file' | 'directory'}>>;

	/**
	 * Create directory (optional - some backends may not support this)
	 * @param path Path to the directory to create
	 * @throws NotSupportedError if backend doesn't support directory creation
	 */
	createDir?(path: string): Promise<void>;

	/**
	 * Remove entry (optional - some backends may not support this)
	 * @param path Path to the entry to remove
	 * @param recursive Whether to remove directories recursively
	 * @throws NotSupportedError if backend doesn't support removal
	 */
	remove?(path: string, recursive?: boolean): Promise<void>;
}

// ============================================================================
// SHARED HANDLE IMPLEMENTATIONS
// ============================================================================

/**
 * Custom FileSystemWritableFileStream implementation
 * Provides the File System Access API write interface
 */
class ShovelWritableFileStream extends WritableStream implements FileSystemWritableFileStream {
	private chunks: Uint8Array[] = [];
	
	constructor(
		private backend: FileSystemBackend,
		private path: string,
	) {
		super({
			write: (chunk: Uint8Array | string) => {
				// Convert string to Uint8Array if needed
				const bytes = typeof chunk === 'string' 
					? new TextEncoder().encode(chunk)
					: chunk;
				this.chunks.push(bytes);
				return Promise.resolve();
			},
			close: async () => {
				// Concatenate all chunks
				const totalLength = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
				const content = new Uint8Array(totalLength);
				let offset = 0;
				for (const chunk of this.chunks) {
					content.set(chunk, offset);
					offset += chunk.length;
				}
				
				// Write to backend
				await this.backend.writeFile(this.path, content);
			},
			abort: () => {
				this.chunks.length = 0;
				return Promise.resolve();
			},
		});
	}

	// File System Access API write method
	async write(data: FileSystemWriteChunkType): Promise<void> {
		const writer = this.getWriter();
		try {
			if (typeof data === 'string') {
				await writer.write(new TextEncoder().encode(data));
			} else if (data instanceof Uint8Array || data instanceof ArrayBuffer) {
				const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
				await writer.write(bytes);
			} else {
				// Handle other data types as needed
				await writer.write(new TextEncoder().encode(String(data)));
			}
		} finally {
			writer.releaseLock();
		}
	}

	// File System Access API seek method
	async seek(position: number): Promise<void> {
		// Seeking not implemented in this simple version
		throw new DOMException("Seek operation not supported", "NotSupportedError");
	}

	// File System Access API truncate method
	async truncate(size: number): Promise<void> {
		// Truncating not implemented in this simple version
		throw new DOMException("Truncate operation not supported", "NotSupportedError");
	}
}

/**
 * Shared FileSystemFileHandle implementation that works with any backend
 * Uses non-standard constructor that takes backend + path
 */
export class ShovelFileHandle implements FileSystemFileHandle {
	readonly kind = "file" as const;
	readonly name: string;

	constructor(
		private backend: FileSystemBackend,
		private path: string,
	) {
		// Extract filename from path
		this.name = path.split('/').pop() || path;
	}

	async getFile(): Promise<File> {
		try {
			const content = await this.backend.readFile(this.path);
			// Extract filename and infer MIME type
			const filename = this.name;
			const mimeType = this.getMimeType(filename);
			
			return new File([content], filename, {
				type: mimeType,
				lastModified: Date.now(), // TODO: Could be stored in backend if needed
			});
		} catch (error) {
			throw new DOMException(`File not found: ${this.path}`, "NotFoundError");
		}
	}

	async createWritable(): Promise<FileSystemWritableFileStream> {
		return new ShovelWritableFileStream(this.backend, this.path);
	}

	async createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle> {
		throw new DOMException(
			"Synchronous access handles are not supported",
			"InvalidStateError",
		);
	}

	async isSameEntry(other: FileSystemHandle): Promise<boolean> {
		if (other.kind !== "file") return false;
		if (!(other instanceof ShovelFileHandle)) return false;
		return this.path === other.path;
	}

	async queryPermission(): Promise<PermissionState> {
		return "granted";
	}

	async requestPermission(): Promise<PermissionState> {
		return "granted";
	}

	private getMimeType(filename: string): string {
		const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
		const mimeTypes: Record<string, string> = {
			".html": "text/html",
			".css": "text/css", 
			".js": "application/javascript",
			".json": "application/json",
			".png": "image/png",
			".jpg": "image/jpeg",
			".jpeg": "image/jpeg",
			".gif": "image/gif",
			".svg": "image/svg+xml",
			".pdf": "application/pdf",
			".zip": "application/zip",
		};
		return mimeTypes[ext] || "application/octet-stream";
	}
}

/**
 * Shared FileSystemDirectoryHandle implementation that works with any backend
 * Uses non-standard constructor that takes backend + path
 */
export class ShovelDirectoryHandle implements FileSystemDirectoryHandle {
	readonly kind = "directory" as const;
	readonly name: string;

	constructor(
		private backend: FileSystemBackend,
		private path: string,
	) {
		// Extract directory name from path
		this.name = path.split('/').filter(Boolean).pop() || 'root';
	}

	async getFileHandle(
		name: string,
		options?: {create?: boolean},
	): Promise<FileSystemFileHandle> {
		const filePath = this.joinPath(this.path, name);
		const stat = await this.backend.stat(filePath);

		if (!stat && options?.create) {
			// Create empty file
			await this.backend.writeFile(filePath, new Uint8Array(0));
		} else if (!stat) {
			throw new DOMException("File not found", "NotFoundError");
		} else if (stat.kind !== 'file') {
			throw new DOMException(
				"Path exists but is not a file",
				"TypeMismatchError",
			);
		}

		return new ShovelFileHandle(this.backend, filePath);
	}

	async getDirectoryHandle(
		name: string,
		options?: {create?: boolean},
	): Promise<FileSystemDirectoryHandle> {
		const dirPath = this.joinPath(this.path, name);
		const stat = await this.backend.stat(dirPath);

		if (!stat && options?.create) {
			// Create directory if backend supports it
			if (this.backend.createDir) {
				await this.backend.createDir(dirPath);
			}
		} else if (!stat) {
			throw new DOMException("Directory not found", "NotFoundError");
		} else if (stat.kind !== 'directory') {
			throw new DOMException(
				"Path exists but is not a directory",
				"TypeMismatchError",
			);
		}

		return new ShovelDirectoryHandle(this.backend, dirPath);
	}

	async removeEntry(
		name: string,
		options?: {recursive?: boolean},
	): Promise<void> {
		if (!this.backend.remove) {
			throw new DOMException(
				"Remove operation not supported by this backend",
				"NotSupportedError",
			);
		}

		const entryPath = this.joinPath(this.path, name);
		const stat = await this.backend.stat(entryPath);

		if (!stat) {
			throw new DOMException("Entry not found", "NotFoundError");
		}

		await this.backend.remove(entryPath, options?.recursive);
	}

	async resolve(
		possibleDescendant: FileSystemHandle,
	): Promise<string[] | null> {
		if (!(possibleDescendant instanceof ShovelDirectoryHandle || possibleDescendant instanceof ShovelFileHandle)) {
			return null;
		}

		const descendantPath = possibleDescendant.path;
		if (!descendantPath.startsWith(this.path)) {
			return null;
		}

		// Return path components relative to this directory
		const relativePath = descendantPath.slice(this.path.length);
		return relativePath.split('/').filter(Boolean);
	}

	async *entries(): AsyncIterableIterator<[string, FileSystemHandle]> {
		try {
			const entries = await this.backend.listDir(this.path);
			
			for (const entry of entries) {
				const entryPath = this.joinPath(this.path, entry.name);
				if (entry.kind === 'file') {
					yield [entry.name, new ShovelFileHandle(this.backend, entryPath)];
				} else {
					yield [entry.name, new ShovelDirectoryHandle(this.backend, entryPath)];
				}
			}
		} catch (error) {
			// If directory doesn't exist or can't be read, yield nothing
			return;
		}
	}

	async *keys(): AsyncIterableIterator<string> {
		for await (const [name] of this.entries()) {
			yield name;
		}
	}

	async *values(): AsyncIterableIterator<FileSystemHandle> {
		for await (const [, handle] of this.entries()) {
			yield handle;
		}
	}

	async isSameEntry(other: FileSystemHandle): Promise<boolean> {
		if (other.kind !== "directory") return false;
		if (!(other instanceof ShovelDirectoryHandle)) return false;
		return this.path === other.path;
	}

	async queryPermission(): Promise<PermissionState> {
		return "granted";
	}

	async requestPermission(): Promise<PermissionState> {
		return "granted";
	}

	private joinPath(base: string, name: string): string {
		// Simple path joining - could be enhanced based on backend needs
		if (base === '/' || base === '') {
			return `/${name}`;
		}
		return `${base}/${name}`;
	}
}

// ============================================================================
// ADAPTER EXPORTS  
// ============================================================================

// Bucket + backend exports
export {MemoryBucket, MemoryFileSystemBackend} from "./memory.js";
export {NodeBucket, NodeFileSystemBackend} from "./node.js";
export {S3Bucket, S3FileSystemBackend} from "./bun-s3.js";

// Registry and utilities
export {FileSystemRegistry, getDirectoryHandle, getBucket, getFileSystemRoot} from "./registry.js";