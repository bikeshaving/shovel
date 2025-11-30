/**
 * Assets middleware using self.buckets ServiceWorker API
 *
 * Serves assets with 1-to-1 path mapping from static bucket to public URLs.
 * Static bucket structure mirrors the public URL structure:
 * - static/favicon.ico -> /favicon.ico
 * - static/assets/app.[hash].js -> /assets/app.[hash].js
 * - static/index.html -> /index.html
 *
 * Manifest is read from the server bucket (not publicly servable).
 */

import type {AssetManifestEntry} from "./index.js";
import mime from "mime";

/**
 * Assets middleware with 1-to-1 path mapping
 *
 * No try/catch - errors propagate up. If manifest doesn't exist, fail loudly.
 */
export interface AssetsMiddlewareConfig {
	/** Path to asset manifest file (default: 'manifest.json') */
	manifestPath?: string;
	/** Cache control header value (default: 'public, max-age=31536000, immutable') */
	cacheControl?: string;
}

export function assets(config: AssetsMiddlewareConfig = {}) {
	const {
		manifestPath = "manifest.json",
		cacheControl = "public, max-age=31536000, immutable",
	} = config;

	// Cache for manifest data
	let manifestEntries: Map<string, AssetManifestEntry> | null = null;

	// Load manifest from server bucket (not static - keeps it non-public)
	async function loadManifest(): Promise<Map<string, AssetManifestEntry>> {
		if (manifestEntries) return manifestEntries;

		// Read manifest from server bucket
		const serverBucket = await (self as any).buckets.open("server");
		const manifestHandle = await serverBucket.getFileHandle(manifestPath);
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

		// Get file from static bucket
		// Public URL /assets/app.js → bucket path assets/app.js
		// FileSystem API requires navigating directories, not path strings
		const bucketPath = requestedPath.slice(1);
		const pathParts = bucketPath.split("/");
		const filename = pathParts.pop()!;

		const staticBucket = await (self as any).buckets.open("static");

		// Navigate through directories
		let dirHandle = staticBucket;
		for (const dirName of pathParts) {
			dirHandle = await dirHandle.getDirectoryHandle(dirName);
		}

		const fileHandle = await dirHandle.getFileHandle(filename);
		const file = await fileHandle.getFile();

		// Use content type from manifest if available, otherwise detect
		const contentType =
			manifestEntry.type || mime.getType(requestedPath) || "application/octet-stream";

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
