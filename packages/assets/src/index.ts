/**
 * @b9g/assets - Universal assets processing and serving
 */

// ============================================================================
// Runtime Types (for middleware)
// ============================================================================

/**
 * Runtime configuration for assets middleware
 */
export interface AssetsConfig {
	/** Path to asset manifest file (default: 'manifest.json') */
	manifestPath?: string;
	/** Cache control header value (default: 'public, max-age=31536000, immutable') */
	cacheControl?: string;
}

// ============================================================================
// Manifest Types (shared between build and runtime)
// ============================================================================

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
		outDir: string;
	};
}
