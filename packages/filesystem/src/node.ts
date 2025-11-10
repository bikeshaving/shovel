/**
 * Node.js implementation of File System Access API
 *
 * Implements FileSystemDirectoryHandle and FileSystemFileHandle using fs/promises
 * to provide universal File System Access API on Node.js platforms.
 */

import * as fs from "fs/promises";
import * as path from "path";
import {createWriteStream} from "fs";
import type {Bucket, FileSystemConfig} from "./types.js";

// File System Access API types are available globally after importing in platform types

/**
 * Node.js implementation of FileSystemWritableFileStream
 */
export class NodeFileSystemWritableFileStream extends WritableStream<Uint8Array> {
	constructor(private filePath: string) {
		const writeStream = createWriteStream(filePath);

		super({
			write(chunk) {
				return new Promise((resolve, reject) => {
					writeStream.write(chunk, (error) => {
						if (error) reject(error);
						else resolve();
					});
				});
			},
			close() {
				return new Promise((resolve, reject) => {
					writeStream.end((error) => {
						if (error) reject(error);
						else resolve();
					});
				});
			},
			abort() {
				writeStream.destroy();
				return Promise.resolve();
			},
		});
	}

	// File System Access API compatibility methods
	async write(data: Uint8Array | string): Promise<void> {
		const writer = this.getWriter();
		try {
			if (typeof data === "string") {
				await writer.write(new TextEncoder().encode(data));
			} else {
				await writer.write(data);
			}
		} finally {
			writer.releaseLock();
		}
	}

	async close(): Promise<void> {
		const writer = this.getWriter();
		try {
			await writer.close();
		} finally {
			writer.releaseLock();
		}
	}
}

/**
 * Node.js implementation of FileSystemFileHandle
 */
export class NodeFileSystemFileHandle implements FileSystemFileHandle {
	readonly kind = "file" as const;
	readonly name: string;

	constructor(private filePath: string) {
		this.name = path.basename(filePath);
	}

	async getFile(): Promise<File> {
		try {
			const stats = await fs.stat(this.filePath);
			const buffer = await fs.readFile(this.filePath);

			// Create File object with proper metadata
			return new File([buffer], this.name, {
				lastModified: stats.mtime.getTime(),
				// Attempt to determine MIME type from extension
				type: this.getMimeType(this.filePath),
			});
		} catch (error) {
			if ((error as any).code === "ENOENT") {
				throw new DOMException("File not found", "NotFoundError");
			}
			throw error;
		}
	}

	async createWritable(): Promise<FileSystemWritableFileStream> {
		// Ensure directory exists
		await fs.mkdir(path.dirname(this.filePath), {recursive: true});
		return new NodeFileSystemWritableFileStream(this.filePath) as any;
	}

	async createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle> {
		throw new DOMException(
			"Synchronous access handles are only available in workers",
			"InvalidStateError",
		);
	}

	async isSameEntry(other: FileSystemHandle): Promise<boolean> {
		if (other.kind !== "file") return false;
		if (!(other instanceof NodeFileSystemFileHandle)) return false;
		return this.filePath === other.filePath;
	}

	async queryPermission(): Promise<PermissionState> {
		// Node.js filesystem access doesn't have browser-style permissions
		return "granted";
	}

	async requestPermission(): Promise<PermissionState> {
		// Node.js filesystem access doesn't have browser-style permissions
		return "granted";
	}


	private getMimeType(filePath: string): string {
		const ext = path.extname(filePath).toLowerCase();
		const mimeTypes: Record<string, string> = {
			".txt": "text/plain",
			".html": "text/html",
			".css": "text/css",
			".js": "text/javascript",
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
 * Node.js implementation of FileSystemDirectoryHandle
 */
export class NodeFileSystemDirectoryHandle
	implements FileSystemDirectoryHandle
{
	readonly kind = "directory" as const;
	readonly name: string;

	constructor(private dirPath: string) {
		this.name = path.basename(dirPath);
	}

	async getFileHandle(
		name: string,
		options?: {create?: boolean},
	): Promise<FileSystemFileHandle> {
		const filePath = path.join(this.dirPath, name);

		try {
			const stats = await fs.stat(filePath);
			if (!stats.isFile()) {
				throw new DOMException(
					"Path exists but is not a file",
					"TypeMismatchError",
				);
			}
		} catch (error) {
			if ((error as any).code === "ENOENT") {
				if (options?.create) {
					// Ensure directory exists before creating file
					await fs.mkdir(this.dirPath, {recursive: true});
					// Touch the file to create it
					await fs.writeFile(filePath, "");
				} else {
					throw new DOMException("File not found", "NotFoundError");
				}
			} else {
				throw error;
			}
		}

		return new NodeFileSystemFileHandle(filePath);
	}

	async getDirectoryHandle(
		name: string,
		options?: {create?: boolean},
	): Promise<FileSystemDirectoryHandle> {
		const subDirPath = path.join(this.dirPath, name);

		try {
			const stats = await fs.stat(subDirPath);
			if (!stats.isDirectory()) {
				throw new DOMException(
					"Path exists but is not a directory",
					"TypeMismatchError",
				);
			}
		} catch (error) {
			if ((error as any).code === "ENOENT") {
				if (options?.create) {
					await fs.mkdir(subDirPath, {recursive: true});
				} else {
					throw new DOMException("Directory not found", "NotFoundError");
				}
			} else {
				throw error;
			}
		}

		return new NodeFileSystemDirectoryHandle(subDirPath);
	}

	async removeEntry(
		name: string,
		options?: {recursive?: boolean},
	): Promise<void> {
		const entryPath = path.join(this.dirPath, name);

		try {
			const stats = await fs.stat(entryPath);
			if (stats.isDirectory()) {
				await fs.rmdir(entryPath, {recursive: options?.recursive});
			} else {
				await fs.unlink(entryPath);
			}
		} catch (error) {
			if ((error as any).code === "ENOENT") {
				throw new DOMException("Entry not found", "NotFoundError");
			}
			throw error;
		}
	}

	async resolve(
		_possibleDescendant: FileSystemHandle,
	): Promise<string[] | null> {
		// This is complex to implement - for now, return null (not supported)
		return null;
	}

	async *entries(): AsyncIterableIterator<[string, FileSystemHandle]> {
		try {
			const entries = await fs.readdir(this.dirPath, {withFileTypes: true});

			for (const entry of entries) {
				const entryPath = path.join(this.dirPath, entry.name);
				if (entry.isDirectory()) {
					yield [entry.name, new NodeFileSystemDirectoryHandle(entryPath)];
				} else if (entry.isFile()) {
					yield [entry.name, new NodeFileSystemFileHandle(entryPath)];
				}
			}
		} catch (error) {
			if ((error as any).code === "ENOENT") {
				throw new DOMException("Directory not found", "NotFoundError");
			}
			throw error;
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
		if (!(other instanceof NodeFileSystemDirectoryHandle)) return false;
		return this.dirPath === other.dirPath;
	}

	async queryPermission(): Promise<PermissionState> {
		// Node.js filesystem access doesn't have browser-style permissions
		return "granted";
	}

	async requestPermission(): Promise<PermissionState> {
		// Node.js filesystem access doesn't have browser-style permissions
		return "granted";
	}

}


