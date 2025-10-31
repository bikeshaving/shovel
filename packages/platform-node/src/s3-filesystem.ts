/**
 * Node.js implementation of File System Access API using AWS SDK S3
 * 
 * Implements FileSystemDirectoryHandle and FileSystemFileHandle using AWS SDK v3
 * to provide S3-compatible cloud storage with File System Access API compatibility.
 * Works with both AWS S3 and Cloudflare R2.
 */

import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command, HeadObjectCommand } from "@aws-sdk/client-s3";

/**
 * Node.js S3 implementation of FileSystemWritableFileStream
 */
export class NodeS3FileSystemWritableFileStream extends WritableStream<Uint8Array> {
	private chunks: Uint8Array[] = [];

	constructor(private s3Client: S3Client, private bucket: string, private key: string) {
		super({
			write: (chunk: Uint8Array) => {
				this.chunks.push(chunk);
				return Promise.resolve();
			},
			close: async () => {
				// Concatenate all chunks and upload to S3
				const totalLength = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
				const buffer = new Uint8Array(totalLength);
				let offset = 0;
				for (const chunk of this.chunks) {
					buffer.set(chunk, offset);
					offset += chunk.length;
				}

				await this.s3Client.send(new PutObjectCommand({
					Bucket: this.bucket,
					Key: this.key,
					Body: buffer,
				}));
			},
			abort: async () => {
				// Clear chunks on abort
				this.chunks = [];
			}
		});
	}
}

/**
 * Node.js S3 implementation of FileSystemFileHandle
 */
export class NodeS3FileSystemFileHandle implements FileSystemFileHandle {
	readonly kind = "file" as const;
	readonly name: string;

	constructor(private s3Client: S3Client, private bucket: string, private key: string) {
		this.name = key.split('/').pop() || key;
	}

	async getFile(): Promise<File> {
		try {
			// Get object metadata first
			const headResult = await this.s3Client.send(new HeadObjectCommand({
				Bucket: this.bucket,
				Key: this.key,
			}));

			// Get object data
			const getResult = await this.s3Client.send(new GetObjectCommand({
				Bucket: this.bucket,
				Key: this.key,
			}));

			if (!getResult.Body) {
				throw new DOMException('File not found', 'NotFoundError');
			}

			// Convert ReadableStream to ArrayBuffer
			const chunks: Uint8Array[] = [];
			const reader = getResult.Body.transformToWebStream().getReader();
			
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				chunks.push(value);
			}

			const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
			const buffer = new Uint8Array(totalLength);
			let offset = 0;
			for (const chunk of chunks) {
				buffer.set(chunk, offset);
				offset += chunk.length;
			}

			return new File([buffer], this.name, {
				lastModified: headResult.LastModified ? headResult.LastModified.getTime() : Date.now(),
				type: headResult.ContentType || this.getMimeType(this.key),
			});
		} catch (error) {
			if ((error as any).name === 'NoSuchKey' || (error as any).$metadata?.httpStatusCode === 404) {
				throw new DOMException('File not found', 'NotFoundError');
			}
			throw error;
		}
	}

	async createWritable(): Promise<FileSystemWritableFileStream> {
		return new NodeS3FileSystemWritableFileStream(this.s3Client, this.bucket, this.key) as any;
	}

	async createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle> {
		throw new DOMException('Synchronous access handles are not supported for S3 storage', 'InvalidStateError');
	}

	async isSameEntry(other: FileSystemHandle): Promise<boolean> {
		if (other.kind !== 'file') return false;
		if (!(other instanceof NodeS3FileSystemFileHandle)) return false;
		return this.bucket === other.bucket && this.key === other.key;
	}

	async queryPermission(): Promise<PermissionState> {
		// S3 access is controlled by credentials, assume granted if we have access
		return 'granted';
	}

	async requestPermission(): Promise<PermissionState> {
		// S3 access is controlled by credentials, assume granted if we have access
		return 'granted';
	}

	// Deprecated properties for compatibility
	get isFile(): boolean { return true; }
	get isDirectory(): boolean { return false; }

	private getMimeType(key: string): string {
		const ext = key.split('.').pop()?.toLowerCase();
		const mimeTypes: Record<string, string> = {
			'txt': 'text/plain',
			'html': 'text/html',
			'css': 'text/css',
			'js': 'text/javascript',
			'json': 'application/json',
			'png': 'image/png',
			'jpg': 'image/jpeg',
			'jpeg': 'image/jpeg',
			'gif': 'image/gif',
			'svg': 'image/svg+xml',
			'pdf': 'application/pdf',
			'zip': 'application/zip',
		};
		return mimeTypes[ext || ''] || 'application/octet-stream';
	}
}

/**
 * Node.js S3 implementation of FileSystemDirectoryHandle
 */
export class NodeS3FileSystemDirectoryHandle implements FileSystemDirectoryHandle {
	readonly kind = "directory" as const;
	readonly name: string;

	constructor(private s3Client: S3Client, private bucket: string, private prefix: string) {
		// Remove trailing slash for consistent handling
		this.prefix = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
		this.name = this.prefix.split('/').pop() || 'root';
	}

	async getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle> {
		const key = this.prefix ? `${this.prefix}/${name}` : name;
		
		// Check if file exists
		try {
			await this.s3Client.send(new HeadObjectCommand({
				Bucket: this.bucket,
				Key: key,
			}));
		} catch (error) {
			if ((error as any).name === 'NotFound' || (error as any).$metadata?.httpStatusCode === 404) {
				if (options?.create) {
					// Create empty file
					await this.s3Client.send(new PutObjectCommand({
						Bucket: this.bucket,
						Key: key,
						Body: new Uint8Array(0),
					}));
				} else {
					throw new DOMException('File not found', 'NotFoundError');
				}
			} else {
				throw error;
			}
		}

		return new NodeS3FileSystemFileHandle(this.s3Client, this.bucket, key);
	}

	async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle> {
		const newPrefix = this.prefix ? `${this.prefix}/${name}` : name;
		
		if (options?.create) {
			// S3 doesn't have directories, but we can create a marker object
			const markerKey = `${newPrefix}/.shovel_directory_marker`;
			try {
				await this.s3Client.send(new HeadObjectCommand({
					Bucket: this.bucket,
					Key: markerKey,
				}));
			} catch (error) {
				if ((error as any).name === 'NotFound' || (error as any).$metadata?.httpStatusCode === 404) {
					await this.s3Client.send(new PutObjectCommand({
						Bucket: this.bucket,
						Key: markerKey,
						Body: new Uint8Array(0),
					}));
				}
			}
		}

		return new NodeS3FileSystemDirectoryHandle(this.s3Client, this.bucket, newPrefix);
	}

	async removeEntry(name: string, options?: { recursive?: boolean }): Promise<void> {
		const key = this.prefix ? `${this.prefix}/${name}` : name;
		
		// First try to delete as a file
		try {
			await this.s3Client.send(new DeleteObjectCommand({
				Bucket: this.bucket,
				Key: key,
			}));
			return;
		} catch (error) {
			// If file doesn't exist, try directory deletion
		}

		// If not a file, try to delete as directory (with recursive option)
		if (options?.recursive) {
			const dirPrefix = `${key}/`;
			const listResult = await this.s3Client.send(new ListObjectsV2Command({
				Bucket: this.bucket,
				Prefix: dirPrefix,
			}));
			
			if (listResult.Contents && listResult.Contents.length > 0) {
				// Delete all files in the directory
				const deletePromises = listResult.Contents.map((object) => 
					this.s3Client.send(new DeleteObjectCommand({
						Bucket: this.bucket,
						Key: object.Key!,
					}))
				);
				await Promise.all(deletePromises);
			}
			
			// Delete directory marker if it exists
			try {
				await this.s3Client.send(new DeleteObjectCommand({
					Bucket: this.bucket,
					Key: `${key}/.shovel_directory_marker`,
				}));
			} catch (error) {
				// Ignore if marker doesn't exist
			}
		} else {
			throw new DOMException('Directory is not empty', 'InvalidModificationError');
		}
	}

	async resolve(possibleDescendant: FileSystemHandle): Promise<string[] | null> {
		// Complex to implement for S3 - return null for now
		return null;
	}

	async *entries(): AsyncIterableIterator<[string, FileSystemHandle]> {
		const listPrefix = this.prefix ? `${this.prefix}/` : '';
		
		try {
			const result = await this.s3Client.send(new ListObjectsV2Command({
				Bucket: this.bucket,
				Prefix: listPrefix,
				Delimiter: '/', // Only get immediate children
			}));

			// Handle files
			if (result.Contents) {
				for (const item of result.Contents) {
					if (item.Key && item.Key !== listPrefix) {
						const name = item.Key.substring(listPrefix.length);
						// Skip directory markers and items with slashes (subdirectories)
						if (!name.includes('/') && !name.endsWith('.shovel_directory_marker')) {
							yield [name, new NodeS3FileSystemFileHandle(this.s3Client, this.bucket, item.Key)];
						}
					}
				}
			}

			// Handle subdirectories
			if (result.CommonPrefixes) {
				for (const prefix of result.CommonPrefixes) {
					if (prefix.Prefix) {
						const name = prefix.Prefix.substring(listPrefix.length).replace(/\/$/, '');
						if (name) {
							yield [name, new NodeS3FileSystemDirectoryHandle(this.s3Client, this.bucket, prefix.Prefix.replace(/\/$/, ''))];
						}
					}
				}
			}
		} catch (error) {
			// If listing fails, assume directory doesn't exist
			throw new DOMException('Directory not found', 'NotFoundError');
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
		if (other.kind !== 'directory') return false;
		if (!(other instanceof NodeS3FileSystemDirectoryHandle)) return false;
		return this.bucket === other.bucket && this.prefix === other.prefix;
	}

	async queryPermission(): Promise<PermissionState> {
		// S3 access is controlled by credentials, assume granted if we have access
		return 'granted';
	}

	async requestPermission(): Promise<PermissionState> {
		// S3 access is controlled by credentials, assume granted if we have access
		return 'granted';
	}

	// Deprecated properties for compatibility
	get isFile(): boolean { return false; }
	get isDirectory(): boolean { return true; }
}