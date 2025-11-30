/**
 * CFAssetsDirectoryHandle - FileSystemDirectoryHandle over CF ASSETS binding
 *
 * Wraps Cloudflare's Workers Static Assets binding to provide the standard
 * File System Access API interface, enabling shovel's `self.dirs.open("dist")`
 * to work seamlessly with bundled static assets.
 *
 * @example
 * ```ts
 * // In production CF Worker
 * const dist = new CFAssetsDirectoryHandle(env.ASSETS, "/assets");
 * const file = await dist.getFileHandle("style.abc123.css");
 * const content = await (await file.getFile()).text();
 * ```
 */

/**
 * Cloudflare ASSETS binding interface
 */
export interface CFAssetsBinding {
	fetch(request: Request | string): Promise<Response>;
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

		// Fetch the asset to verify it exists
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
		// ASSETS binding doesn't support directory listing
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
