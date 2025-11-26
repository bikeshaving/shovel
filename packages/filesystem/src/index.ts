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

/**
 * Permission descriptor for File System Access API
 */
export interface FileSystemPermissionDescriptor {
	mode?: "read" | "readwrite";
}

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
	stat(path: string): Promise<{kind: "file" | "directory"} | null>;

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
	listDir(
		path: string,
	): Promise<Array<{name: string; kind: "file" | "directory"}>>;

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
class ShovelWritableFileStream
	extends WritableStream
	implements FileSystemWritableFileStream
{
	#chunks: Uint8Array[];
	#backend: FileSystemBackend;
	#path: string;

	constructor(backend: FileSystemBackend, path: string) {
		const chunks: Uint8Array[] = [];
		super({
			write: (chunk: Uint8Array | string) => {
				// Convert string to Uint8Array if needed
				const bytes =
					typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
				chunks.push(bytes);
				return Promise.resolve();
			},
			close: async () => {
				// Concatenate all chunks
				const totalLength = chunks.reduce(
					(sum, chunk) => sum + chunk.length,
					0,
				);
				const content = new Uint8Array(totalLength);
				let offset = 0;
				for (const chunk of chunks) {
					content.set(chunk, offset);
					offset += chunk.length;
				}

				// Write to backend
				await backend.writeFile(path, content);
			},
			abort: () => {
				chunks.length = 0;
				return Promise.resolve();
			},
		});
		this.#chunks = chunks;
		this.#backend = backend;
		this.#path = path;
	}

	// File System Access API write method
	async write(data: FileSystemWriteChunkType): Promise<void> {
		const writer = this.getWriter();
		try {
			if (typeof data === "string") {
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
	async seek(_position: number): Promise<void> {
		// Seeking not implemented in this simple version
		throw new DOMException("Seek operation not supported", "NotSupportedError");
	}

	// File System Access API truncate method
	async truncate(_size: number): Promise<void> {
		// Truncating not implemented in this simple version
		throw new DOMException(
			"Truncate operation not supported",
			"NotSupportedError",
		);
	}
}

/**
 * Shared FileSystemHandle base implementation
 * Provides common functionality for both file and directory handles
 */
export abstract class ShovelHandle implements FileSystemHandle {
	abstract readonly kind: "file" | "directory";
	readonly path: string;
	#backend: FileSystemBackend;

	constructor(backend: FileSystemBackend, path: string) {
		this.#backend = backend;
		this.path = path;
	}

	// Use getter so subclasses can override
	get name(): string {
		return this.path.split("/").filter(Boolean).pop() || "root";
	}

	get backend(): FileSystemBackend {
		return this.#backend;
	}

	async isSameEntry(other: FileSystemHandle): Promise<boolean> {
		if (other.kind !== this.kind) return false;
		if (!(other instanceof ShovelHandle)) return false;
		return this.path === other.path;
	}

	async queryPermission(
		descriptor?: FileSystemPermissionDescriptor,
	): Promise<PermissionState> {
		// For our server-side implementations, permissions are always granted
		// In a browser environment, this would check actual permissions
		// In future, this could delegate to backend for access control based on mode

		const _mode = descriptor?.mode || "read";

		// Server-side backends typically have full access
		// In future: could check backend capabilities (e.g., read-only storage)
		return "granted";
	}

	async requestPermission(
		descriptor?: FileSystemPermissionDescriptor,
	): Promise<PermissionState> {
		// For our server-side implementations, permissions are always granted
		// In a browser environment, this would prompt the user if needed
		// In future, this could delegate to backend for access control

		const _mode = descriptor?.mode || "read";

		// Server-side backends don't need user prompts
		// In future: could implement access control logic
		return "granted";
	}

	/**
	 * Validates that a name is actually a name and not a path
	 * The File System Access API only accepts names, not paths
	 */
	validateName(name: string): void {
		if (!name || name.trim() === "") {
			throw new DOMException("Name cannot be empty", "NotAllowedError");
		}

		if (name.includes("/") || name.includes("\\")) {
			throw new DOMException(
				"Name cannot contain path separators",
				"NotAllowedError",
			);
		}

		if (name === "." || name === "..") {
			throw new DOMException("Name cannot be '.' or '..'", "NotAllowedError");
		}

		// Additional platform-specific invalid characters could be checked here
		// Windows: < > : " | ? * and control characters
		// But for simplicity, we'll focus on path traversal prevention
	}
}

/**
 * Shared FileSystemFileHandle implementation that works with any backend
 * Uses non-standard constructor that takes backend + path
 */
export class ShovelFileHandle
	extends ShovelHandle
	implements FileSystemFileHandle
{
	readonly kind: "file";

	constructor(backend: FileSystemBackend, path: string) {
		super(backend, path);
		this.kind = "file";
	}

	async getFile(): Promise<File> {
		try {
			const content = await this.backend.readFile(this.path);
			// Extract filename and infer MIME type
			const filename = this.name;
			const mimeType = this.#getMimeType(filename);

			// Use slice() to ensure we have a copy with ArrayBuffer backing
			// This resolves type conflicts between lib.dom and lib.webworker
			const buffer = content.slice().buffer;

			return new File([buffer], filename, {
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

	#getMimeType(filename: string): string {
		const ext = filename.toLowerCase().substring(filename.lastIndexOf("."));
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
export class ShovelDirectoryHandle
	extends ShovelHandle
	implements FileSystemDirectoryHandle
{
	readonly kind: "directory";

	constructor(backend: FileSystemBackend, path: string) {
		super(backend, path);
		this.kind = "directory";
	}

	async getFileHandle(
		name: string,
		options?: {create?: boolean},
	): Promise<FileSystemFileHandle> {
		this.validateName(name);
		const filePath = this.#joinPath(this.path, name);
		const stat = await this.backend.stat(filePath);

		if (!stat && options?.create) {
			// Create empty file
			await this.backend.writeFile(filePath, new Uint8Array(0));
		} else if (!stat) {
			throw new DOMException("File not found", "NotFoundError");
		} else if (stat.kind !== "file") {
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
		this.validateName(name);
		const dirPath = this.#joinPath(this.path, name);
		const stat = await this.backend.stat(dirPath);

		if (!stat && options?.create) {
			// Create directory if backend supports it
			if (this.backend.createDir) {
				await this.backend.createDir(dirPath);
			}
		} else if (!stat) {
			throw new DOMException("Directory not found", "NotFoundError");
		} else if (stat.kind !== "directory") {
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
		this.validateName(name);

		if (!this.backend.remove) {
			throw new DOMException(
				"Remove operation not supported by this backend",
				"NotSupportedError",
			);
		}

		const entryPath = this.#joinPath(this.path, name);
		const stat = await this.backend.stat(entryPath);

		if (!stat) {
			throw new DOMException("Entry not found", "NotFoundError");
		}

		await this.backend.remove(entryPath, options?.recursive);
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

		// Type narrowed to ShovelHandle after instanceof check
		const shovelHandle = possibleDescendant as ShovelHandle;
		const descendantPath = shovelHandle.path;
		if (!descendantPath.startsWith(this.path)) {
			return null;
		}

		// Return path components relative to this directory
		const relativePath = descendantPath.slice(this.path.length);
		return relativePath.split("/").filter(Boolean);
	}

	async *entries(): AsyncIterableIterator<
		[string, FileSystemFileHandle | FileSystemDirectoryHandle]
	> {
		try {
			const entries = await this.backend.listDir(this.path);

			for (const entry of entries) {
				const entryPath = this.#joinPath(this.path, entry.name);
				if (entry.kind === "file") {
					yield [entry.name, new ShovelFileHandle(this.backend, entryPath)];
				} else {
					yield [
						entry.name,
						new ShovelDirectoryHandle(this.backend, entryPath),
					];
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

	#joinPath(base: string, name: string): string {
		// Simple path joining - could be enhanced based on backend needs
		if (base === "/" || base === "") {
			return `/${name}`;
		}
		return `${base}/${name}`;
	}
}

// ============================================================================
// BUCKET STORAGE
// ============================================================================

/**
 * Bucket storage interface - parallels CacheStorage for filesystem access
 * This could become a future web standard
 */
export interface BucketStorage {
	/**
	 * Open a named bucket - returns FileSystemDirectoryHandle (root of that bucket)
	 * Well-known names: 'static', 'tmp'
	 */
	open(name: string): Promise<FileSystemDirectoryHandle>;

	/**
	 * Check if a named bucket exists
	 */
	has(name: string): Promise<boolean>;

	/**
	 * Delete a named bucket and all its contents
	 */
	delete(name: string): Promise<boolean>;

	/**
	 * List all available bucket names
	 */
	keys(): Promise<string[]>;
}

/**
 * Factory function type for creating buckets
 * @param name Bucket name to create
 * @returns FileSystemDirectoryHandle (Bucket) instance
 */
export type BucketFactory = (
	name: string,
) => FileSystemDirectoryHandle | Promise<FileSystemDirectoryHandle>;

/**
 * Custom bucket storage with factory-based bucket creation
 *
 * Provides a registry of named buckets (FileSystemDirectoryHandle instances)
 * with lazy instantiation and singleton behavior per bucket name.
 *
 * Mirrors the CustomCacheStorage pattern for consistency across the platform.
 */
export class CustomBucketStorage {
	#instances: Map<string, FileSystemDirectoryHandle>;
	#factory: BucketFactory;

	/**
	 * @param factory Function that creates bucket instances by name
	 */
	constructor(factory: BucketFactory) {
		this.#instances = new Map<string, FileSystemDirectoryHandle>();
		this.#factory = factory;
	}

	/**
	 * Open a named bucket - creates if it doesn't exist
	 *
	 * @param name Bucket name (e.g., 'tmp', 'dist', 'uploads')
	 * @returns FileSystemDirectoryHandle for the bucket
	 */
	async open(name: string): Promise<FileSystemDirectoryHandle> {
		// Return existing instance if already opened
		const existing = this.#instances.get(name);
		if (existing) {
			return existing;
		}

		// Create new instance using factory
		const bucket = await this.#factory(name);
		this.#instances.set(name, bucket);
		return bucket;
	}

	/**
	 * Check if a named bucket exists
	 *
	 * @param name Bucket name to check
	 * @returns true if bucket has been opened
	 */
	async has(name: string): Promise<boolean> {
		return this.#instances.has(name);
	}

	/**
	 * Delete a named bucket
	 *
	 * @param name Bucket name to delete
	 * @returns true if bucket was deleted, false if it didn't exist
	 */
	async delete(name: string): Promise<boolean> {
		const instance = this.#instances.get(name);
		if (instance) {
			this.#instances.delete(name);
			return true;
		}
		return false;
	}

	/**
	 * List all opened bucket names
	 *
	 * @returns Array of bucket names
	 */
	async keys(): Promise<string[]> {
		return Array.from(this.#instances.keys());
	}

	/**
	 * Get statistics about opened buckets (non-standard utility method)
	 *
	 * @returns Object with bucket statistics
	 */
	getStats() {
		return {
			openInstances: this.#instances.size,
			bucketNames: Array.from(this.#instances.keys()),
		};
	}
}
