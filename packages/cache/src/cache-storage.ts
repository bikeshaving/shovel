import type {Cache} from "./cache.js";

/**
 * Factory function for creating Cache instances
 */
export type CacheFactory = () => Cache | Promise<Cache>;

/**
 * CacheStorage provides a registry for managing named caches
 * Implements a factory pattern where different cache types can be registered
 * and instances are created lazily when first opened
 */
export class CacheStorage {
	private factories = new Map<string, CacheFactory>();
	private instances = new Map<string, Cache>();

	/**
	 * Register a factory function for creating caches with the given name
	 */
	register(name: string, factory: CacheFactory): void {
		this.factories.set(name, factory);

		// If there's already an instance, dispose of it
		const existingInstance = this.instances.get(name);
		if (existingInstance) {
			if (existingInstance.dispose) {
				existingInstance.dispose().catch(console.error);
			}
			this.instances.delete(name);
		}
	}

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

		// Create new instance using registered factory
		const factory = this.factories.get(name);
		if (!factory) {
			throw new Error(
				`No cache factory registered for '${name}'. Available caches: ${Array.from(this.factories.keys()).join(", ")}`,
			);
		}

		const cache = await factory();
		this.instances.set(name, cache);
		return cache;
	}

	/**
	 * Returns true if a cache with the given name exists (is registered)
	 */
	async has(name: string): Promise<boolean> {
		return this.factories.has(name);
	}

	/**
	 * Deletes a cache with the given name
	 * Disposes of the instance if it exists and removes the factory registration
	 */
	async delete(name: string): Promise<boolean> {
		const instance = this.instances.get(name);
		if (instance) {
			if (instance.dispose) {
				await instance.dispose();
			}
			this.instances.delete(name);
		}

		const hadFactory = this.factories.has(name);
		this.factories.delete(name);

		return hadFactory;
	}

	/**
	 * Returns a list of all registered cache names
	 */
	async keys(): Promise<string[]> {
		return Array.from(this.factories.keys());
	}

	/**
	 * Get statistics about the cache storage
	 */
	getStats() {
		return {
			registeredCaches: this.factories.size,
			openInstances: this.instances.size,
			cacheNames: Array.from(this.factories.keys()),
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
