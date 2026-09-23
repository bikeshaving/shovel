/**
 * Cloudflare Native Cache
 *
 * Wrapper around Cloudflare's native Cache API for use with the factory pattern.
 */

/**
 * Store reference to the ORIGINAL native caches object before ServiceWorkerGlobals
 * overwrites it. This is captured at module load time.
 *
 * This is critical because ServiceWorkerGlobals.install() replaces globalThis.caches
 * with CustomCacheStorage. If we used globalThis.caches directly in #getCache(),
 * we'd get infinite recursion: CustomCacheStorage.open() -> CloudflareNativeCache ->
 * #getCache() -> CustomCacheStorage.open() -> ...
 */
const nativeCaches: CacheStorage | undefined = globalThis.caches;

const kName = Symbol("name");
const kCachePromise = Symbol("cachePromise");

export interface CloudflareNativeCache {
	[kName]: string;
	[kCachePromise]: Promise<Cache> | null;
}

/**
 * CloudflareNativeCache - Wrapper around Cloudflare's native Cache API.
 * This allows the native cache to be used with the factory pattern.
 *
 * Note: This must only be used in a Cloudflare Worker context where
 * globalThis.caches is available.
 */
export class CloudflareNativeCache implements Cache {
	constructor(name: string, _options?: Record<string, unknown>) {
		this[kName] = name;
		this[kCachePromise] = null;
	}

	async add(request: RequestInfo | URL): Promise<void> {
		const cache = await getCache(this);
		return cache.add(request);
	}

	async addAll(requests: RequestInfo[]): Promise<void> {
		const cache = await getCache(this);
		return cache.addAll(requests);
	}

	async delete(
		request: RequestInfo | URL,
		options?: CacheQueryOptions,
	): Promise<boolean> {
		const cache = await getCache(this);
		return cache.delete(request, options);
	}

	async keys(
		request?: RequestInfo | URL,
		options?: CacheQueryOptions,
	): Promise<readonly Request[]> {
		const cache = await getCache(this);
		return cache.keys(request, options);
	}

	async match(
		request: RequestInfo | URL,
		options?: CacheQueryOptions,
	): Promise<Response | undefined> {
		const cache = await getCache(this);
		return cache.match(request, options);
	}

	async matchAll(
		request?: RequestInfo | URL,
		options?: CacheQueryOptions,
	): Promise<readonly Response[]> {
		const cache = await getCache(this);
		return cache.matchAll(request, options);
	}

	async put(request: RequestInfo | URL, response: Response): Promise<void> {
		const cache = await getCache(this);
		return cache.put(request, response);
	}
}

function getCache(cache: CloudflareNativeCache): Promise<Cache> {
	if (!cache[kCachePromise]) {
		if (!nativeCaches) {
			throw new Error("Cloudflare caches not available in this context");
		}
		// Use the captured native caches reference, not globalThis.caches
		// which may have been overwritten by ServiceWorkerGlobals
		cache[kCachePromise] = nativeCaches.open(cache[kName]);
	}
	return cache[kCachePromise];
}

export default CloudflareNativeCache;
