import type {Bucket} from "./types.js";

/**
 * BucketStorage implements bucket storage with a configurable factory
 * The factory function receives the bucket name and can return different filesystem types
 * This mirrors the CustomCacheStorage pattern for consistency
 * 
 * Example usage:
 * ```typescript
 * const buckets = new BucketStorage((name) => {
 *   if (name === 'uploads') return new S3FileSystemAdapter('my-bucket');
 *   if (name === 'temp') return new NodeFileSystemAdapter('/tmp');
 *   return new NodeFileSystemAdapter('./dist'); // Default to dist
 * });
 * ```
 */
export class BucketStorage {
	private instances = new Map<string, Bucket>();

	constructor(private factory: (name: string) => Bucket | Promise<Bucket>) {}

	/**
	 * Opens a bucket with the given name
	 * Returns existing instance if already opened, otherwise creates a new one
	 */
	async open(name: string): Promise<FileSystemDirectoryHandle> {
		// Return existing instance if already opened
		const existingInstance = this.instances.get(name);
		if (existingInstance) {
			return await existingInstance.getDirectoryHandle("");
		}

		// Create new instance using factory function
		const adapter = await this.factory(name);
		this.instances.set(name, adapter);
		return await adapter.getDirectoryHandle("");
	}

	/**
	 * Returns true if a bucket with the given name exists (has been opened)
	 */
	async has(name: string): Promise<boolean> {
		return this.instances.has(name);
	}

	/**
	 * Deletes a bucket with the given name
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
	 * Returns a list of all opened bucket names
	 */
	async keys(): Promise<string[]> {
		return Array.from(this.instances.keys());
	}

	/**
	 * Get statistics about the bucket storage
	 */
	getStats() {
		return {
			openInstances: this.instances.size,
			bucketNames: Array.from(this.instances.keys()),
		};
	}

	/**
	 * Dispose of all open adapter instances
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