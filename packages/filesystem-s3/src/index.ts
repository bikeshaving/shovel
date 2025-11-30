/**
 * AWS S3 implementation of File System Access API using AWS SDK
 *
 * Implements FileSystemDirectoryHandle and FileSystemFileHandle using AWS S3 SDK
 * to provide S3 cloud storage with File System Access API compatibility.
 */

import type {FileSystemBackend, FileSystemConfig} from "@b9g/filesystem";
import mime from "mime";

/**
 * AWS S3 implementation of FileSystemWritableFileStream
 */
export class S3FileSystemWritableFileStream extends WritableStream<Uint8Array> {
	#chunks: Uint8Array[];
	#s3Client: any;
	#bucket: string;
	#key: string;

	constructor(
		s3Client: any, // S3Client from @aws-sdk/client-s3
		bucket: string,
		key: string,
	) {
		const chunks: Uint8Array[] = [];
		super({
			write: (chunk: Uint8Array) => {
				chunks.push(chunk);
				return Promise.resolve();
			},
			close: async () => {
				// Concatenate all chunks and upload to S3
				const totalLength = chunks.reduce(
					(sum, chunk) => sum + chunk.length,
					0,
				);
				const buffer = new Uint8Array(totalLength);
				let offset = 0;
				for (const chunk of chunks) {
					buffer.set(chunk, offset);
					offset += chunk.length;
				}

				// Use AWS SDK to upload
				const {PutObjectCommand} = await import("@aws-sdk/client-s3");
				const command = new PutObjectCommand({
					Bucket: bucket,
					Key: key,
					Body: buffer,
				});
				await s3Client.send(command);
			},
			abort: async () => {
				// Clear chunks on abort
				chunks.length = 0;
			},
		});
		this.#chunks = chunks;
		this.#s3Client = s3Client;
		this.#bucket = bucket;
		this.#key = key;
	}
}

/**
 * AWS S3 implementation of FileSystemFileHandle
 */
export class S3FileSystemFileHandle implements FileSystemFileHandle {
	readonly kind: "file";
	readonly name: string;
	#s3Client: any;
	#bucket: string;
	#key: string;

	constructor(
		s3Client: any, // S3Client from @aws-sdk/client-s3
		bucket: string,
		key: string,
	) {
		this.kind = "file";
		this.#s3Client = s3Client;
		this.#bucket = bucket;
		this.#key = key;
		this.name = key.split("/").pop() || key;
	}

	async getFile(): Promise<File> {
		try {
			const {GetObjectCommand} = await import("@aws-sdk/client-s3");
			const command = new GetObjectCommand({
				Bucket: this.#bucket,
				Key: this.#key,
			});

			const response = await this.#s3Client.send(command);

			if (!response.Body) {
				throw new DOMException("File not found", "NotFoundError");
			}

			// Convert stream to array buffer
			const chunks: Uint8Array[] = [];
			const reader = response.Body.getReader();

			while (true) {
				const {done, value} = await reader.read();
				if (done) break;
				chunks.push(value);
			}

			const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
			const arrayBuffer = new Uint8Array(totalLength);
			let offset = 0;
			for (const chunk of chunks) {
				arrayBuffer.set(chunk, offset);
				offset += chunk.length;
			}

			return new File([arrayBuffer], this.name, {
				lastModified: response.LastModified?.getTime() || Date.now(),
				type: response.ContentType || this.#getMimeType(this.#key),
			});
		} catch (error: any) {
			if (
				error.name === "NoSuchKey" ||
				error.$metadata?.httpStatusCode === 404
			) {
				throw new DOMException("File not found", "NotFoundError");
			}
			throw error;
		}
	}

	async createWritable(): Promise<FileSystemWritableFileStream> {
		return new S3FileSystemWritableFileStream(
			this.#s3Client,
			this.#bucket,
			this.#key,
		) as any;
	}

	async createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle> {
		throw new DOMException(
			"Synchronous access handles are not supported for S3 storage",
			"InvalidStateError",
		);
	}

	async isSameEntry(other: FileSystemHandle): Promise<boolean> {
		if (other.kind !== "file") return false;
		if (!(other instanceof S3FileSystemFileHandle)) return false;
		return this.#bucket === other.#bucket && this.#key === other.#key;
	}

	async queryPermission(): Promise<PermissionState> {
		// S3 access is controlled by credentials, assume granted if we have access
		return "granted";
	}

	async requestPermission(): Promise<PermissionState> {
		// S3 access is controlled by credentials, assume granted if we have access
		return "granted";
	}

	#getMimeType(key: string): string {
		return mime.getType(key) || "application/octet-stream";
	}
}

/**
 * AWS S3 implementation of FileSystemDirectoryHandle
 */
export class S3FileSystemDirectoryHandle implements FileSystemDirectoryHandle {
	readonly kind: "directory";
	readonly name: string;
	#s3Client: any;
	#bucket: string;
	#prefix: string;

	constructor(
		s3Client: any, // S3Client from @aws-sdk/client-s3
		bucket: string,
		prefix: string,
	) {
		this.kind = "directory";
		this.#s3Client = s3Client;
		this.#bucket = bucket;
		// Remove trailing slash for consistent handling
		this.#prefix = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
		this.name = this.#prefix.split("/").pop() || "root";
	}

	async getFileHandle(
		name: string,
		options?: {create?: boolean},
	): Promise<FileSystemFileHandle> {
		const key = this.#prefix ? `${this.#prefix}/${name}` : name;

		if (options?.create) {
			// Create empty file
			const {PutObjectCommand} = await import("@aws-sdk/client-s3");
			const command = new PutObjectCommand({
				Bucket: this.#bucket,
				Key: key,
				Body: new Uint8Array(0),
			});
			await this.#s3Client.send(command);
		} else {
			// Check if file exists
			try {
				const {HeadObjectCommand} = await import("@aws-sdk/client-s3");
				const command = new HeadObjectCommand({
					Bucket: this.#bucket,
					Key: key,
				});
				await this.#s3Client.send(command);
			} catch (error: any) {
				if (
					error.name === "NoSuchKey" ||
					error.$metadata?.httpStatusCode === 404
				) {
					throw new DOMException("File not found", "NotFoundError");
				}
				throw error;
			}
		}

		return new S3FileSystemFileHandle(this.#s3Client, this.#bucket, key);
	}

	async getDirectoryHandle(
		name: string,
		options?: {create?: boolean},
	): Promise<FileSystemDirectoryHandle> {
		const newPrefix = this.#prefix ? `${this.#prefix}/${name}` : name;

		if (options?.create) {
			// S3 doesn't have directories, but we can create a marker object
			const markerKey = `${newPrefix}/.shovel_directory_marker`;
			const {PutObjectCommand} = await import("@aws-sdk/client-s3");
			const command = new PutObjectCommand({
				Bucket: this.#bucket,
				Key: markerKey,
				Body: new Uint8Array(0),
			});
			await this.#s3Client.send(command);
		}

		return new S3FileSystemDirectoryHandle(
			this.#s3Client,
			this.#bucket,
			newPrefix,
		);
	}

	async removeEntry(
		name: string,
		options?: {recursive?: boolean},
	): Promise<void> {
		const key = this.#prefix ? `${this.#prefix}/${name}` : name;

		if (options?.recursive) {
			// Delete all objects with this prefix
			const dirPrefix = `${key}/`;
			const {ListObjectsV2Command, DeleteObjectCommand} = await import(
				"@aws-sdk/client-s3"
			);

			const listCommand = new ListObjectsV2Command({
				Bucket: this.#bucket,
				Prefix: dirPrefix,
			});

			const response = await this.#s3Client.send(listCommand);

			if (response.Contents && response.Contents.length > 0) {
				const deletePromises = response.Contents.map((object) => {
					if (object.Key) {
						const deleteCommand = new DeleteObjectCommand({
							Bucket: this.#bucket,
							Key: object.Key,
						});
						return this.#s3Client.send(deleteCommand);
					}
				}).filter(Boolean);

				await Promise.all(deletePromises);
			}
		}

		// Delete the object itself (or directory marker)
		try {
			const {DeleteObjectCommand} = await import("@aws-sdk/client-s3");
			const command = new DeleteObjectCommand({
				Bucket: this.#bucket,
				Key: key,
			});
			await this.#s3Client.send(command);
		} catch (error: any) {
			if (
				error.name === "NoSuchKey" ||
				error.$metadata?.httpStatusCode === 404
			) {
				throw new DOMException("Entry not found", "NotFoundError");
			}
			throw error;
		}
	}

	async resolve(
		_possibleDescendant: FileSystemHandle,
	): Promise<string[] | null> {
		// Complex to implement for S3 - return null for now
		return null;
	}

	async *entries(): AsyncIterableIterator<[string, FileSystemHandle]> {
		const listPrefix = this.#prefix ? `${this.#prefix}/` : "";

		try {
			const {ListObjectsV2Command} = await import("@aws-sdk/client-s3");
			const command = new ListObjectsV2Command({
				Bucket: this.#bucket,
				Prefix: listPrefix,
				Delimiter: "/", // Only get immediate children
			});

			const response = await this.#s3Client.send(command);

			// Handle files
			if (response.Contents) {
				for (const object of response.Contents) {
					if (object.Key && object.Key !== listPrefix) {
						const name = object.Key.substring(listPrefix.length);
						// Skip directory markers and items with slashes (subdirectories)
						if (
							!name.includes("/") &&
							!name.endsWith(".shovel_directory_marker")
						) {
							yield [
								name,
								new S3FileSystemFileHandle(
									this.#s3Client,
									this.#bucket,
									object.Key,
								),
							];
						}
					}
				}
			}

			// Handle subdirectories
			if (response.CommonPrefixes) {
				for (const prefix of response.CommonPrefixes) {
					if (prefix.Prefix) {
						const name = prefix.Prefix.substring(listPrefix.length).replace(
							/\/$/,
							"",
						);
						if (name) {
							yield [
								name,
								new S3FileSystemDirectoryHandle(
									this.#s3Client,
									this.#bucket,
									prefix.Prefix.replace(/\/$/, ""),
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
		if (!(other instanceof S3FileSystemDirectoryHandle)) return false;
		return this.#bucket === other.#bucket && this.#prefix === other.#prefix;
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
 * S3 filesystem adapter using AWS SDK
 */
export class S3FileSystemAdapter implements FileSystemBackend {
	#config: FileSystemConfig;
	#s3Client: any;
	#bucket: string;

	constructor(s3Client: any, bucket: string, config: FileSystemConfig = {}) {
		this.#config = {
			name: "s3",
			...config,
		};
		this.#s3Client = s3Client;
		this.#bucket = bucket;
	}

	async getFileSystemRoot(
		name = "default",
	): Promise<FileSystemDirectoryHandle> {
		const prefix = `filesystems/${name}`;
		return new S3FileSystemDirectoryHandle(
			this.#s3Client,
			this.#bucket,
			prefix,
		);
	}

	getConfig(): FileSystemConfig {
		return {...this.#config};
	}

	async dispose(): Promise<void> {
		// AWS SDK v3 clients should be destroyed to clean up connection pools
		if (this.#s3Client && typeof this.#s3Client.destroy === "function") {
			this.#s3Client.destroy();
		}
	}
}
