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
	 * Disposes of the instance if it exists
	 */
	async delete(name: string): Promise<boolean> {
		const instance = this.instances.get(name);
		if (instance) {
			if (instance.dispose) {
				await instance.dispose();
			}
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
	 * Dispose of all open cache instances
	 * Useful for cleanup during shutdown
	 */
	async dispose(): Promise<void> {
		const disposePromises: Promise<void>[] = [];

		for (const [_name, instance] of this.instances) {
			if (instance.dispose) {
				disposePromises.push(instance.dispose());
			}
		}

		await Promise.all(disposePromises);
		this.instances.clear();
	}
}
