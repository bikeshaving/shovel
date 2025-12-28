/**
 * Cloudflare Native Cache
 *
 * Wrapper around Cloudflare's native Cache API for use with the factory pattern.
 */

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

export default CloudflareNativeCache;
