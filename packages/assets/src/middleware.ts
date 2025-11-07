/**
 * Assets middleware using self.buckets ServiceWorker API
 *
 * Runtime middleware that serves assets from structured buckets
 * using the new self.buckets.open(name) web standard API.
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
			// Debug: check what directories are available
			console.log("[rootAssetsMiddleware] Checking directories...");
			try {
				const rootDir = await (self as any).buckets.open("");
				const rootKeys = [];
				for await (const [name] of rootDir.entries()) {
					rootKeys.push(name);
				}
				console.log("[rootAssetsMiddleware] Root directory contents:", rootKeys);
			} catch (e) {
				console.log("[rootAssetsMiddleware] Error reading root:", e.message);
			}

			// Try to load manifest from assets directory first, then root
			let manifestFile;
			try {
				console.log("[rootAssetsMiddleware] Trying assets directory...");
				const assetsDir = await (self as any).buckets.open("assets");
				const manifestHandle = await assetsDir.getFileHandle(manifestPath);
				manifestFile = await manifestHandle.getFile();
				console.log("[rootAssetsMiddleware] Found manifest in assets directory");
			} catch (e) {
				console.log("[rootAssetsMiddleware] Assets directory failed:", e.message);
				// Fallback to root directory
				console.log("[rootAssetsMiddleware] Trying root directory...");
				const rootDir = await (self as any).buckets.open("");
				const manifestHandle = await rootDir.getFileHandle(manifestPath);
				manifestFile = await manifestHandle.getFile();
				console.log("[rootAssetsMiddleware] Found manifest in root directory");
			}
			
			const manifestText = await manifestFile.text();
			const manifest = JSON.parse(manifestText);

			// Convert manifest.assets to URL lookup map for root-level assets
			const urlMap: Record<string, any> = {};

			if (manifest.assets) {
				for (const [, entry] of Object.entries(manifest.assets)) {
					if (entry && typeof entry === "object" && "url" in entry) {
						const url = entry.url as string;
						console.log("[rootAssetsMiddleware] Processing manifest entry:", url);
						// Only include assets with root-level URLs (start with /)
						if (url.startsWith("/") && !url.includes("/", 1)) {
							const filename = url.slice(1); // Remove leading /
							if (filename) {
								console.log("[rootAssetsMiddleware] Adding to urlMap:", filename, "->", entry);
								urlMap[filename] = entry;
							}
						} else {
							console.log("[rootAssetsMiddleware] Skipping non-root URL:", url);
						}
					}
				}
			}

			console.log("[rootAssetsMiddleware] Final urlMap keys:", Object.keys(urlMap));

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
			console.log("[rootAssetsMiddleware] Processing:", url.pathname);

			// Only handle root-level requests (no subdirectories)
			if (url.pathname.includes("/", 1)) {
				// Pass through to next middleware
				console.log("[rootAssetsMiddleware] Has subdirectories, passing through");
				const response = yield request;
				return response;
			}

			// Extract filename (remove leading slash)
			const requestedFilename = url.pathname.slice(1);
			console.log("[rootAssetsMiddleware] Requested filename:", requestedFilename);
			
			// Skip empty path (let index handling middleware deal with it)
			if (!requestedFilename) {
				console.log("[rootAssetsMiddleware] Empty path, passing through");
				const response = yield request;
				return response;
			}

			// Security: prevent directory traversal
			if (requestedFilename.includes("..") || requestedFilename.includes("/")) {
				return new Response("Forbidden", {status: 403});
			}

			try {
				// Load manifest to validate file exists in build
				console.log("[rootAssetsMiddleware] Loading manifest...");
				const manifest = await loadManifest();
				console.log("[rootAssetsMiddleware] Manifest keys:", Object.keys(manifest));

				// Check if file exists in manifest (security: only serve built assets)
				const manifestEntry = manifest[requestedFilename];
				console.log("[rootAssetsMiddleware] Manifest entry for", requestedFilename, ":", manifestEntry);
				if (!manifestEntry && !dev) {
					// In production, only serve files that went through build
					console.log("[rootAssetsMiddleware] Not in manifest and not dev, passing through");
					const response = yield request;
					return response;
				}

				// Try to get file from assets directory first, then root
				let fileHandle;
				try {
					console.log("[rootAssetsMiddleware] Trying assets directory...");
					const assetsDir = await (self as any).buckets.open("assets");
					console.log("[rootAssetsMiddleware] Assets directory opened successfully");
					
					// Debug: list what files are actually available
					const availableFiles = [];
					for await (const [name] of assetsDir.entries()) {
						availableFiles.push(name);
					}
					console.log("[rootAssetsMiddleware] Available files in assets dir:", availableFiles);
					
					// Check if there's a nested assets directory
					if (availableFiles.includes("assets")) {
						console.log("[rootAssetsMiddleware] Found nested assets directory, checking inside...");
						const nestedAssetsDir = await assetsDir.getDirectoryHandle("assets");
						const nestedFiles = [];
						for await (const [name] of nestedAssetsDir.entries()) {
							nestedFiles.push(name);
						}
						console.log("[rootAssetsMiddleware] Files in nested assets dir:", nestedFiles);
						
						// Try to get file from nested assets directory
						try {
							fileHandle = await nestedAssetsDir.getFileHandle(requestedFilename);
							console.log("[rootAssetsMiddleware] Found file in nested assets directory:", requestedFilename);
						} catch {
							fileHandle = await assetsDir.getFileHandle(requestedFilename);
						}
					} else {
						fileHandle = await assetsDir.getFileHandle(requestedFilename);
					}
					console.log("[rootAssetsMiddleware] Found file in assets directory:", requestedFilename);
				} catch (error) {
					console.log("[rootAssetsMiddleware] Assets directory failed:", error.message);
					// Fallback to root directory
					console.log("[rootAssetsMiddleware] Trying root directory...");
					try {
						const rootDir = await (self as any).buckets.open("");
						fileHandle = await rootDir.getFileHandle(requestedFilename);
						console.log("[rootAssetsMiddleware] Found file in root directory:", requestedFilename);
					} catch (rootError) {
						console.log("[rootAssetsMiddleware] Root directory also failed:", rootError.message);
						throw rootError;
					}
				}
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
 * Create assets middleware using self.buckets API
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
			// Use self.buckets to access the assets directory
			const assetsDir = await (self as any).buckets.open(directory);
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

			// Get assets directory using self.buckets
			const assetsDir = await (self as any).buckets.open(directory);

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