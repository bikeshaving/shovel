// Helper functions for creating common bucket factory patterns
import {MemoryBucket} from "./memory.js";
import {LocalBucket} from "./node.js";
import type {Bucket} from "./types.js";

export interface DirectoryConfig {
	/** Filesystem adapter type */
	type: "memory" | "local" | "node" | "s3";
	/** Local filesystem path (for local/node adapters) */
	path?: string;
	/** S3 bucket name (for S3 adapter) */
	bucket?: string;
	/** Additional adapter-specific options */
	options?: Record<string, any>;
}

export interface DirectoryFactoryConfig {
	/** Directory name to configuration mapping */
	directories?: Record<string, DirectoryConfig>;
	/** Default configuration for unmapped directories */
	default?: DirectoryConfig;
}

/**
 * Create a default directory factory for common use cases
 * 
 * Example usage:
 * ```typescript
 * import {CustomDirectoryStorage} from "@b9g/filesystem";
 * import {createDefaultDirectoryFactory} from "@b9g/filesystem";
 * 
 * const directoryStorage = new CustomDirectoryStorage((name) => {
 *   if (name === 'uploads') return new S3FileSystemAdapter('my-bucket');
 *   if (name === 'temp') return new NodeFileSystemAdapter('/tmp');
 *   return new NodeFileSystemAdapter('./dist'); // Default to dist
 * });
 * ```
 */
export function createDefaultDirectoryFactory(): (name: string) => Bucket {
	return (name: string): Bucket => {
		switch (name) {
			case "uploads":
				return new LocalBucket("./uploads");
			case "temp":
				return new LocalBucket("/tmp");
			default:
				return new LocalBucket("./dist");
		}
	};
}

/**
 * Create a simple directory factory that uses local filesystem with path mapping
 */
export function createLocalDirectoryFactory(pathMap: Record<string, string> = {}): (name: string) => Bucket {
	return (name: string): Bucket => {
		const path = pathMap[name] || `./dist`;
		return new LocalBucket(path);
	};
}

/**
 * Create a directory factory that uses memory filesystem for all directories
 */
export function createMemoryDirectoryFactory(): (name: string) => Bucket {
	return (_name: string): Bucket => {
		return new MemoryBucket();
	};
}