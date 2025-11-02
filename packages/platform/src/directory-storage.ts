/**
 * Directory Storage implementation for ServiceWorker self.dirs API
 * 
 * This implements the proposed web standard interface that parallels CacheStorage
 * for structured filesystem access in ServiceWorkers.
 */

import type {DirectoryStorage} from "./service-worker.js";

/**
 * Platform-agnostic directory storage implementation
 * Uses a single root directory with well-known subdirectories
 */
export class PlatformDirectoryStorage implements DirectoryStorage {
	private rootDir: FileSystemDirectoryHandle;
	private cache = new Map<string, FileSystemDirectoryHandle>();

	constructor(rootDir: FileSystemDirectoryHandle) {
		this.rootDir = rootDir;
	}

	/**
	 * Open a named directory - creates if it doesn't exist
	 * Well-known names: 'assets', 'static', 'server', 'client'
	 */
	async open(name: string): Promise<FileSystemDirectoryHandle> {
		// Check cache first
		if (this.cache.has(name)) {
			return this.cache.get(name)!;
		}

		try {
			// Try to get existing directory
			const dirHandle = await this.rootDir.getDirectoryHandle(name);
			this.cache.set(name, dirHandle);
			return dirHandle;
		} catch (error) {
			// Directory doesn't exist, create it
			const dirHandle = await this.rootDir.getDirectoryHandle(name, {create: true});
			this.cache.set(name, dirHandle);
			return dirHandle;
		}
	}

	/**
	 * Check if a named directory exists
	 */
	async has(name: string): Promise<boolean> {
		try {
			await this.rootDir.getDirectoryHandle(name);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Delete a named directory and all its contents
	 */
	async delete(name: string): Promise<boolean> {
		try {
			await this.rootDir.removeEntry(name, {recursive: true});
			this.cache.delete(name);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * List all available directory names
	 */
	async keys(): Promise<string[]> {
		const keys: string[] = [];
		
		try {
			for await (const [name, handle] of this.rootDir.entries()) {
				if (handle.kind === "directory") {
					keys.push(name);
				}
			}
		} catch {
			// If enumeration fails, return empty array
		}
		
		return keys.sort();
	}

	/**
	 * Clear the cache (useful for hot reloading)
	 */
	clearCache(): void {
		this.cache.clear();
	}
}

/**
 * Create a DirectoryStorage instance from a root directory
 */
export function createDirectoryStorage(rootDir: FileSystemDirectoryHandle): DirectoryStorage {
	return new PlatformDirectoryStorage(rootDir);
}