/**
 * Shared configuration types and defaults for @b9g/assets
 */

/**
 * Configuration for both build plugin and runtime handler
 */
export interface AssetsConfig {
	/**
	 * Directory to output assets
	 * @default 'dist/assets'
	 */
	outputDir?: string;

	/**
	 * Public URL path prefix
	 * @default '/assets/'
	 */
	publicPath?: string;

	/**
	 * Path to asset manifest file
	 * @default 'dist/assets/manifest.json'
	 */
	manifest?: string;

	/**
	 * Length of content hash for cache busting
	 * @default 8
	 */
	hashLength?: number;

	/**
	 * Whether to include content hash in filename
	 * @default true
	 */
	includeHash?: boolean;
}

/**
 * Runtime-specific configuration
 */
export interface RuntimeConfig extends AssetsConfig {
	/**
	 * Whether to run in development mode
	 * In dev mode, serves files directly from source without manifest
	 * @default process.env.NODE_ENV !== 'production'
	 */
	dev?: boolean;

	/**
	 * Source directory for development mode
	 * @default 'src'
	 */
	sourceDir?: string;

	/**
	 * Cache configuration for assets
	 */
	cache?: {
		name?: string;
		ttl?: string | number;
	};
}

/**
 * Asset manifest entry
 */
export interface AssetManifestEntry {
	/** Original file path relative to source */
	source: string;
	/** Output file path relative to outputDir */
	output: string;
	/** Public URL for the asset */
	url: string;
	/** Content hash */
	hash: string;
	/** File size in bytes */
	size: number;
	/** MIME type */
	type?: string;
}

/**
 * Asset manifest structure
 */
export interface AssetManifest {
	/** Assets indexed by their source path */
	assets: Record<string, AssetManifestEntry>;
	/** Generation timestamp */
	generated: string;
	/** Configuration used */
	config: {
		publicPath: string;
		outputDir: string;
	};
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: Required<AssetsConfig> = {
	outputDir: "dist/assets",
	publicPath: "/assets/",
	manifest: "dist/assets/manifest.json",
	hashLength: 8,
	includeHash: true,
};

/**
 * Merge user config with defaults
 */
export function mergeConfig(
	userConfig: AssetsConfig = {},
): Required<AssetsConfig> {
	return {
		...DEFAULT_CONFIG,
		...userConfig,
	};
}

/**
 * Merge runtime config with defaults
 */
export function mergeRuntimeConfig(
	userConfig: RuntimeConfig = {},
): RuntimeConfig & Required<AssetsConfig> {
	const baseConfig = mergeConfig(userConfig);

	return {
		...baseConfig,
		dev: userConfig.dev ?? process.env.NODE_ENV !== "production",
		sourceDir: userConfig.sourceDir ?? "src",
		cache: userConfig.cache,
	};
}
