/**
 * Worker-Aware CacheStorage
 *
 * Intelligently chooses between coordinated and direct cache access:
 * - MemoryCache: Uses CoordinatedMemoryCache (PostMessage coordination)
 * - Other caches: Uses direct access (FilesystemCache, SQLiteCache, etc.)
 */

import {isMainThread} from "worker_threads";
import type {Cache} from "./cache.js";

type CacheFactory = () => Promise<Cache> | Cache;

export class WorkerAwareCacheStorage {
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
			if (
				"dispose" in existingInstance &&
				typeof existingInstance.dispose === "function"
			) {
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

		// If we're in a worker thread and this is a MemoryCache, wrap it with coordination
		if (!isMainThread && this.isMemoryCache(cache)) {
			const {CoordinatedMemoryCache} = await import(
				"./coordinated-memory-cache.js"
			);
			const coordinatedCache = new CoordinatedMemoryCache(
				name,
				(cache as any).options || {},
			);
			this.instances.set(name, coordinatedCache);
			return coordinatedCache;
		}

		// For non-MemoryCache or main thread, use direct access
		this.instances.set(name, cache);
		return cache;
	}

	/**
	 * Check if a cache instance is a MemoryCache
	 */
	private isMemoryCache(cache: Cache): boolean {
		return cache.constructor.name === "MemoryCache";
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
			if ("dispose" in instance && typeof instance.dispose === "function") {
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
	getStats(): {
		registeredCaches: number;
		openInstances: number;
		cacheNames: string[];
	} {
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
			if ("dispose" in instance && typeof instance.dispose === "function") {
				disposePromises.push(instance.dispose());
			}
		}

		await Promise.all(disposePromises);
		this.instances.clear();
	}
}
