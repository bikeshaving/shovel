// Helper functions for creating common bucket factory patterns
import {MemoryBucket} from "./memory.js";
import {LocalBucket} from "./node.js";
import type {Bucket} from "./types.js";

export interface BucketConfig {
	/** Filesystem adapter type */
	type: "memory" | "local" | "node" | "s3";
	/** Local filesystem path (for local/node adapters) */
	path?: string;
	/** S3 bucket name (for S3 adapter) */
	bucket?: string;
	/** Additional adapter-specific options */
	options?: Record<string, any>;
}

export interface BucketFactoryConfig {
	/** Bucket name to configuration mapping */
	buckets?: Record<string, BucketConfig>;
	/** Default configuration for unmapped buckets */
	default?: BucketConfig;
}

/**
 * Create a default bucket factory for common use cases
 * 
 * Example usage:
 * ```typescript
 * import {BucketStorage} from "@b9g/filesystem";
 * import {createDefaultBucketFactory} from "@b9g/filesystem";
 * 
 * const bucketStorage = new BucketStorage((name) => {
 *   if (name === 'uploads') return new S3Bucket('my-bucket');
 *   if (name === 'temp') return new LocalBucket('/tmp');
 *   return new LocalBucket('./dist'); // Default to dist
 * });
 * ```
 */
export function createDefaultBucketFactory(): (name: string) => Bucket {
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
 * Create a simple bucket factory that uses local filesystem with path mapping
 */
export function createLocalBucketFactory(pathMap: Record<string, string> = {}): (name: string) => Bucket {
	return (name: string): Bucket => {
		const path = pathMap[name] || `./dist`;
		return new LocalBucket(path);
	};
}

/**
 * Create a bucket factory that uses memory filesystem for all buckets
 */
export function createMemoryBucketFactory(): (name: string) => Bucket {
	return (_name: string): Bucket => {
		return new MemoryBucket();
	};
}