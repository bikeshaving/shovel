/**
 * @b9g/assets - Universal assets processing and serving
 */

import mime from "mime";

export interface AssetsConfig {
	/** Path to asset manifest file (default: 'manifest.json') */
	manifestPath?: string;
	/** Cache control header value (default: 'public, max-age=31536000') */
	cacheControl?: string;
	/** Enable development mode with different caching (default: false) */
	dev?: boolean;
	/** Custom MIME type mappings */
	mimeTypes?: Record<string, string>;
}

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
