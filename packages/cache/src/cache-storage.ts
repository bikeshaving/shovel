import type {Cache} from "./cache.js";

/**
 * Factory function for creating Cache instances based on cache name
 */
export type CacheFactory = (name: string) => Cache | Promise<Cache>;

/**
 * CustomCacheStorage implements CacheStorage interface with a configurable factory
 * The factory function receives the cache name and can return different cache types
 */
export class CustomCacheStorage {
	private instances = new Map<string, Cache>();

	constructor(private factory: CacheFactory) {}

	/**
	 * Opens a cache with the given name
	 * Returns existing instance if already opened, otherwise creates a new one
	 */
	async open(name: string): Promise<Cache> {
		// Return existing instance if already opened
		const existingInstance = this.instances.get(name);
		if (existingInstance) {
			return existingInstance;
		}

		// Create new instance using factory function
		const cache = await this.factory(name);
		this.instances.set(name, cache);
		return cache;
	}

	/**
	 * Returns true if a cache with the given name exists (has been opened)
	 */
	async has(name: string): Promise<boolean> {
		return this.instances.has(name);
	}

	/**
	 * Deletes a cache with the given name
	 */
	async delete(name: string): Promise<boolean> {
		const instance = this.instances.get(name);
		if (instance) {
			this.instances.delete(name);
			return true;
		}
		return false;
	}

	/**
	 * Returns a list of all opened cache names
	 */
	async keys(): Promise<string[]> {
		return Array.from(this.instances.keys());
	}

	/**
	 * Get statistics about the cache storage
	 */
	getStats() {
		return {
			openInstances: this.instances.size,
			cacheNames: Array.from(this.instances.keys()),
		};
	}

	/**
	 * Handle cache messages from worker threads (PostMessageCache coordination)
	 */
	async handleMessage(worker: any, message: any): Promise<void> {
		const {type, requestId, cacheName} = message;

		try {
			const cache = await this.open(cacheName);
			let result: any;

			switch (type) {
				case "cache:match": {
					const req = new Request(message.request.url, message.request);
					const response = await cache.match(req, message.options);
					result = response
						? {
								status: response.status,
								statusText: response.statusText,
								headers: Object.fromEntries(response.headers),
								body: await response.text(),
							}
						: undefined;
					break;
				}
				case "cache:put": {
					const req = new Request(message.request.url, message.request);
					const res = new Response(message.response.body, message.response);
					await cache.put(req, res);
					result = true;
					break;
				}
				case "cache:delete": {
					const req = new Request(message.request.url, message.request);
					result = await cache.delete(req, message.options);
					break;
				}
				case "cache:keys": {
					const req = message.request
						? new Request(message.request.url, message.request)
						: undefined;
					const keys = await cache.keys(req, message.options);
					result = keys.map((r) => ({
						url: r.url,
						method: r.method,
						headers: Object.fromEntries(r.headers),
					}));
					break;
				}
				case "cache:clear":
					await (cache as any).clear?.();
					result = true;
					break;
			}

			worker.postMessage({type: "cache:response", requestId, result});
		} catch (error: any) {
			worker.postMessage({
				type: "cache:error",
				requestId,
				error: error.message,
			});
		}
	}
}
