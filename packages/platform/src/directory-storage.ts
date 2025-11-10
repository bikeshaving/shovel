/**
 * Bucket Storage implementation for ServiceWorker self.buckets API
 * 
 * This implements the proposed web standard interface that parallels CacheStorage
 * for structured filesystem access in ServiceWorkers.
 */

import type {BucketStorage as BucketStorageInterface} from "./service-worker.js";
import {BucketStorage, LocalBucket} from "@b9g/filesystem";

/**
 * Platform-agnostic bucket storage implementation
 * Uses bucket pattern where each bucket name maps to a separate filesystem root
 */
export class PlatformBucketStorage implements BucketStorageInterface {
	private buckets: BucketStorage;

	constructor(rootPath: string = "./dist") {
		// Create bucket storage with namespace-specific paths
		this.buckets = new BucketStorage(async (name: string) => {
			const targetPath = (name === '' || name === '/' || name === '.') 
				? rootPath 
				: `${rootPath}/${name}`;
			
			// Create a LocalBucket and return its root directory handle
			const bucket = new LocalBucket({ rootPath: targetPath });
			return await bucket.getDirectoryHandle("");
		});
	}

	/**
	 * Open a named bucket - creates if it doesn't exist
	 * Well-known names: 'assets', 'static', 'uploads', 'temp'
	 * Special values: '', '/', '.' return the root bucket
	 */
	async open(name: string): Promise<FileSystemDirectoryHandle> {
		// Delegate to bucket storage - each name gets its own bucket root
		return await this.buckets.open(name);
	}

	/**
	 * Check if a named bucket exists
	 */
	async has(name: string): Promise<boolean> {
		return await this.buckets.has(name);
	}

	/**
	 * Delete a named bucket and all its contents
	 */
	async delete(name: string): Promise<boolean> {
		return await this.buckets.delete(name);
	}

	/**
	 * List all available bucket names
	 */
	async keys(): Promise<string[]> {
		return await this.buckets.keys();
	}

	/**
	 * Alias for open() - for compatibility with File System Access API naming
	 */
	async getDirectoryHandle(name: string): Promise<FileSystemDirectoryHandle> {
		return await this.open(name);
	}
}

/**
 * Create a BucketStorage instance from a root path
 */
export function createBucketStorage(rootPath: string = "./dist"): BucketStorageInterface {
	return new PlatformBucketStorage(rootPath);
}

