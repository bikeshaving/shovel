/**
 * Cloudflare Directory Implementations
 *
 * Provides FileSystemDirectoryHandle/FileSystemFileHandle implementations
 * for Cloudflare Workers:
 *
 * - R2: Read-write storage backed by Cloudflare R2 buckets
 * - Assets: Read-only access to static assets deployed with the Worker
 *
 * Default export: CloudflareR2Directory (general purpose, user-configurable)
 * Named export: CloudflareAssetsDirectory (singleton for public assets)
 */

import {getAssetsManifest} from "@b9g/assets/manifest";
import mime from "mime";

import {getEnv} from "./variables.js";

// ============================================================================
// ASSET MANIFEST
// ============================================================================

/**
 * The subset of @b9g/assets' AssetManifest that enumeration reads. The
 * canonical AssetManifest is assignable to this; tests can pass a minimal
 * shape.
 */
export interface AssetManifestLike {
	assets?: Record<string, {url?: string}>;
}

/**
 * Per-manifest directory index: dirPath (with trailing slash) -> children.
 * Built once per manifest object and memoized, so enumeration is a Map
 * lookup instead of a full manifest sweep per directory per call.
 */
type DirectoryIndex = Map<
	string,
	Map<string, {kind: "file" | "directory"; url: string}>
>;

const directoryIndexes = new WeakMap<AssetManifestLike, DirectoryIndex>();

function getDirectoryIndex(manifest: AssetManifestLike): DirectoryIndex | null {
	const assets = manifest.assets;
	if (!assets || typeof assets !== "object") {
		// A manifest without an assets record (stale or malformed build
		// artifact) is treated as "no manifest" rather than crashing.
		return null;
	}

	let index = directoryIndexes.get(manifest);
	if (index) return index;

	index = new Map();
	for (const entry of Object.values(assets)) {
		const url = entry?.url;
		if (typeof url !== "string" || !url.startsWith("/")) continue;

		const segments = url.split("/").slice(1);
		let dirPath = "/";
		for (let i = 0; i < segments.length; i++) {
			const name = segments[i];
			if (!name) continue;

			let children = index.get(dirPath);
			if (!children) {
				children = new Map();
				index.set(dirPath, children);
			}

			const isLeaf = i === segments.length - 1;
			const existing = children.get(name);
			if (isLeaf) {
				// A name that exists as both a file and a directory keeps the
				// directory: shadowing a subtree behind a same-named file would
				// silently hide deeper content, and manifest iteration order is
				// not stable enough to make the alternative deterministic.
				if (!existing) children.set(name, {kind: "file", url});
			} else if (!existing || existing.kind === "file") {
				children.set(name, {kind: "directory", url: dirPath + name + "/"});
			}

			dirPath = dirPath + name + "/";
		}
	}

	directoryIndexes.set(manifest, index);
	return index;
}

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
// ASSETS TYPES
// ============================================================================

/**
 * Cloudflare ASSETS binding interface
 */
export interface CFAssetsBinding {
	fetch(request: Request | string): Promise<Response>;
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

const kR2Bucket = Symbol("r2Bucket");
const kKey = Symbol("key");

export interface R2FileSystemFileHandle {
	[kR2Bucket]: R2Bucket;
	[kKey]: string;
}

/**
 * Cloudflare R2 implementation of FileSystemFileHandle
 */
export class R2FileSystemFileHandle implements FileSystemFileHandle {
	readonly kind: "file";
	readonly name: string;

	constructor(r2Bucket: R2Bucket, key: string) {
		this.kind = "file";
		this[kR2Bucket] = r2Bucket;
		this[kKey] = key;
		this.name = key.split("/").pop() || key;
	}

	async getFile(): Promise<File> {
		const r2Object = await this[kR2Bucket].get(this[kKey]);

		if (!r2Object) {
			throw new DOMException("File not found", "NotFoundError");
		}

		const arrayBuffer = await r2Object.arrayBuffer();

		return new File(
			[arrayBuffer],
			this.name,
			{
				lastModified: r2Object.uploaded.getTime(),
				type: r2Object.httpMetadata?.contentType || getMIMEType(this[kKey]),
			},
		);
	}

	async createWritable(): Promise<FileSystemWritableFileStream> {
		return new R2FileSystemWritableFileStream(
			this[kR2Bucket],
			this[kKey],
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
		return this[kKey] === other[kKey];
	}

	async queryPermission(): Promise<PermissionState> {
		return "granted";
	}

	async requestPermission(): Promise<PermissionState> {
		return "granted";
	}
}

function getMIMEType(key: string): string {
	return mime.getType(key) || "application/octet-stream";
}

const kPrefix = Symbol("prefix");

export interface R2FileSystemDirectoryHandle {
	[kR2Bucket]: R2Bucket;
	[kPrefix]: string;
}

/**
 * Cloudflare R2 implementation of FileSystemDirectoryHandle
 */
export class R2FileSystemDirectoryHandle implements FileSystemDirectoryHandle {
	readonly kind: "directory";
	readonly name: string;

	constructor(r2Bucket: R2Bucket, prefix: string) {
		this.kind = "directory";
		this[kR2Bucket] = r2Bucket;
		this[kPrefix] = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
		this.name = this[kPrefix].split("/").pop() || "root";
	}

	async getFileHandle(
		name: string,
		options?: {create?: boolean},
	): Promise<FileSystemFileHandle> {
		const key = this[kPrefix] ? `${this[kPrefix]}/${name}` : name;

		const exists = await this[kR2Bucket].head(key);

		if (!exists && options?.create) {
			await this[kR2Bucket].put(key, new Uint8Array(0));
		} else if (!exists) {
			throw new DOMException("File not found", "NotFoundError");
		}

		return new R2FileSystemFileHandle(this[kR2Bucket], key);
	}

	async getDirectoryHandle(
		name: string,
		options?: {create?: boolean},
	): Promise<FileSystemDirectoryHandle> {
		const newPrefix = this[kPrefix] ? `${this[kPrefix]}/${name}` : name;

		if (options?.create) {
			const markerKey = `${newPrefix}/.shovel_directory_marker`;
			const exists = await this[kR2Bucket].head(markerKey);
			if (!exists) {
				await this[kR2Bucket].put(markerKey, new Uint8Array(0));
			}
		}

		return new R2FileSystemDirectoryHandle(this[kR2Bucket], newPrefix);
	}

	async removeEntry(
		name: string,
		options?: {recursive?: boolean},
	): Promise<void> {
		const key = this[kPrefix] ? `${this[kPrefix]}/${name}` : name;

		const fileExists = await this[kR2Bucket].head(key);

		if (fileExists) {
			await this[kR2Bucket].delete(key);
			return;
		}

		if (options?.recursive) {
			const dirPrefix = `${key}/`;
			const listed = await this[kR2Bucket].list({prefix: dirPrefix});

			const deletePromises = listed.objects.map((object) =>
				this[kR2Bucket].delete(object.key),
			);
			await Promise.all(deletePromises);

			const markerKey = `${key}/.shovel_directory_marker`;
			const markerExists = await this[kR2Bucket].head(markerKey);
			if (markerExists) {
				await this[kR2Bucket].delete(markerKey);
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

	[Symbol.asyncIterator](): AsyncIterableIterator<[
		string,
		FileSystemFileHandle | FileSystemDirectoryHandle,
	]> {
		return this.entries();
	}

	entries(): AsyncIterableIterator<[
		string,
		FileSystemFileHandle | FileSystemDirectoryHandle,
	]> {
		return generateR2Entries(this);
	}

	keys(): AsyncIterableIterator<string> {
		return generateR2Keys(this);
	}

	values(): AsyncIterableIterator<
		FileSystemFileHandle | FileSystemDirectoryHandle
	> {
		return generateR2Values(this);
	}

	async isSameEntry(other: FileSystemHandle): Promise<boolean> {
		if (other.kind !== "directory") return false;
		if (!(other instanceof R2FileSystemDirectoryHandle)) return false;
		return this[kPrefix] === other[kPrefix];
	}

	async queryPermission(): Promise<PermissionState> {
		return "granted";
	}

	async requestPermission(): Promise<PermissionState> {
		return "granted";
	}
}

async function *generateR2Entries(
	directory: R2FileSystemDirectoryHandle,
): AsyncIterableIterator<[
	string,
	FileSystemFileHandle | FileSystemDirectoryHandle,
]> {
	const listPrefix = directory[kPrefix] ? `${directory[kPrefix]}/` : "";

	try {
		const result = await directory[kR2Bucket].list({
			prefix: listPrefix,
			delimiter: "/",
		});

		for (const object of result.objects) {
			if (object.key !== listPrefix) {
				const name = object.key.substring(listPrefix.length);
				if (!name.includes("/") && !name.endsWith(".shovel_directory_marker")) {
					yield [
						name,
						new R2FileSystemFileHandle(directory[kR2Bucket], object.key),
					] as [string, FileSystemFileHandle | FileSystemDirectoryHandle];
				}
			}
		}

		for (const prefix of result.delimitedPrefixes) {
			const name = prefix.substring(listPrefix.length).replace(/\/$/, "");
			if (name) {
				yield [
					name,
					new R2FileSystemDirectoryHandle(
						directory[kR2Bucket],
						prefix.replace(/\/$/, ""),
					),
				] as [string, FileSystemFileHandle | FileSystemDirectoryHandle];
			}
		}
	} catch (error) {
		throw new DOMException("Directory not found", "NotFoundError");
	}
}

async function *generateR2Keys(
	directory: R2FileSystemDirectoryHandle,
): AsyncIterableIterator<string> {
	for await (const [name] of directory.entries()) {
		yield name;
	}
}

async function *generateR2Values(
	directory: R2FileSystemDirectoryHandle,
): AsyncIterableIterator<FileSystemFileHandle | FileSystemDirectoryHandle> {
	for await (const [, handle] of directory.entries()) {
		yield handle;
	}
}

// ============================================================================
// ASSETS FILESYSTEM IMPLEMENTATION
// ============================================================================

const kAssets = Symbol("assets");
const kPath = Symbol("path");

export interface CFAssetsFileHandle {
	[kAssets]: CFAssetsBinding;
	[kPath]: string;
}

/**
 * FileSystemFileHandle implementation for CF ASSETS binding files.
 */
export class CFAssetsFileHandle implements FileSystemFileHandle {
	readonly kind: "file";
	readonly name: string;

	constructor(assets: CFAssetsBinding, path: string, name: string) {
		this.kind = "file";
		this[kAssets] = assets;
		this[kPath] = path;
		this.name = name;
	}

	async getFile(): Promise<File> {
		const response = await this[kAssets].fetch(
			new Request("https://assets" + this[kPath]),
		);

		if (!response.ok) {
			throw new DOMException(
				`A requested file or directory could not be found: ${this.name}`,
				"NotFoundError",
			);
		}

		const blob = await response.blob();
		const contentType =
			response.headers.get("content-type") || "application/octet-stream";

		return new File([blob], this.name, {type: contentType});
	}

	async createWritable(
		_options?: FileSystemCreateWritableOptions,
	): Promise<FileSystemWritableFileStream> {
		throw new DOMException("Assets are read-only", "NotAllowedError");
	}

	async createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle> {
		throw new DOMException("Sync access not supported", "NotSupportedError");
	}

	isSameEntry(other: FileSystemHandle): Promise<boolean> {
		return Promise.resolve(
			other instanceof CFAssetsFileHandle && other[kPath] === this[kPath],
		);
	}
}

const kBasePath = Symbol("basePath");
const kManifest = Symbol("manifest");

export interface CFAssetsDirectoryHandle {
	[kAssets]: CFAssetsBinding;
	[kBasePath]: string;
	[kManifest]?: AssetManifestLike;
}

/**
 * FileSystemDirectoryHandle implementation over Cloudflare ASSETS binding.
 *
 * Provides read-only access to static assets deployed with a CF Worker.
 * Directory listing is not supported (ASSETS binding limitation).
 */
export class CFAssetsDirectoryHandle implements FileSystemDirectoryHandle {
	readonly kind: "directory";
	readonly name: string;

	constructor(
		assets: CFAssetsBinding,
		basePath = "/",

		/** Overrides the registered asset manifest (used by tests). */
		manifest?: AssetManifestLike,
	) {
		this.kind = "directory";
		this[kAssets] = assets;
		this[kBasePath] = basePath.endsWith("/") ? basePath : basePath + "/";
		this.name = basePath.split("/").filter(Boolean).pop() || "assets";
		this[kManifest] = manifest;
	}

	async getFileHandle(
		name: string,
		_options?: FileSystemGetFileOptions,
	): Promise<FileSystemFileHandle> {
		const path = this[kBasePath] + name;

		// The manifest answers existence without a network round-trip — a
		// list-then-read walk otherwise costs two ASSETS subrequests per file
		// against the Workers subrequest cap.
		const manifest = this[kManifest] ?? getAssetsManifest();
		const index = manifest && getDirectoryIndex(manifest);
		const dirChildren = index?.get(this[kBasePath]);
		const child = dirChildren?.get(name);
		if (child?.kind === "file") {
			return new CFAssetsFileHandle(this[kAssets], child.url, name);
		}

		// Not in the manifest (or no manifest): probe the binding, which also
		// serves files that reached the assets directory outside the build.
		const response = await this[kAssets].fetch(
			new Request("https://assets" + path),
		);

		if (!response.ok) {
			throw new DOMException(
				`A requested file or directory could not be found: ${name}`,
				"NotFoundError",
			);
		}

		return new CFAssetsFileHandle(this[kAssets], path, name);
	}

	async getDirectoryHandle(
		name: string,
		_options?: FileSystemGetDirectoryOptions,
	): Promise<CFAssetsDirectoryHandle> {
		return new CFAssetsDirectoryHandle(
			this[kAssets],
			this[kBasePath] + name,
			this[kManifest],
		);
	}

	async removeEntry(
		_name: string,
		_options?: FileSystemRemoveOptions,
	): Promise<void> {
		throw new DOMException("Assets directory is read-only", "NotAllowedError");
	}

	async resolve(
		_possibleDescendant: FileSystemHandle,
	): Promise<string[] | null> {
		return null;
	}

	[Symbol.asyncIterator](): AsyncIterableIterator<[
		string,
		FileSystemFileHandle | FileSystemDirectoryHandle,
	]> {
		return this.entries();
	}

	/**
	 * The ASSETS binding has no list API, but the build already knows every
	 * asset it emitted: the generated worker entry registers the bundled
	 * manifest at startup. Enumeration reads the memoized directory index
	 * over it — files as file handles, deeper paths as subdirectory handles.
	 */
	async *entries(): AsyncIterableIterator<[
		string,
		FileSystemFileHandle | FileSystemDirectoryHandle,
	]> {
		const children = assetsChildren(this);
		if (!children) return;
		for (const [name, child] of children) {
			if (child.kind === "file") {
				yield [name, new CFAssetsFileHandle(this[kAssets], child.url, name)];
			} else {
				yield [
					name,
					new CFAssetsDirectoryHandle(
						this[kAssets],
						this[kBasePath] + name,
						this[kManifest],
					),
				];
			}
		}
	}

	async *keys(): AsyncIterableIterator<string> {
		const children = assetsChildren(this);
		if (!children) return;
		yield *children.keys();
	}

	async *values(): AsyncIterableIterator<
		FileSystemFileHandle | FileSystemDirectoryHandle
	> {
		for await (const [, handle] of this.entries()) yield handle;
	}

	isSameEntry(other: FileSystemHandle): Promise<boolean> {
		return Promise.resolve(
			other instanceof CFAssetsDirectoryHandle &&
				other[kBasePath] === this[kBasePath],
		);
	}
}

/** Direct children from the manifest index; throws without a manifest. */
function assetsChildren(
	directory: CFAssetsDirectoryHandle,
): Map<string, {kind: "file" | "directory"; url: string}> | null {
	const manifest = directory[kManifest] ?? getAssetsManifest();
	const index = manifest && getDirectoryIndex(manifest);
	if (!index) {
		throw new DOMException(
			"Directory listing for the ASSETS binding needs the shovel:assets " +
				"manifest, which is not supported outside a shovel build.",
			"NotSupportedError",
		);
	}
	return index.get(directory[kBasePath]) ?? null;
}

// ============================================================================
// DIRECTORY CLASSES (for factory pattern)
// ============================================================================

export interface CloudflareR2DirectoryOptions {
	/** R2 binding name (must match wrangler.toml binding). Defaults to "${NAME}_R2" */
	binding?: string;

	/** Optional prefix/path within the bucket */
	path?: string;
}

/**
 * DirectoryClass for Cloudflare R2 buckets.
 * Uses env bindings to resolve the bucket at runtime.
 *
 * Config example:
 * ```json
 * { "module": "@b9g/platform-cloudflare/directories", "binding": "uploads_r2" }
 * ```
 */
export class CloudflareR2Directory extends R2FileSystemDirectoryHandle {
	constructor(name: string, options: CloudflareR2DirectoryOptions = {}) {
		const env = getEnv();

		const bindingName = options.binding || `${name.toUpperCase()}_R2`;
		const r2Bucket = env[bindingName] as R2Bucket | undefined;
		if (!r2Bucket) {
			throw new Error(
				`R2 bucket binding "${bindingName}" not found. ` +
					"Configure in wrangler.toml:\n\n" +
					"[[r2_buckets]]\n" +
					`binding = "${bindingName}"\n` +
					`bucket_name = "your-bucket-name"`,
			);
		}

		const prefix = options.path ?? "";
		const normalizedPrefix = prefix.startsWith("/") ? prefix.slice(1) : prefix;
		super(r2Bucket, normalizedPrefix);
	}
}

export interface CloudflareAssetsDirectoryOptions {
	/** Base path within assets (defaults to "/") */
	path?: string;
}

/**
 * DirectoryClass for Cloudflare ASSETS binding (static assets).
 * Always uses the "ASSETS" binding (Cloudflare convention).
 *
 * Config example:
 * ```json
 * { "module": "@b9g/platform-cloudflare/directories", "export": "CloudflareAssetsDirectory" }
 * ```
 */
export class CloudflareAssetsDirectory extends CFAssetsDirectoryHandle {
	constructor(_name: string, options: CloudflareAssetsDirectoryOptions = {}) {
		const env = getEnv();

		const assets = env.ASSETS as CFAssetsBinding | undefined;
		if (!assets) {
			throw new Error(
				"ASSETS binding not found. " +
					"Configure in wrangler.toml:\n\n" +
					"[assets]\n" +
					`directory = "./public"`,
			);
		}

		const basePath = options.path ?? "/";
		const normalizedBase = basePath === "/"
			? "/"
			: basePath.startsWith("/") ? basePath : `/${basePath}`;
		super(assets, normalizedBase);
	}
}

// Default export is R2 (general purpose, user-configurable)
export default CloudflareR2Directory;
