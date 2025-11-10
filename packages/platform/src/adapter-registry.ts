/**
 * Blessed alias registry for official Shovel adapters
 * Maps short names to full package names for CLI convenience
 */

export interface AdapterModule {
	createCache?: (config: any) => any;
	createFileSystem?: (config: any) => any;
}

/**
 * Official blessed aliases for cache adapters
 */
export const CACHE_ALIASES = {
	memory: "@b9g/cache",
	redis: "@b9g/cache-redis",
	kv: "@b9g/cache-kv",
	cloudflare: "@b9g/cache/cloudflare",
} as const;

/**
 * Official blessed aliases for filesystem adapters
 */
export const FILESYSTEM_ALIASES = {
	memory: "@b9g/filesystem",
	fs: "@b9g/filesystem/node",
	"bun-s3": "@b9g/filesystem/bun-s3",
	s3: "@b9g/filesystem-s3",
	r2: "@b9g/filesystem-r2",
} as const;

/**
 * Resolve a cache adapter name to a package name
 * @param name - Blessed alias (memory, redis) or full package name (@custom/cache)
 * @returns Full package name
 */
export function resolveCacheAdapter(name: string): string {
	// If it starts with @, assume it's a full package name
	if (name.startsWith("@")) {
		return name;
	}

	// Check blessed aliases
	if (name in CACHE_ALIASES) {
		return CACHE_ALIASES[name as keyof typeof CACHE_ALIASES];
	}

	throw new Error(
		`Unknown cache adapter: ${name}. Available aliases: ${Object.keys(CACHE_ALIASES).join(", ")} or use full package name like @custom/cache`,
	);
}

/**
 * Resolve a filesystem adapter name to a package name
 * @param name - Blessed alias (memory, s3) or full package name (@custom/filesystem)
 * @returns Full package name
 */
export function resolveFilesystemAdapter(name: string): string {
	// If it starts with @, assume it's a full package name
	if (name.startsWith("@")) {
		return name;
	}

	// Check blessed aliases
	if (name in FILESYSTEM_ALIASES) {
		return FILESYSTEM_ALIASES[name as keyof typeof FILESYSTEM_ALIASES];
	}

	throw new Error(
		`Unknown filesystem adapter: ${name}. Available aliases: ${Object.keys(FILESYSTEM_ALIASES).join(", ")} or use full package name like @custom/filesystem`,
	);
}

/**
 * Dynamically load a cache adapter
 * @param name - Adapter name (blessed alias or package name)
 * @param config - Adapter configuration
 * @returns Cache instance
 */
export async function loadCacheAdapter(name: string, config: any = {}) {
	const packageName = resolveCacheAdapter(name);

	try {
		const module: AdapterModule = await import(packageName);

		if (!module.createCache) {
			throw new Error(
				`Package ${packageName} does not export a createCache function`,
			);
		}

		return module.createCache(config);
	} catch (error) {
		if (
			error instanceof Error &&
			error.message.includes("Cannot resolve module")
		) {
			throw new Error(
				`Cache adapter '${name}' requires: npm install ${packageName}`,
			);
		}
		throw error;
	}
}

/**
 * Dynamically load a filesystem adapter
 * @param name - Adapter name (blessed alias or package name)
 * @param config - Adapter configuration
 * @returns Filesystem adapter instance
 */
export async function loadFilesystemAdapter(name: string, config: any = {}) {
	const packageName = resolveFilesystemAdapter(name);

	try {
		const module: AdapterModule = await import(packageName);

		if (!module.createFileSystem) {
			throw new Error(
				`Package ${packageName} does not export a createFileSystem function`,
			);
		}

		return module.createFileSystem(config);
	} catch (error) {
		if (
			error instanceof Error &&
			error.message.includes("Cannot resolve module")
		) {
			throw new Error(
				`Filesystem adapter '${name}' requires: npm install ${packageName}`,
			);
		}
		throw error;
	}
}
