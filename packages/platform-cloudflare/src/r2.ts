/**
 * Cloudflare R2 Filesystem Implementation
 *
 * Provides FileSystemDirectoryHandle/FileSystemFileHandle implementations
 * backed by Cloudflare R2 buckets.
 */

import mime from "mime";
import {getEnv} from "./env.js";

// ============================================================================
// R2 TYPES
// ============================================================================

/** R2 object metadata */
export interface R2Object {
	key: string;
	uploaded: Date;
	httpMetadata?: {contentType?: string};
	arrayBuffer(): Promise<ArrayBuffer>;
}

/** R2 list result */
export interface R2Objects {
	objects: Array<{key: string}>;
	delimitedPrefixes: string[];
}

/** R2 bucket interface */
export interface R2Bucket {
	get(key: string): Promise<R2Object | null>;
	head(key: string): Promise<R2Object | null>;
	put(key: string, value: ArrayBuffer | Uint8Array): Promise<R2Object>;
	delete(key: string): Promise<void>;
	list(options?: {prefix?: string; delimiter?: string}): Promise<R2Objects>;
}

// ============================================================================
// R2 FILESYSTEM IMPLEMENTATION
// ============================================================================

/**
 * Cloudflare R2 implementation of FileSystemWritableFileStream
 */
export class R2FileSystemWritableFileStream extends WritableStream<Uint8Array> {
	constructor(r2Bucket: R2Bucket, key: string) {
		const chunks: Uint8Array[] = [];
		super({
			write: (chunk: Uint8Array) => {
				chunks.push(chunk);
				return Promise.resolve();
			},
			close: async () => {
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

				await r2Bucket.put(key, buffer);
			},
			abort: async () => {
				chunks.length = 0;
			},
		});
	}
}

/**
 * Cloudflare R2 implementation of FileSystemFileHandle
 */
export class R2FileSystemFileHandle implements FileSystemFileHandle {
	readonly kind: "file";
	readonly name: string;
	#r2Bucket: R2Bucket;
	#key: string;

	constructor(r2Bucket: R2Bucket, key: string) {
		this.kind = "file";
		this.#r2Bucket = r2Bucket;
		this.#key = key;
		this.name = key.split("/").pop() || key;
	}

	async getFile(): Promise<File> {
		const r2Object = await this.#r2Bucket.get(this.#key);

		if (!r2Object) {
			throw new DOMException("File not found", "NotFoundError");
		}

		const arrayBuffer = await r2Object.arrayBuffer();

		return new File([arrayBuffer], this.name, {
			lastModified: r2Object.uploaded.getTime(),
			type: r2Object.httpMetadata?.contentType || this.#getMimeType(this.#key),
		});
	}

	async createWritable(): Promise<FileSystemWritableFileStream> {
		return new R2FileSystemWritableFileStream(
			this.#r2Bucket,
			this.#key,
		) as unknown as FileSystemWritableFileStream;
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
		return this.#key === other.#key;
	}

	async queryPermission(): Promise<PermissionState> {
		return "granted";
	}

	async requestPermission(): Promise<PermissionState> {
		return "granted";
	}

	#getMimeType(key: string): string {
		return mime.getType(key) || "application/octet-stream";
	}
}

/**
 * Cloudflare R2 implementation of FileSystemDirectoryHandle
 */
export class R2FileSystemDirectoryHandle implements FileSystemDirectoryHandle {
	readonly kind: "directory";
	readonly name: string;
	#r2Bucket: R2Bucket;
	#prefix: string;

	constructor(r2Bucket: R2Bucket, prefix: string) {
		this.kind = "directory";
		this.#r2Bucket = r2Bucket;
		this.#prefix = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
		this.name = this.#prefix.split("/").pop() || "root";
	}

	async getFileHandle(
		name: string,
		options?: {create?: boolean},
	): Promise<FileSystemFileHandle> {
		const key = this.#prefix ? `${this.#prefix}/${name}` : name;

		const exists = await this.#r2Bucket.head(key);

		if (!exists && options?.create) {
			await this.#r2Bucket.put(key, new Uint8Array(0));
		} else if (!exists) {
			throw new DOMException("File not found", "NotFoundError");
		}

		return new R2FileSystemFileHandle(this.#r2Bucket, key);
	}

	async getDirectoryHandle(
		name: string,
		options?: {create?: boolean},
	): Promise<FileSystemDirectoryHandle> {
		const newPrefix = this.#prefix ? `${this.#prefix}/${name}` : name;

		if (options?.create) {
			const markerKey = `${newPrefix}/.shovel_directory_marker`;
			const exists = await this.#r2Bucket.head(markerKey);
			if (!exists) {
				await this.#r2Bucket.put(markerKey, new Uint8Array(0));
			}
		}

		return new R2FileSystemDirectoryHandle(this.#r2Bucket, newPrefix);
	}

	async removeEntry(
		name: string,
		options?: {recursive?: boolean},
	): Promise<void> {
		const key = this.#prefix ? `${this.#prefix}/${name}` : name;

		const fileExists = await this.#r2Bucket.head(key);

		if (fileExists) {
			await this.#r2Bucket.delete(key);
			return;
		}

		if (options?.recursive) {
			const dirPrefix = `${key}/`;
			const listed = await this.#r2Bucket.list({prefix: dirPrefix});

			const deletePromises = listed.objects.map((object) =>
				this.#r2Bucket.delete(object.key),
			);
			await Promise.all(deletePromises);

			const markerKey = `${key}/.shovel_directory_marker`;
			const markerExists = await this.#r2Bucket.head(markerKey);
			if (markerExists) {
				await this.#r2Bucket.delete(markerKey);
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
		return null;
	}

	async *entries(): AsyncIterableIterator<[string, FileSystemHandle]> {
		const listPrefix = this.#prefix ? `${this.#prefix}/` : "";

		try {
			const result = await this.#r2Bucket.list({
				prefix: listPrefix,
				delimiter: "/",
			});

			for (const object of result.objects) {
				if (object.key !== listPrefix) {
					const name = object.key.substring(listPrefix.length);
					if (
						!name.includes("/") &&
						!name.endsWith(".shovel_directory_marker")
					) {
						yield [
							name,
							new R2FileSystemFileHandle(this.#r2Bucket, object.key),
						];
					}
				}
			}

			for (const prefix of result.delimitedPrefixes) {
				const name = prefix.substring(listPrefix.length).replace(/\/$/, "");
				if (name) {
					yield [
						name,
						new R2FileSystemDirectoryHandle(
							this.#r2Bucket,
							prefix.replace(/\/$/, ""),
						),
					];
				}
			}
		} catch (error) {
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
		return this.#prefix === other.#prefix;
	}

	async queryPermission(): Promise<PermissionState> {
		return "granted";
	}

	async requestPermission(): Promise<PermissionState> {
		return "granted";
	}
}

// ============================================================================
// DIRECTORY CLASS (for factory pattern)
// ============================================================================

export interface CloudflareR2DirectoryOptions {
	/** R2 binding name (defaults to "${NAME}_R2") */
	binding?: string;
	/** Optional prefix within the bucket */
	path?: string;
	/** Optional prefix within the bucket (alias for path) */
	prefix?: string;
}

/**
 * DirectoryClass for Cloudflare R2 buckets.
 * Uses env bindings to resolve the bucket at runtime.
 */
export class CloudflareR2Directory extends R2FileSystemDirectoryHandle {
	constructor(name: string, options: CloudflareR2DirectoryOptions = {}) {
		const env = getEnv();

		const bindingName = options.binding || `${name.toUpperCase()}_R2`;
		const r2Bucket = env[bindingName] as R2Bucket | undefined;
		if (!r2Bucket) {
			throw new Error(
				`R2 bucket binding "${bindingName}" not found. ` +
					`Configure in wrangler.toml:\n\n` +
					`[[r2_buckets]]\n` +
					`binding = "${bindingName}"\n` +
					`bucket_name = "your-bucket-name"`,
			);
		}

		const prefix = options.prefix ?? options.path ?? "";
		const normalizedPrefix = prefix.startsWith("/") ? prefix.slice(1) : prefix;
		super(r2Bucket, normalizedPrefix);
	}
}

export default CloudflareR2Directory;
