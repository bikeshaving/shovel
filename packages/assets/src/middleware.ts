/**
 * Assets middleware using self.directories ServiceWorker API
 *
 * Serves assets with 1-to-1 path mapping from public directory to public URLs.
 * Public directory structure mirrors the public URL structure:
 * - public/favicon.ico -> /favicon.ico
 * - public/assets/app.[hash].js -> /assets/app.[hash].js
 * - public/index.html -> /index.html
 *
 * Manifest is read from the server directory (not publicly servable).
 */

import Mime from "mime";

// ============================================================================
// Types
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

/**
 * Runtime configuration for assets middleware
 */
export interface AssetsConfig {
	/** Path to asset manifest file (default: 'assets.json') */
	manifestPath?: string;
	/** Cache control header value (default: 'public, max-age=31536000, immutable') */
	cacheControl?: string;
}

/**
 * Assets middleware
 */
export function assets(config: AssetsConfig = {}) {
	const {
		manifestPath = "assets.json",
		cacheControl = "public, max-age=31536000, immutable",
	} = config;

	// Cache for manifest data
	let manifestEntries: Map<string, AssetManifestEntry> | null = null;

	// Load manifest from server directory (not static - keeps it non-public)
	async function loadManifest(): Promise<Map<string, AssetManifestEntry>> {
		if (manifestEntries) return manifestEntries;

		// Read manifest from server directory
		const serverDir = await self.directories.open("server");
		const manifestHandle = await serverDir.getFileHandle(manifestPath);
		const manifestFile = await manifestHandle.getFile();
		const manifest = JSON.parse(await manifestFile.text());

		// Build URL -> entry map for O(1) lookup
		manifestEntries = new Map();
		if (manifest.assets) {
			for (const entry of Object.values(manifest.assets)) {
				if (entry && typeof entry === "object" && "url" in entry) {
					manifestEntries.set(
						(entry as AssetManifestEntry).url,
						entry as AssetManifestEntry,
					);
				}
			}
		}

		return manifestEntries;
	}

	return async function assetsMiddleware(request: Request) {
		const url = new URL(request.url);
		const requestedPath = url.pathname;

		// Security: prevent directory traversal
		if (requestedPath.includes("..") || requestedPath.includes("//")) {
			return new Response("Forbidden", {
				status: 403,
				headers: {"Content-Type": "text/plain"},
			});
		}

		// Load manifest (throws if missing - app is misconfigured)
		const entries = await loadManifest();

		// Not in manifest - pass through to next middleware
		const manifestEntry = entries.get(requestedPath);
		if (!manifestEntry) {
			return;
		}

		// Get file from public directory
		// Public URL /assets/app.js → directory path assets/app.js
		// FileSystem API requires navigating directories, not path strings
		const dirPath = requestedPath.slice(1);
		const pathParts = dirPath.split("/");
		const filename = pathParts.pop()!;

		const publicDir = await (self as any).directories.open("public");

		// Navigate through directories
		let dirHandle = publicDir;
		for (const dirName of pathParts) {
			dirHandle = await dirHandle.getDirectoryHandle(dirName);
		}

		const fileHandle = await dirHandle.getFileHandle(filename);
		const file = await fileHandle.getFile();

		// Use content type from manifest if available, otherwise detect
		const contentType =
			manifestEntry.type ||
			Mime.getType(requestedPath) ||
			"application/octet-stream";

		// Create response headers
		const headers = new Headers({
			"Content-Type": contentType,
			"Content-Length": manifestEntry.size?.toString() || file.size.toString(),
			"Cache-Control": cacheControl,
			"Last-Modified": new Date(file.lastModified).toUTCString(),
		});

		// Add hash-based ETag if available
		if (manifestEntry.hash) {
			headers.set("ETag", `"${manifestEntry.hash}"`);
		}

		// Handle conditional requests (304 Not Modified)
		const ifModifiedSince = request.headers.get("if-modified-since");
		if (ifModifiedSince) {
			const modifiedSince = new Date(ifModifiedSince);
			const lastModified = new Date(file.lastModified);
			if (lastModified <= modifiedSince) {
				return new Response(null, {
					status: 304,
					headers: new Headers({
						"Cache-Control": cacheControl,
						"Last-Modified": headers.get("Last-Modified")!,
					}),
				});
			}
		}

		// Return file response
		return new Response(file.stream(), {
			status: 200,
			headers,
		});
	};
}
