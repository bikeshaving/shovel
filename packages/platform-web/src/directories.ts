/**
 * Web Cache Directory
 *
 * Read-only FileSystemDirectoryHandle backed by the browser's Cache API.
 * Assets pre-cached during Service Worker install are served via cache.match().
 * Used by assetsMiddleware() through self.directories.open("public").
 */

/**
 * Capture native caches before ServiceWorkerGlobals overwrites them.
 */
const nativeCaches: CacheStorage | undefined = globalThis.caches;

const ASSET_CACHE_NAME = "shovel-assets-v1";

/**
 * FileSystemFileHandle backed by a cached Response.
 */
class WebCacheFileHandle implements FileSystemFileHandle {
	readonly kind: "file";
	readonly name: string;
	#url: string;

	constructor(url: string, name: string) {
		this.kind = "file";
		this.#url = url;
		this.name = name;
	}

	async getFile(): Promise<File> {
		if (!nativeCaches) {
			throw new DOMException("Cache API not available", "NotFoundError");
		}

		const cache = await nativeCaches.open(ASSET_CACHE_NAME);
		const response = await cache.match(this.#url);

		if (!response) {
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
		throw new DOMException("Cache assets are read-only", "NotAllowedError");
	}

	async createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle> {
		throw new DOMException("Sync access not supported", "NotSupportedError");
	}

	isSameEntry(other: FileSystemHandle): Promise<boolean> {
		return Promise.resolve(
			other instanceof WebCacheFileHandle && other.#url === this.#url,
		);
	}
}

/**
 * Read-only FileSystemDirectoryHandle backed by Cache API.
 *
 * Provides access to static assets pre-cached during SW install.
 * Directory listing is not supported (Cache API doesn't support prefix enumeration easily).
 */
class WebCacheDirectoryHandle implements FileSystemDirectoryHandle {
	readonly kind: "directory";
	readonly name: string;
	#basePath: string;

	constructor(basePath = "/") {
		this.kind = "directory";
		this.#basePath = basePath.endsWith("/") ? basePath : basePath + "/";
		this.name = basePath.split("/").filter(Boolean).pop() || "assets";
	}

	async getFileHandle(
		name: string,
		_options?: FileSystemGetFileOptions,
	): Promise<FileSystemFileHandle> {
		if (!nativeCaches) {
			throw new DOMException("Cache API not available", "NotFoundError");
		}

		const path = this.#basePath + name;
		const cache = await nativeCaches.open(ASSET_CACHE_NAME);
		// Try matching against the origin-relative URL
		const response = await cache.match(new Request(path));

		if (!response) {
			throw new DOMException(
				`A requested file or directory could not be found: ${name}`,
				"NotFoundError",
			);
		}

		return new WebCacheFileHandle(path, name);
	}

	async getDirectoryHandle(
		name: string,
		_options?: FileSystemGetDirectoryOptions,
	): Promise<FileSystemDirectoryHandle> {
		return new WebCacheDirectoryHandle(this.#basePath + name);
	}

	async removeEntry(
		_name: string,
		_options?: FileSystemRemoveOptions,
	): Promise<void> {
		throw new DOMException(
			"Cache assets directory is read-only",
			"NotAllowedError",
		);
	}

	async resolve(
		_possibleDescendant: FileSystemHandle,
	): Promise<string[] | null> {
		return null;
	}

	// eslint-disable-next-line require-yield
	async *entries(): AsyncIterableIterator<[string, FileSystemHandle]> {
		throw new DOMException(
			"Directory listing not supported for cache-backed assets",
			"NotSupportedError",
		);
	}

	// eslint-disable-next-line require-yield
	async *keys(): AsyncIterableIterator<string> {
		throw new DOMException(
			"Directory listing not supported for cache-backed assets",
			"NotSupportedError",
		);
	}

	// eslint-disable-next-line require-yield
	async *values(): AsyncIterableIterator<FileSystemHandle> {
		throw new DOMException(
			"Directory listing not supported for cache-backed assets",
			"NotSupportedError",
		);
	}

	[Symbol.asyncIterator](): AsyncIterableIterator<[string, FileSystemHandle]> {
		return this.entries();
	}

	isSameEntry(other: FileSystemHandle): Promise<boolean> {
		return Promise.resolve(
			other instanceof WebCacheDirectoryHandle &&
				other.#basePath === this.#basePath,
		);
	}
}

/**
 * DirectoryClass for browser Cache API-backed assets.
 * Used by the factory pattern via config defaults.
 */
export class WebCacheDirectory extends WebCacheDirectoryHandle {
	constructor(_name: string, options: {path?: string} = {}) {
		const basePath = options.path ?? "/";
		const normalizedBase =
			basePath === "/"
				? "/"
				: basePath.startsWith("/")
					? basePath
					: `/${basePath}`;
		super(normalizedBase);
	}
}

export default WebCacheDirectory;
