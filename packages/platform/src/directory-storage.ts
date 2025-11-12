/**
 * Bucket Storage implementation for ServiceWorker self.buckets API
 *
 * This implements the proposed web standard interface that parallels CacheStorage
 * for structured filesystem access in ServiceWorkers.
 */

import {
	CustomBucketStorage,
	type BucketFactory,
	NodeBucket,
	FileSystemRegistry,
} from "@b9g/filesystem";
import * as fs from "fs/promises";

/**
 * Platform-agnostic bucket storage implementation using CustomBucketStorage
 *
 * Provides a default factory that checks FileSystemRegistry for registered buckets
 * and creates on-demand NodeBuckets for unregistered names.
 *
 * This is a convenience class - platforms can also create CustomBucketStorage directly
 * with their own factories.
 */
export class PlatformBucketStorage extends CustomBucketStorage {
	constructor(rootPath: string = "./dist") {
		// Create factory that checks FileSystemRegistry first
		const factory: BucketFactory = async (name: string) => {
			// Check FileSystemRegistry first (for well-known buckets like 'tmp', 'dist')
			const registered = FileSystemRegistry.get(name);
			if (registered) {
				return registered;
			}

			// Create new instance on-demand for unregistered names
			const targetPath =
				name === "" || name === "/" || name === "."
					? rootPath
					: `${rootPath}/${name}`;

			// Ensure the directory exists on disk
			await fs.mkdir(targetPath, {recursive: true});

			return new NodeBucket(targetPath);
		};

		super(factory);
	}
}
