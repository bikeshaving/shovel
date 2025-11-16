/**
 * @b9g/assets - Universal assets processing and serving
 */

import mime from "mime";

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
	/** Custom MIME type mappings */
	mimeTypes?: Record<string, string>;
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
		publicPath: string;
		outputDir: string;
	};
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Get MIME type for a file path
 * Uses mime package for comprehensive type detection with custom overrides
 */
export function getMimeType(
	filePath: string,
	customTypes: Record<string, string> = {},
): string {
	// Check custom types first
	const ext = "." + filePath.split(".").pop()?.toLowerCase();
	if (customTypes[ext]) {
		return customTypes[ext];
	}

	// Use mime package for comprehensive detection
	return mime.getType(filePath) || "application/octet-stream";
}
