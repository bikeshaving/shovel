/**
 * Bun S3 filesystem implementation
 *
 * Provides S3Bucket (root) and S3FileSystemBackend for storage operations
 * using Bun's native S3 client.
 */

import {
	FileSystemBackend,
	ShovelDirectoryHandle,
	ShovelFileHandle,
} from "./index.js";

/**
 * S3 storage backend that implements FileSystemBackend using Bun's S3 client
 */
export class S3FileSystemBackend implements FileSystemBackend {
	constructor(
		private s3Client: any,
		private bucketName: string,
		private prefix: string = "",
	) {}

	async stat(path: string): Promise<{kind: "file" | "directory"} | null> {
		try {
			const key = this.getS3Key(path);

			// Try as file first
			try {
				await this.s3Client.head({key});
				return {kind: "file"};
			} catch (error) {
				// If head fails, try as directory (check for objects with this prefix)
				const dirPrefix = key.endsWith("/") ? key : `${key}/`;
				const result = await this.s3Client.list({
					prefix: dirPrefix,
					maxKeys: 1,
				});

				if (result.Contents && result.Contents.length > 0) {
					return {kind: "directory"};
				}

				return null;
			}
		} catch (error) {
			return null;
		}
	}

	async readFile(path: string): Promise<Uint8Array> {
		try {
			const key = this.getS3Key(path);
			const result = await this.s3Client.get({key});

			if (result.Body) {
				if (result.Body instanceof Uint8Array) {
					return result.Body;
				} else if (typeof result.Body === "string") {
					return new TextEncoder().encode(result.Body);
				} else {
					// Handle other body types (stream, etc.)
					const arrayBuffer = await result.Body.arrayBuffer();
					return new Uint8Array(arrayBuffer);
				}
			}

			throw new DOMException("File not found", "NotFoundError");
		} catch (error) {
			throw new DOMException("File not found", "NotFoundError");
		}
	}

	async writeFile(path: string, data: Uint8Array): Promise<void> {
		try {
			const key = this.getS3Key(path);
			await this.s3Client.put({
				key,
				body: data,
			});
		} catch (error) {
			throw new DOMException(
				`Failed to write file: ${error}`,
				"InvalidModificationError",
			);
		}
	}

	async listDir(
		path: string,
	): Promise<Array<{name: string; kind: "file" | "directory"}>> {
		try {
			const dirPrefix = this.getS3Key(path);
			const listPrefix = dirPrefix ? `${dirPrefix}/` : "";

			const result = await this.s3Client.list({
				prefix: listPrefix,
				delimiter: "/",
			});

			const results: Array<{name: string; kind: "file" | "directory"}> = [];

			// Handle files (Contents)
			if (result.Contents) {
				for (const object of result.Contents) {
					if (object.Key && object.Key !== listPrefix) {
						const name = object.Key.replace(listPrefix, "");
						if (name && !name.includes("/")) {
							results.push({name, kind: "file"});
						}
					}
				}
			}

			// Handle directories (CommonPrefixes)
			if (result.CommonPrefixes) {
				for (const prefix of result.CommonPrefixes) {
					if (prefix.Prefix) {
						const name = prefix.Prefix.replace(listPrefix, "").replace("/", "");
						if (name) {
							results.push({name, kind: "directory"});
						}
					}
				}
			}

			return results;
		} catch (error) {
			throw new DOMException("Directory not found", "NotFoundError");
		}
	}

	async createDir(path: string): Promise<void> {
		try {
			// In S3, directories are created by putting an empty object with trailing slash
			const key = this.getS3Key(path);
			const dirKey = key.endsWith("/") ? key : `${key}/`;

			await this.s3Client.put({
				key: dirKey,
				body: new Uint8Array(0),
			});
		} catch (error) {
			throw new DOMException(
				`Failed to create directory: ${error}`,
				"InvalidModificationError",
			);
		}
	}

	async remove(path: string, recursive?: boolean): Promise<void> {
		try {
			const key = this.getS3Key(path);

			// Check if it's a file first
			try {
				await this.s3Client.head({key});
				// It's a file, delete it
				await this.s3Client.delete({key});
				return;
			} catch (error) {
				// Not a file, try as directory
			}

			// Handle as directory
			const dirPrefix = key.endsWith("/") ? key : `${key}/`;

			if (recursive) {
				// List all objects with this prefix and delete them
				const result = await this.s3Client.list({prefix: dirPrefix});

				if (result.Contents && result.Contents.length > 0) {
					const deleteKeys = result.Contents.map((obj: any) => ({
						key: obj.Key,
					}));
					await this.s3Client.deleteObjects({delete: {objects: deleteKeys}});
				}
			} else {
				// Check if directory is empty
				const result = await this.s3Client.list({
					prefix: dirPrefix,
					maxKeys: 1,
				});

				if (result.Contents && result.Contents.length > 0) {
					throw new DOMException(
						"Directory is not empty",
						"InvalidModificationError",
					);
				}

				// Delete the directory marker if it exists
				try {
					await this.s3Client.delete({key: dirPrefix});
				} catch (error) {
					// Directory marker might not exist, that's fine
				}
			}
		} catch (error) {
			if (error instanceof DOMException) throw error;
			throw new DOMException("Entry not found", "NotFoundError");
		}
	}

	private getS3Key(path: string): string {
		// Defense in depth: validate path components
		if (path.includes("..") || path.includes("\0")) {
			throw new DOMException(
				"Invalid path: contains path traversal or null bytes",
				"NotAllowedError",
			);
		}

		// Remove leading slash and combine with prefix
		const cleanPath = path.startsWith("/") ? path.slice(1) : path;

		if (!cleanPath) {
			return this.prefix;
		}

		// Validate each path component for S3 compatibility
		const parts = cleanPath.split("/");
		for (const part of parts) {
			if (part === "." || part === ".." || part.includes("\\")) {
				throw new DOMException("Invalid S3 key component", "NotAllowedError");
			}
		}

		return this.prefix ? `${this.prefix}/${cleanPath}` : cleanPath;
	}
}

/**
 * S3 bucket - root entry point for S3 filesystem using Bun's S3 client
 * Implements FileSystemDirectoryHandle for S3 object storage
 *
 * Example usage with namespacing:
 * ```typescript
 * const s3 = new S3Client({ ... });
 *
 * // Register namespaced buckets for multi-tenancy
 * FileSystemRegistry.register("dist", new S3Bucket(
 *   s3,
 *   "my-company-bucket",
 *   "my-app/production/dist"  // Prefix for isolation
 * ));
 *
 * FileSystemRegistry.register("tmp", new S3Bucket(
 *   s3,
 *   "my-company-bucket",
 *   "my-app/production/tmp"
 * ));
 * ```
 */
export class S3Bucket implements FileSystemDirectoryHandle {
	readonly kind = "directory" as const;
	readonly name: string;
	private backend: S3FileSystemBackend;

	constructor(
		s3Client: any,
		bucketName: string,
		prefix: string = "",  // No default prefix - let users explicitly namespace
	) {
		this.name = prefix.split("/").filter(Boolean).pop() || bucketName;
		this.backend = new S3FileSystemBackend(s3Client, bucketName, prefix);
	}

	async getFileHandle(
		name: string,
		options?: {create?: boolean},
	): Promise<FileSystemFileHandle> {
		const filePath = `/${name}`;
		const stat = await this.backend.stat(filePath);

		if (!stat && options?.create) {
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
		const dirPath = `/${name}`;
		const stat = await this.backend.stat(dirPath);

		if (!stat && options?.create) {
			await this.backend.createDir(dirPath);
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
		const entryPath = `/${name}`;
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

		// For S3 bucket, check if the handle uses our backend
		const descendantPath = (possibleDescendant as any).path;
		if (typeof descendantPath === "string" && descendantPath.startsWith("/")) {
			return descendantPath.split("/").filter(Boolean);
		}

		return null;
	}

	async *entries(): AsyncIterableIterator<[string, FileSystemHandle]> {
		const entries = await this.backend.listDir("/");

		for (const entry of entries) {
			const entryPath = `/${entry.name}`;
			if (entry.kind === "file") {
				yield [entry.name, new ShovelFileHandle(this.backend, entryPath)];
			} else {
				yield [entry.name, new ShovelDirectoryHandle(this.backend, entryPath)];
			}
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
		return other instanceof S3Bucket && other.name === this.name;
	}

	async queryPermission(): Promise<PermissionState> {
		return "granted";
	}

	async requestPermission(): Promise<PermissionState> {
		return "granted";
	}
}
