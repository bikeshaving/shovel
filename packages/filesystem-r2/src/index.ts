/**
 * Cloudflare R2 implementation of File System Access API
 *
 * Implements FileSystemDirectoryHandle and FileSystemFileHandle using Cloudflare R2 bindings
 * to provide R2 cloud storage with File System Access API compatibility.
 */

import type {FileSystemAdapter, FileSystemConfig} from "@b9g/filesystem";

/**
 * Cloudflare R2 implementation of FileSystemWritableFileStream
 */
export class R2FileSystemWritableFileStream extends WritableStream<Uint8Array> {
	private chunks: Uint8Array[] = [];

	constructor(
		private r2Bucket: R2Bucket,
		private key: string,
	) {
		super({
			write: (chunk: Uint8Array) => {
				this.chunks.push(chunk);
				return Promise.resolve();
			},
			close: async () => {
				// Concatenate all chunks and upload to R2
				const totalLength = this.chunks.reduce(
					(sum, chunk) => sum + chunk.length,
					0,
				);
				const buffer = new Uint8Array(totalLength);
				let offset = 0;
				for (const chunk of this.chunks) {
					buffer.set(chunk, offset);
					offset += chunk.length;
				}

				await this.r2Bucket.put(this.key, buffer);
			},
			abort: async () => {
				// Clear chunks on abort
				this.chunks = [];
			},
		});
	}
}

/**
 * Cloudflare R2 implementation of FileSystemFileHandle
 */
export class R2FileSystemFileHandle implements FileSystemFileHandle {
	readonly kind = "file" as const;
	readonly name: string;

	constructor(
		private r2Bucket: R2Bucket,
		private key: string,
	) {
		this.name = key.split("/").pop() || key;
	}

	async getFile(): Promise<File> {
		const r2Object = await this.r2Bucket.get(this.key);

		if (!r2Object) {
			throw new DOMException("File not found", "NotFoundError");
		}

		// R2Object extends Response, so we can get the body as ArrayBuffer
		const arrayBuffer = await r2Object.arrayBuffer();

		return new File([arrayBuffer], this.name, {
			lastModified: r2Object.uploaded.getTime(),
			type: r2Object.httpMetadata?.contentType || this.getMimeType(this.key),
		});
	}

	async createWritable(): Promise<FileSystemWritableFileStream> {
		return new R2FileSystemWritableFileStream(
			this.r2Bucket,
			this.key,
		) as any;
	}

	async createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle> {
		throw new DOMException(
			"Synchronous access handles are not supported for R2 storage",
			"InvalidStateError",
		);
	}

	async isSameEntry(other: FileSystemHandle): Promise<boolean> {
		if (other.kind !== "file") return false;
		if (!(other instanceof R2FileSystemFileHandle)) return false;
		return this.key === other.key;
	}

	async queryPermission(): Promise<PermissionState> {
		// R2 access is controlled by bindings, assume granted if we have access
		return "granted";
	}

	async requestPermission(): Promise<PermissionState> {
		// R2 access is controlled by bindings, assume granted if we have access
		return "granted";
	}

	// Deprecated properties for compatibility
	get isFile(): boolean {
		return true;
	}
	get isDirectory(): boolean {
		return false;
	}

	private getMimeType(key: string): string {
		const ext = key.split(".").pop()?.toLowerCase();
		const mimeTypes: Record<string, string> = {
			txt: "text/plain",
			html: "text/html",
			css: "text/css",
			js: "text/javascript",
			json: "application/json",
			png: "image/png",
			jpg: "image/jpeg",
			jpeg: "image/jpeg",
			gif: "image/gif",
			svg: "image/svg+xml",
			pdf: "application/pdf",
			zip: "application/zip",
		};
		return mimeTypes[ext || ""] || "application/octet-stream";
	}
}

/**
 * Cloudflare R2 implementation of FileSystemDirectoryHandle
 */
export class R2FileSystemDirectoryHandle
	implements FileSystemDirectoryHandle
{
	readonly kind = "directory" as const;
	readonly name: string;

	constructor(
		private r2Bucket: R2Bucket,
		private prefix: string,
	) {
		// Remove trailing slash for consistent handling
		this.prefix = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
		this.name = this.prefix.split("/").pop() || "root";
	}

	async getFileHandle(
		name: string,
		options?: {create?: boolean},
	): Promise<FileSystemFileHandle> {
		const key = this.prefix ? `${this.prefix}/${name}` : name;

		// Check if file exists
		const exists = await this.r2Bucket.head(key);

		if (!exists && options?.create) {
			// Create empty file
			await this.r2Bucket.put(key, new Uint8Array(0));
		} else if (!exists) {
			throw new DOMException("File not found", "NotFoundError");
		}

		return new R2FileSystemFileHandle(this.r2Bucket, key);
	}

	async getDirectoryHandle(
		name: string,
		options?: {create?: boolean},
	): Promise<FileSystemDirectoryHandle> {
		const newPrefix = this.prefix ? `${this.prefix}/${name}` : name;

		if (options?.create) {
			// R2 doesn't have directories, but we can create a marker object
			const markerKey = `${newPrefix}/.shovel_directory_marker`;
			const exists = await this.r2Bucket.head(markerKey);
			if (!exists) {
				await this.r2Bucket.put(markerKey, new Uint8Array(0));
			}
		}

		return new R2FileSystemDirectoryHandle(this.r2Bucket, newPrefix);
	}

	async removeEntry(
		name: string,
		options?: {recursive?: boolean},
	): Promise<void> {
		const key = this.prefix ? `${this.prefix}/${name}` : name;

		// First try to delete as a file
		const fileExists = await this.r2Bucket.head(key);

		if (fileExists) {
			await this.r2Bucket.delete(key);
			return;
		}

		// If not a file, try to delete as directory (with recursive option)
		if (options?.recursive) {
			const dirPrefix = `${key}/`;
			const listed = await this.r2Bucket.list({prefix: dirPrefix});

			// Delete all files in the directory
			const deletePromises = listed.objects.map((object) =>
				this.r2Bucket.delete(object.key),
			);
			await Promise.all(deletePromises);

			// Delete directory marker if it exists
			const markerKey = `${key}/.shovel_directory_marker`;
			const markerExists = await this.r2Bucket.head(markerKey);
			if (markerExists) {
				await this.r2Bucket.delete(markerKey);
			}
		} else {
			throw new DOMException(
				"Directory is not empty",
				"InvalidModificationError",
			);
		}
	}

	async resolve(
		_possibleDescendant: FileSystemHandle,
	): Promise<string[] | null> {
		// Complex to implement for R2 - return null for now
		return null;
	}

	async *entries(): AsyncIterableIterator<[string, FileSystemHandle]> {
		const listPrefix = this.prefix ? `${this.prefix}/` : "";

		try {
			const result = await this.r2Bucket.list({
				prefix: listPrefix,
				delimiter: "/", // Only get immediate children
			});

			// Handle files
			for (const object of result.objects) {
				if (object.key !== listPrefix) {
					const name = object.key.substring(listPrefix.length);
					// Skip directory markers and items with slashes (subdirectories)
					if (
						!name.includes("/") &&
						!name.endsWith(".shovel_directory_marker")
					) {
						yield [
							name,
							new R2FileSystemFileHandle(this.r2Bucket, object.key),
						];
					}
				}
			}

			// Handle subdirectories
			for (const prefix of result.delimitedPrefixes) {
				const name = prefix.substring(listPrefix.length).replace(/\/$/, "");
				if (name) {
					yield [
						name,
						new R2FileSystemDirectoryHandle(
							this.r2Bucket,
							prefix.replace(/\/$/, ""),
						),
					];
				}
			}
		} catch (error) {
			// If listing fails, assume directory doesn't exist
			throw new DOMException("Directory not found", "NotFoundError");
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
		if (!(other instanceof R2FileSystemDirectoryHandle)) return false;
		return this.prefix === other.prefix;
	}

	async queryPermission(): Promise<PermissionState> {
		// R2 access is controlled by bindings, assume granted if we have access
		return "granted";
	}

	async requestPermission(): Promise<PermissionState> {
		// R2 access is controlled by bindings, assume granted if we have access
		return "granted";
	}

	// Deprecated properties for compatibility
	get isFile(): boolean {
		return false;
	}
	get isDirectory(): boolean {
		return true;
	}
}

/**
 * R2 filesystem adapter
 */
export class R2FileSystemAdapter implements FileSystemAdapter {
	private config: FileSystemConfig;
	private r2Bucket: R2Bucket;

	constructor(r2Bucket: R2Bucket, config: FileSystemConfig = {}) {
		this.config = {
			name: "r2",
			...config,
		};
		this.r2Bucket = r2Bucket;
	}

	async getFileSystemRoot(name = "default"): Promise<FileSystemDirectoryHandle> {
		const prefix = `filesystems/${name}`;
		return new R2FileSystemDirectoryHandle(this.r2Bucket, prefix);
	}

	getConfig(): FileSystemConfig {
		return {...this.config};
	}

	async dispose(): Promise<void> {
		// Nothing to dispose for R2
	}
}