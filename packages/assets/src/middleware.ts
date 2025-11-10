/**
 * Assets middleware using self.buckets ServiceWorker API
 *
 * Serves assets with 1-to-1 path mapping from assets bucket to public URLs.
 * Assets bucket structure mirrors the public URL structure:
 * - /assets/favicon.ico -> /favicon.ico
 * - /assets/static/app.[hash].js -> /static/app.[hash].js
 * - /assets/index.html -> /index.html
 */

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
 * Default MIME type mappings for assets
 */
const DEFAULT_MIME_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".css": "text/css",
	".js": "application/javascript",
	".mjs": "application/javascript",
	".json": "application/json",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".eot": "application/vnd.ms-fontobject",
	".pdf": "application/pdf",
	".txt": "text/plain",
	".xml": "application/xml",
	".zip": "application/zip",
	".webp": "image/webp",
	".avif": "image/avif",
	".mp4": "video/mp4",
	".webm": "video/webm",
	".mp3": "audio/mpeg",
	".wav": "audio/wav",
	".ogg": "audio/ogg",
};

/**
 * Get MIME type for a file path
 */
function getMimeType(
	filePath: string,
	customTypes: Record<string, string> = {},
): string {
	const ext = "." + filePath.split(".").pop()?.toLowerCase();
	return (
		customTypes[ext] || DEFAULT_MIME_TYPES[ext] || "application/octet-stream"
	);
}

/**
 * Assets middleware with 1-to-1 path mapping
 */
export function assets(config: AssetsConfig = {}) {
	const {
		manifestPath = "manifest.json",
		cacheControl = config.dev ? "no-cache" : "public, max-age=31536000",
		dev = false,
		mimeTypes = {},
	} = config;

	// Cache for the manifest
	let manifestCache: Record<string, any> | null = null;
	let manifestError: string | null = null;

	// Load manifest from bucket
	async function loadManifest(): Promise<Record<string, any>> {
		if (manifestCache) return manifestCache;
		if (manifestError && !dev) throw new Error(manifestError);

		try {
			const bucketDir = await (self as any).buckets.open("assets");
			const manifestHandle = await bucketDir.getFileHandle(manifestPath);
			const manifestFile = await manifestHandle.getFile();
			const manifestText = await manifestFile.text();
			const manifest = JSON.parse(manifestText);

			// Convert manifest.assets to URL path lookup map
			const urlMap: Record<string, any> = {};

			if (manifest.assets) {
				for (const [, entry] of Object.entries(manifest.assets)) {
					if (entry && typeof entry === "object" && "url" in entry) {
						const url = entry.url as string;
						// Map public URL directly to manifest entry
						urlMap[url] = entry;
					}
				}
			}

			manifestCache = urlMap;
			manifestError = null;
			return manifestCache!;
		} catch (error) {
			manifestError = `Failed to load manifest: ${error.message}`;
			if (dev) {
				return {}; // Empty manifest in dev mode
			}
			throw new Error(manifestError);
		}
	}

	return async function* assetsMiddleware(request: Request, context: any) {
		try {
			const url = new URL(request.url);
			const requestedPath = url.pathname;

			// Security: prevent directory traversal
			if (requestedPath.includes("..") || requestedPath.includes("//")) {
				return new Response("Forbidden", {status: 403});
			}

			try {
				// Load manifest to validate file exists in build
				const manifest = await loadManifest();

				// Check if file exists in manifest (security: only serve built assets)
				const manifestEntry = manifest[requestedPath];
				if (!manifestEntry && !dev) {
					// In production, only serve files that went through build
					// Pass through to next middleware for 404 handling
					const response = yield request;
					return response;
				}

				// Get file from assets bucket using direct path mapping
				// Public path /static/app.js maps to assets/static/app.js in bucket
				const bucketPath = `assets${requestedPath}`;
				const bucketDir = await (self as any).buckets.open("assets");
				const fileHandle = await bucketDir.getFileHandle(bucketPath);
				const file = await fileHandle.getFile();

				// Use content type from manifest if available, otherwise detect
				const contentType =
					manifestEntry?.type || getMimeType(requestedPath, mimeTypes);

				// Create response headers
				const headers = new Headers({
					"Content-Type": contentType,
					"Content-Length":
						manifestEntry?.size?.toString() || file.size.toString(),
					"Cache-Control": cacheControl,
					"Last-Modified": new Date(file.lastModified).toUTCString(),
				});

				// Add hash-based ETag if available
				if (manifestEntry?.hash) {
					headers.set("ETag", `"${manifestEntry.hash}"`);
				}

				// Handle conditional requests
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
			} catch (error) {
				if ((error as any).name === "NotFoundError") {
					return new Response("Not Found", {status: 404});
				}

				console.error("[assetsMiddleware] Error:", error);
				return new Response("Internal Server Error", {status: 500});
			}
		} catch (error) {
			console.error("[assetsMiddleware] Outer error:", error);
			return new Response("Assets middleware error: " + error.message, {status: 500});
		}
	};
}


