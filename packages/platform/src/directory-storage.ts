/**
 * Bucket Storage implementation for ServiceWorker self.buckets API
 *
 * This implements the proposed web standard interface that parallels CacheStorage
 * for structured filesystem access in ServiceWorkers.
 */

import type {BucketStorage as BucketStorageInterface} from "./service-worker.js";
import {NodeBucket} from "@b9g/filesystem";
import * as fs from "fs/promises";

/**
 * Platform-agnostic bucket storage implementation
 * Uses bucket pattern where each bucket name maps to a separate filesystem root
 */
export class PlatformBucketStorage implements BucketStorageInterface {
	private instances = new Map<string, FileSystemDirectoryHandle>();
	private rootPath: string;

	constructor(rootPath: string = "./dist") {
		this.rootPath = rootPath;
	}

	/**
	 * Open a named bucket - creates if it doesn't exist
	 * Well-known names: 'assets', 'static', 'uploads', 'temp'
	 * Special values: '', '/', '.' return the root bucket
	 */
	async open(name: string): Promise<FileSystemDirectoryHandle> {
		// Return existing instance if already opened
		const existingInstance = this.instances.get(name);
		if (existingInstance) {
			return existingInstance;
		}

		// Create new instance
		const targetPath =
			name === "" || name === "/" || name === "."
				? this.rootPath
				: `${this.rootPath}/${name}`;

		// Ensure the directory exists on disk
		await fs.mkdir(targetPath, {recursive: true});

		const bucket = new NodeBucket(targetPath);
		this.instances.set(name, bucket);
		return bucket;
	}

	/**
	 * Check if a named bucket exists
	 */
	async has(name: string): Promise<boolean> {
		return this.instances.has(name);
	}

	/**
	 * Delete a named bucket and all its contents
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
	 * List all available bucket names
	 */
	async keys(): Promise<string[]> {
		return Array.from(this.instances.keys());
	}

	/**
	 * Alias for open() - for compatibility with File System Access API naming
	 */
	async getDirectoryHandle(name: string): Promise<FileSystemDirectoryHandle> {
		return await this.open(name);
	}
}
