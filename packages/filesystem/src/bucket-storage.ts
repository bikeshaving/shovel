/**
 * Custom Bucket Storage implementation
 *
 * Mirrors CustomCacheStorage structure for consistency.
 * Provides a factory-based approach to creating FileSystemDirectoryHandle instances.
 */

/**
 * Factory function type for creating buckets
 * @param name Bucket name to create
 * @returns FileSystemDirectoryHandle (Bucket) instance
 */
export type BucketFactory = (
	name: string,
) => FileSystemDirectoryHandle | Promise<FileSystemDirectoryHandle>;

/**
 * Custom bucket storage with factory-based bucket creation
 *
 * Provides a registry of named buckets (FileSystemDirectoryHandle instances)
 * with lazy instantiation and singleton behavior per bucket name.
 *
 * Mirrors the CustomCacheStorage pattern for consistency across the platform.
 */
export class CustomBucketStorage {
	private instances = new Map<string, FileSystemDirectoryHandle>();

	/**
	 * @param factory Function that creates bucket instances by name
	 */
	constructor(private factory: BucketFactory) {}

	/**
	 * Open a named bucket - creates if it doesn't exist
	 *
	 * @param name Bucket name (e.g., 'tmp', 'dist', 'uploads')
	 * @returns FileSystemDirectoryHandle for the bucket
	 */
	async open(name: string): Promise<FileSystemDirectoryHandle> {
		// Return existing instance if already opened
		const existing = this.instances.get(name);
		if (existing) {
			return existing;
		}

		// Create new instance using factory
		const bucket = await this.factory(name);
		this.instances.set(name, bucket);
		return bucket;
	}

	/**
	 * Check if a named bucket exists
	 *
	 * @param name Bucket name to check
	 * @returns true if bucket has been opened
	 */
	async has(name: string): Promise<boolean> {
		return this.instances.has(name);
	}

	/**
	 * Delete a named bucket
	 *
	 * @param name Bucket name to delete
	 * @returns true if bucket was deleted, false if it didn't exist
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
	 * List all opened bucket names
	 *
	 * @returns Array of bucket names
	 */
	async keys(): Promise<string[]> {
		return Array.from(this.instances.keys());
	}

	/**
	 * Alias for open() - for compatibility with File System Access API naming
	 *
	 * @param name Bucket name
	 * @returns FileSystemDirectoryHandle for the bucket
	 */
	async getDirectoryHandle(name: string): Promise<FileSystemDirectoryHandle> {
		return await this.open(name);
	}

	/**
	 * Get statistics about opened buckets (non-standard utility method)
	 *
	 * @returns Object with bucket statistics
	 */
	getStats() {
		return {
			openInstances: this.instances.size,
			bucketNames: Array.from(this.instances.keys()),
		};
	}
}
