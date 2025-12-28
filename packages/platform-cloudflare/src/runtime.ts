/**
 * Cloudflare Worker Runtime (Internal)
 *
 * This module provides runtime initialization for Cloudflare Workers.
 * It is imported by the entry wrapper, not by user code.
 */

import {AsyncContext} from "@b9g/async-context";
import {
	ServiceWorkerGlobals,
	ShovelServiceWorkerRegistration,
	ShovelFetchEvent,
	type ShovelFetchEventInit,
	CustomLoggerStorage,
	configureLogging,
	createCacheFactory,
	createDirectoryFactory,
	type ShovelConfig,
} from "@b9g/platform/runtime";
import {CustomCacheStorage} from "@b9g/cache";
import {CustomDirectoryStorage} from "@b9g/filesystem";
import {getLogger} from "@logtape/logtape";
import mime from "mime";

// ============================================================================
// CLOUDFLARE TYPES
// ============================================================================

/**
 * Cloudflare's ExecutionContext - passed to each request handler
 */
export interface ExecutionContext {
	waitUntil(promise: Promise<unknown>): void;
	passThroughOnException(): void;
}

/**
 * Cloudflare ASSETS binding interface
 */
export interface CFAssetsBinding {
	fetch(request: Request | string): Promise<Response>;
}

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
// PER-REQUEST CONTEXT (Internal)
// ============================================================================

/** Per-request storage for Cloudflare's env object (for directory factory) */
const envStorage = new AsyncContext.Variable<Record<string, unknown>>();

// ============================================================================
// CLOUDFLARE FETCH EVENT
// ============================================================================

/**
 * Options for CloudflareFetchEvent constructor
 */
export interface CloudflareFetchEventInit extends ShovelFetchEventInit {
	/** Cloudflare environment bindings (KV, R2, D1, etc.) */
	env: Record<string, unknown>;
}

/**
 * Cloudflare-specific FetchEvent with env bindings.
 *
 * Extends ShovelFetchEvent to add the `env` property for accessing
 * Cloudflare bindings (KV namespaces, R2 buckets, D1 databases, etc.)
 */
export class CloudflareFetchEvent extends ShovelFetchEvent {
	/** Cloudflare environment bindings (KV, R2, D1, Durable Objects, etc.) */
	readonly env: Record<string, unknown>;

	constructor(request: Request, options: CloudflareFetchEventInit) {
		super(request, options);
		this.env = options.env;
	}
}

// ============================================================================
// CLOUDFLARE NATIVE CACHE
// ============================================================================

/**
 * CloudflareNativeCache - Wrapper around Cloudflare's native Cache API.
 * This allows the native cache to be used with the factory pattern.
 *
 * Note: This must only be used in a Cloudflare Worker context where
 * globalThis.caches is available.
 */
export class CloudflareNativeCache implements Cache {
	#name: string;
	#cachePromise: Promise<Cache> | null;

	constructor(name: string, _options?: Record<string, unknown>) {
		this.#name = name;
		this.#cachePromise = null;
	}

	#getCache(): Promise<Cache> {
		if (!this.#cachePromise) {
			if (!globalThis.caches) {
				throw new Error("Cloudflare caches not available in this context");
			}
			this.#cachePromise = globalThis.caches.open(this.#name);
		}
		return this.#cachePromise;
	}

	async add(request: RequestInfo | URL): Promise<void> {
		const cache = await this.#getCache();
		return cache.add(request);
	}

	async addAll(requests: RequestInfo[]): Promise<void> {
		const cache = await this.#getCache();
		return cache.addAll(requests);
	}

	async delete(
		request: RequestInfo | URL,
		options?: CacheQueryOptions,
	): Promise<boolean> {
		const cache = await this.#getCache();
		return cache.delete(request, options);
	}

	async keys(
		request?: RequestInfo | URL,
		options?: CacheQueryOptions,
	): Promise<readonly Request[]> {
		const cache = await this.#getCache();
		return cache.keys(request, options);
	}

	async match(
		request: RequestInfo | URL,
		options?: CacheQueryOptions,
	): Promise<Response | undefined> {
		const cache = await this.#getCache();
		return cache.match(request, options);
	}

	async matchAll(
		request?: RequestInfo | URL,
		options?: CacheQueryOptions,
	): Promise<readonly Response[]> {
		const cache = await this.#getCache();
		return cache.matchAll(request, options);
	}

	async put(request: RequestInfo | URL, response: Response): Promise<void> {
		const cache = await this.#getCache();
		return cache.put(request, response);
	}
}

// ============================================================================
// RUNTIME INITIALIZATION
// ============================================================================

// Module-level state (initialized once when module loads)
let _registration: ShovelServiceWorkerRegistration | null = null;
let _globals: ServiceWorkerGlobals | null = null;

/**
 * Initialize the Cloudflare runtime with ServiceWorkerGlobals
 *
 * @param config - Shovel configuration from shovel:config virtual module
 * @returns The ServiceWorker registration for handling requests
 */
export async function initializeRuntime(
	config: ShovelConfig,
): Promise<ShovelServiceWorkerRegistration> {
	if (_registration) {
		return _registration;
	}

	// Configure logging first
	if (config.logging) {
		await configureLogging(config.logging);
	}

	_registration = new ShovelServiceWorkerRegistration();

	// Create cache storage with config-driven factory
	const caches = new CustomCacheStorage(
		createCacheFactory({configs: config.caches ?? {}}),
	);

	// Create directory storage with config-driven factory
	const directories = new CustomDirectoryStorage(
		createDirectoryFactory(config.directories ?? {}),
	);

	// Create ServiceWorkerGlobals
	_globals = new ServiceWorkerGlobals({
		registration: _registration,
		caches,
		directories,
		loggers: new CustomLoggerStorage((...cats) => getLogger(cats)),
	});

	// Install globals (caches, directories, cookieStore, addEventListener, etc.)
	_globals.install();

	return _registration;
}

/**
 * Create the ES module fetch handler for Cloudflare Workers
 *
 * Creates a CloudflareFetchEvent with env bindings and waitUntil hook,
 * then delegates to registration.handleEvent()
 */
export function createFetchHandler(
	registration: ShovelServiceWorkerRegistration,
): (
	request: Request,
	env: unknown,
	ctx: ExecutionContext,
) => Promise<Response> {
	return async (
		request: Request,
		env: unknown,
		ctx: ExecutionContext,
	): Promise<Response> => {
		// Create CloudflareFetchEvent with env and waitUntil hook
		const event = new CloudflareFetchEvent(request, {
			env: env as Record<string, unknown>,
			platformWaitUntil: (promise) => ctx.waitUntil(promise),
		});

		// Run within envStorage for directory factory access
		return envStorage.run(env as Record<string, unknown>, () =>
			registration.handleRequest(event),
		);
	};
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
// ASSETS FILESYSTEM IMPLEMENTATION
// ============================================================================

/**
 * FileSystemDirectoryHandle implementation over Cloudflare ASSETS binding.
 *
 * Provides read-only access to static assets deployed with a CF Worker.
 * Directory listing is not supported (ASSETS binding limitation).
 */
export class CFAssetsDirectoryHandle implements FileSystemDirectoryHandle {
	readonly kind: "directory";
	readonly name: string;
	#assets: CFAssetsBinding;
	#basePath: string;

	constructor(assets: CFAssetsBinding, basePath = "/") {
		this.kind = "directory";
		this.#assets = assets;
		this.#basePath = basePath.endsWith("/") ? basePath : basePath + "/";
		this.name = basePath.split("/").filter(Boolean).pop() || "assets";
	}

	async getFileHandle(
		name: string,
		_options?: FileSystemGetFileOptions,
	): Promise<FileSystemFileHandle> {
		const path = this.#basePath + name;

		const response = await this.#assets.fetch(
			new Request("https://assets" + path),
		);

		if (!response.ok) {
			throw new DOMException(
				`A requested file or directory could not be found: ${name}`,
				"NotFoundError",
			);
		}

		return new CFAssetsFileHandle(this.#assets, path, name);
	}

	async getDirectoryHandle(
		name: string,
		_options?: FileSystemGetDirectoryOptions,
	): Promise<FileSystemDirectoryHandle> {
		return new CFAssetsDirectoryHandle(this.#assets, this.#basePath + name);
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

	// eslint-disable-next-line require-yield
	async *entries(): AsyncIterableIterator<[string, FileSystemHandle]> {
		throw new DOMException(
			"Directory listing not supported for ASSETS binding. Use an asset manifest for enumeration.",
			"NotSupportedError",
		);
	}

	// eslint-disable-next-line require-yield
	async *keys(): AsyncIterableIterator<string> {
		throw new DOMException(
			"Directory listing not supported for ASSETS binding",
			"NotSupportedError",
		);
	}

	// eslint-disable-next-line require-yield
	async *values(): AsyncIterableIterator<FileSystemHandle> {
		throw new DOMException(
			"Directory listing not supported for ASSETS binding",
			"NotSupportedError",
		);
	}

	[Symbol.asyncIterator](): AsyncIterableIterator<[string, FileSystemHandle]> {
		return this.entries();
	}

	isSameEntry(other: FileSystemHandle): Promise<boolean> {
		return Promise.resolve(
			other instanceof CFAssetsDirectoryHandle &&
				other.#basePath === this.#basePath,
		);
	}
}

// ============================================================================
// CLOUDFLARE DIRECTORY CLASSES
// ============================================================================

export interface CloudflareR2DirectoryOptions {
	/** R2 binding name (defaults to "${NAME}_R2") */
	binding?: string;
	/** Optional prefix within the bucket */
	path?: string;
	/** Optional prefix within the bucket (alias for path) */
	prefix?: string;
}

export interface CloudflareAssetsDirectoryOptions {
	/** ASSETS binding name (defaults to "ASSETS") */
	binding?: string;
	/** Base path within assets (defaults to "/") */
	path?: string;
	/** Base path within assets (alias for path) */
	basePath?: string;
}

/**
 * DirectoryClass for Cloudflare R2 buckets.
 * Uses env bindings to resolve the bucket at runtime.
 */
export class CloudflareR2Directory extends R2FileSystemDirectoryHandle {
	constructor(name: string, options: CloudflareR2DirectoryOptions = {}) {
		const env = envStorage.get();
		if (!env) {
			throw new Error(
				`Cannot access directory "${name}": Cloudflare env not available. ` +
					`Are you accessing directories outside of a request context?`,
			);
		}

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

/**
 * DirectoryClass for Cloudflare ASSETS bindings.
 * Uses env bindings to resolve the assets handle at runtime.
 */
export class CloudflareAssetsDirectory extends CFAssetsDirectoryHandle {
	constructor(name: string, options: CloudflareAssetsDirectoryOptions = {}) {
		const env = envStorage.get();
		if (!env) {
			throw new Error(
				`Cannot access directory "${name}": Cloudflare env not available. ` +
					`Are you accessing directories outside of a request context?`,
			);
		}

		const bindingName = options.binding || "ASSETS";
		const assets = env[bindingName] as CFAssetsBinding | undefined;
		if (!assets) {
			throw new Error(
				`ASSETS binding "${bindingName}" not found. ` +
					`This binding is automatically available when using Cloudflare Pages or Workers with assets.`,
			);
		}

		const basePath = options.basePath ?? options.path ?? "/";
		const normalizedBase =
			basePath === "/"
				? "/"
				: basePath.startsWith("/")
					? basePath
					: `/${basePath}`;
		super(assets, normalizedBase);
	}
}

/**
 * FileSystemFileHandle implementation for CF ASSETS binding files.
 */
export class CFAssetsFileHandle implements FileSystemFileHandle {
	readonly kind: "file";
	readonly name: string;
	#assets: CFAssetsBinding;
	#path: string;

	constructor(assets: CFAssetsBinding, path: string, name: string) {
		this.kind = "file";
		this.#assets = assets;
		this.#path = path;
		this.name = name;
	}

	async getFile(): Promise<File> {
		const response = await this.#assets.fetch(
			new Request("https://assets" + this.#path),
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
			other instanceof CFAssetsFileHandle && other.#path === this.#path,
		);
	}
}
