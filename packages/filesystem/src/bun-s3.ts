/**
 * Bun S3 implementation of File System Access API using built-in S3 support
 *
 * Leverages Bun's native S3Client and S3File for high-performance
 * cloud storage operations with File System Access API compatibility.
 */

import type {FileSystemAdapter, FileSystemConfig} from "@b9g/filesystem";

/**
 * Bun S3 implementation of FileSystemWritableFileStream
 */
export class BunS3FileSystemWritableFileStream extends WritableStream<Uint8Array> {
	private writer: any;

	constructor(private s3file: any) {
		super({
			start: async () => {
				this.writer = this.s3file.writer();
			},
			write: async (chunk: Uint8Array) => {
				await this.writer.write(chunk);
			},
			close: async () => {
				await this.writer.end();
			},
			abort: async () => {
				// S3 multipart uploads can be aborted
				await this.writer.abort?.();
			},
		});
	}
}

/**
 * Bun S3 implementation of FileSystemFileHandle
 */
export class BunS3FileSystemFileHandle implements FileSystemFileHandle {
	readonly kind = "file" as const;
	readonly name: string;

	constructor(
		private s3Client: any, // Bun S3Client
		private key: string,
	) {
		this.name = key.split("/").pop() || key;
	}

	async getFile(): Promise<File> {
		const s3file = this.s3Client.file(this.key);

		try {
			// Check if file exists
			const exists = await s3file.exists();
			if (!exists) {
				throw new DOMException("File not found", "NotFoundError");
			}

			// Get file stats for metadata
			const stats = await s3file.stat();

			// S3File extends Blob, so we can convert it to File
			const blob = s3file as Blob;
			return new File([blob], this.name, {
				lastModified: stats?.lastModified
					? new Date(stats.lastModified).getTime()
					: Date.now(),
				type: stats?.contentType || this.getMimeType(this.key),
			});
		} catch (error) {
			if (
				(error as any).message?.includes("NoSuchKey") ||
				(error as any).message?.includes("Not Found")
			) {
				throw new DOMException("File not found", "NotFoundError");
			}
			throw error;
		}
	}

	async createWritable(): Promise<FileSystemWritableFileStream> {
		const s3file = this.s3Client.file(this.key);
		return new BunS3FileSystemWritableFileStream(s3file) as any;
	}

	async createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle> {
		throw new DOMException(
			"Synchronous access handles are not supported for S3 storage",
			"InvalidStateError",
		);
	}

	async isSameEntry(other: FileSystemHandle): Promise<boolean> {
		if (other.kind !== "file") return false;
		if (!(other instanceof BunS3FileSystemFileHandle)) return false;
		return this.key === other.key;
	}

	async queryPermission(): Promise<PermissionState> {
		// S3 access is controlled by credentials, assume granted if we have access
		return "granted";
	}

	async requestPermission(): Promise<PermissionState> {
		// S3 access is controlled by credentials, assume granted if we have access
		return "granted";
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
 * Bun S3 implementation of FileSystemDirectoryHandle
 */
export class BunS3FileSystemDirectoryHandle implements FileSystemDirectoryHandle {
	readonly kind = "directory" as const;
	readonly name: string;

	constructor(
		private s3Client: any, // Bun S3Client
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
		const s3file = this.s3Client.file(key);

		const exists = await s3file.exists();

		if (!exists && options?.create) {
			// Create empty file
			await s3file.write("");
		} else if (!exists) {
			throw new DOMException("File not found", "NotFoundError");
		}

		return new BunS3FileSystemFileHandle(this.s3Client, key);
	}

	async getDirectoryHandle(
		name: string,
		options?: {create?: boolean},
	): Promise<FileSystemDirectoryHandle> {
		const newPrefix = this.prefix ? `${this.prefix}/${name}` : name;

		if (options?.create) {
			// S3 doesn't have directories, but we can create a marker object
			const markerKey = `${newPrefix}/.shovel_directory_marker`;
			const markerFile = this.s3Client.file(markerKey);
			const exists = await markerFile.exists();
			if (!exists) {
				await markerFile.write("");
			}
		}

		return new BunS3FileSystemDirectoryHandle(this.s3Client, newPrefix);
	}

	async removeEntry(
		name: string,
		options?: {recursive?: boolean},
	): Promise<void> {
		const key = this.prefix ? `${this.prefix}/${name}` : name;

		// First try to delete as a file
		const s3file = this.s3Client.file(key);
		const fileExists = await s3file.exists();

		if (fileExists) {
			await s3file.delete();
			return;
		}

		// If not a file, try to delete as directory (with recursive option)
		if (options?.recursive) {
			const dirPrefix = `${key}/`;
			const files = await this.s3Client.list({prefix: dirPrefix});

			// Delete all files in the directory
			const deletePromises = files.map((file: any) =>
				this.s3Client.file(file.Key || file.key).delete(),
			);
			await Promise.all(deletePromises);

			// Delete directory marker if it exists
			const markerFile = this.s3Client.file(`${key}/.shovel_directory_marker`);
			const markerExists = await markerFile.exists();
			if (markerExists) {
				await markerFile.delete();
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
		// Complex to implement for S3 - return null for now
		return null;
	}

	async *entries(): AsyncIterableIterator<[string, FileSystemHandle]> {
		const listPrefix = this.prefix ? `${this.prefix}/` : "";

		try {
			const result = await this.s3Client.list({
				prefix: listPrefix,
				delimiter: "/", // Only get immediate children
			});

			// Handle files
			if (result.Contents) {
				for (const item of result.Contents) {
					const key = item.Key || item.key;
					if (key && key !== listPrefix) {
						const name = key.substring(listPrefix.length);
						// Skip directory markers and items with slashes (subdirectories)
						if (
							!name.includes("/") &&
							!name.endsWith(".shovel_directory_marker")
						) {
							yield [name, new BunS3FileSystemFileHandle(this.s3Client, key)];
						}
					}
				}
			}

			// Handle subdirectories
			if (result.CommonPrefixes) {
				for (const prefix of result.CommonPrefixes) {
					const prefixKey = prefix.Prefix || prefix.prefix;
					if (prefixKey) {
						const name = prefixKey
							.substring(listPrefix.length)
							.replace(/\/$/, "");
						if (name) {
							yield [
								name,
								new BunS3FileSystemDirectoryHandle(
									this.s3Client,
									prefixKey.replace(/\/$/, ""),
								),
							];
						}
					}
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
		if (!(other instanceof BunS3FileSystemDirectoryHandle)) return false;
		return this.prefix === other.prefix;
	}

	async queryPermission(): Promise<PermissionState> {
		// S3 access is controlled by credentials, assume granted if we have access
		return "granted";
	}

	async requestPermission(): Promise<PermissionState> {
		// S3 access is controlled by credentials, assume granted if we have access
		return "granted";
	}

}

/**
 * Bun S3 filesystem adapter using Bun's native S3Client
 */
export class BunS3FileSystemAdapter implements FileSystemAdapter {
	private config: FileSystemConfig;
	private s3Client: any;

	constructor(s3Client: any, config: FileSystemConfig = {}) {
		this.config = {
			name: "bun-s3",
			...config,
		};
		this.s3Client = s3Client;
	}

	async getFileSystemRoot(name = "default"): Promise<FileSystemDirectoryHandle> {
		const prefix = `filesystems/${name}`;
		return new BunS3FileSystemDirectoryHandle(this.s3Client, prefix);
	}

	getConfig(): FileSystemConfig {
		return {...this.config};
	}

	async dispose(): Promise<void> {
		// Nothing to dispose for Bun S3
	}
}