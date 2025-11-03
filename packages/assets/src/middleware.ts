/**
 * Assets middleware using self.dirs ServiceWorker API
 *
 * Runtime middleware that serves assets from structured directories
 * using the new self.dirs.open(name) web standard API.
 */

export interface AssetsConfig {
	/** Directory name for assets (default: 'assets') */
	directory?: string;
	/** Base path for assets (default: '/assets') */
	basePath?: string;
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
 * Create root assets middleware that serves assets from root directory
 * Useful for favicon.ico, robots.txt, and other root-level assets
 */
export function createRootAssetsMiddleware(config: Omit<AssetsConfig, 'basePath'> = {}) {
	const {
		directory = "", // Use root directory
		manifestPath = "manifest.json",
		cacheControl = config.dev ? "no-cache" : "public, max-age=31536000",
		dev = false,
		mimeTypes = {},
	} = config;

	// Cache for the manifest
	let manifestCache: Record<string, any> | null = null;
	let manifestError: string | null = null;

	// Load manifest from root or assets directory
	async function loadManifest(): Promise<Record<string, any>> {
		if (manifestCache) return manifestCache;
		if (manifestError && !dev) throw new Error(manifestError);

		try {
			// Use self.dirs to access the root directory
			const rootDir = await (self as any).dirs.open("");
			const manifestHandle = await rootDir.getFileHandle(manifestPath);
			const manifestFile = await manifestHandle.getFile();
			const manifestText = await manifestFile.text();
			const manifest = JSON.parse(manifestText);

			// Convert manifest.assets to URL lookup map for root-level assets
			const urlMap: Record<string, any> = {};

			if (manifest.assets) {
				for (const [, entry] of Object.entries(manifest.assets)) {
					if (entry && typeof entry === "object" && "url" in entry) {
						const url = entry.url as string;
						// Only include assets with root-level URLs (start with /)
						if (url.startsWith("/") && !url.includes("/", 1)) {
							const filename = url.slice(1); // Remove leading /
							if (filename) {
								urlMap[filename] = entry;
							}
						}
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

	return async function* rootAssetsMiddleware(request: Request, context: any) {
		try {
			const url = new URL(request.url);

			// Only handle root-level requests (no subdirectories)
			if (url.pathname.includes("/", 1)) {
				// Pass through to next middleware
				const response = yield request;
				return response;
			}

			// Extract filename (remove leading slash)
			const requestedFilename = url.pathname.slice(1);
			
			// Skip empty path (let index handling middleware deal with it)
			if (!requestedFilename) {
				const response = yield request;
				return response;
			}

			// Security: prevent directory traversal
			if (requestedFilename.includes("..") || requestedFilename.includes("/")) {
				return new Response("Forbidden", {status: 403});
			}

			try {
				// Load manifest to validate file exists in build
				const manifest = await loadManifest();

				// Check if file exists in manifest (security: only serve built assets)
				const manifestEntry = manifest[requestedFilename];
				if (!manifestEntry && !dev) {
					// In production, only serve files that went through build
					const response = yield request;
					return response;
				}

				// Get root directory using self.dirs
				const rootDir = await (self as any).dirs.open("");

				// Get file handle
				const fileHandle = await rootDir.getFileHandle(requestedFilename);
				const file = await fileHandle.getFile();

				// Use content type from manifest if available, otherwise detect
				const contentType =
					manifestEntry?.type || getMimeType(requestedFilename, mimeTypes);

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
					// File not found, pass through to next middleware
					const response = yield request;
					return response;
				}

				console.error("[rootAssetsMiddleware] Error:", error);
				return new Response("Internal Server Error", {status: 500});
			}
		} catch (error) {
			console.error("[rootAssetsMiddleware] Outer error:", error);
			return new Response("Root assets middleware error: " + error.message, {status: 500});
		}
	};
}

/**
 * Create assets middleware using self.dirs API
 */
export function createAssetsMiddleware(config: AssetsConfig = {}) {
	const {
		directory = "assets",
		basePath = "/assets",
		manifestPath = "manifest.json",
		cacheControl = config.dev ? "no-cache" : "public, max-age=31536000",
		dev = false,
		mimeTypes = {},
	} = config;

	// Cache for the manifest
	let manifestCache: Record<string, any> | null = null;
	let manifestError: string | null = null;

	// Load manifest from assets directory
	async function loadManifest(): Promise<Record<string, any>> {
		if (manifestCache) return manifestCache;
		if (manifestError && !dev) throw new Error(manifestError);

		try {
			// Use self.dirs to access the assets directory
			const assetsDir = await (self as any).dirs.open(directory);
			const manifestHandle = await assetsDir.getFileHandle(manifestPath);
			const manifestFile = await manifestHandle.getFile();
			const manifestText = await manifestFile.text();
			const manifest = JSON.parse(manifestText);

			// Convert manifest.assets to URL lookup map
			// manifest.assets[sourcePath] = { url, output, hash, size, type }
			const urlMap: Record<string, any> = {};

			if (manifest.assets) {
				for (const [, entry] of Object.entries(manifest.assets)) {
					if (entry && typeof entry === "object" && "url" in entry) {
						// Extract filename from URL (remove base path)
						const url = entry.url as string;
						const filename = url.split("/").pop();
						if (filename) {
							urlMap[filename] = entry;
						}
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
			console.log("[assetsMiddleware] Processing request:", request.url, typeof request.url);
			console.log("[assetsMiddleware] Request type:", typeof request);
			const url = new URL(request.url);

			// Only handle requests that start with our base path
			if (!url.pathname.startsWith(basePath)) {
				// Pass through to next middleware
				console.log("[assetsMiddleware] Not an assets request, passing through");
				const response = yield request;
				return response;
			}

		// Extract the file path relative to base path
		const requestedPath = url.pathname.slice(basePath.length);

		// Security: prevent directory traversal
		if (requestedPath.includes("..") || requestedPath.includes("//")) {
			return new Response("Forbidden", {status: 403});
		}

		// Remove leading slash and handle empty path
		const requestedFilename = requestedPath.replace(/^\/+/, "") || "index.html";

		try {
			// Load manifest to validate file exists in build
			const manifest = await loadManifest();

			// Check if file exists in manifest (security: only serve built assets)
			const manifestEntry = manifest[requestedFilename];
			if (!manifestEntry && !dev) {
				// In production, only serve files that went through build
				return new Response("Not Found", {status: 404});
			}

			// Get assets directory using self.dirs
			const assetsDir = await (self as any).dirs.open(directory);

			// Get file handle (serve requested filename directly)
			const fileHandle = await assetsDir.getFileHandle(requestedFilename);
			const file = await fileHandle.getFile();

			// Use content type from manifest if available, otherwise detect
			const contentType =
				manifestEntry?.type || getMimeType(requestedFilename, mimeTypes);

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

			// Return file response (early return - no yield needed)
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


/**
 * Default export for convenience
 */
export default createAssetsMiddleware;