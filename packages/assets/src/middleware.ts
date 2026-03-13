/**
 * Assets middleware using self.directories ServiceWorker API
 *
 * Serves assets with 1-to-1 path mapping from public directory to public URLs.
 * Public directory structure mirrors the public URL structure:
 * - public/favicon.ico -> /favicon.ico
 * - public/assets/app.[hash].js -> /assets/app.[hash].js
 * - public/index.html -> /index.html
 *
 * Manifest is bundled via the shovel:assets virtual module at build time.
 */

import Mime from "mime";

// Dev mode detection - in dev mode, don't cache manifest to support hot reload
const isDev = import.meta.env?.MODE !== "production";

// Lazy import of bundled manifest - only loaded when needed (not during tests)
// In dev mode, we skip caching so hot reload gets fresh manifest
let _bundledManifest: AssetManifest | null = null;
async function getBundledManifest(): Promise<AssetManifest> {
	// In dev mode, always re-import to get fresh manifest after rebuilds
	if (isDev) {
		const mod = await import("shovel:assets");
		return mod.default;
	}
	if (!_bundledManifest) {
		// Dynamic import to defer loading until actually needed
		const mod = await import("shovel:assets");
		_bundledManifest = mod.default;
	}
	return _bundledManifest!;
}

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
	/** Cache control header value (default: 'public, max-age=31536000, immutable') */
	cacheControl?: string;
	/** Override manifest for testing (defaults to bundled shovel:assets) */
	manifest?: AssetManifest;
}

/**
 * Read a file from the public directory using the FileSystem API.
 * Navigates directory handles for each path segment.
 */
async function readPublicFile(requestedPath: string): Promise<File> {
	const dirPath = requestedPath.slice(1);
	const pathParts = dirPath.split("/");
	const filename = pathParts.pop()!;

	const publicDir = await (self as any).directories.open("public");

	let dirHandle = publicDir;
	for (const dirName of pathParts) {
		dirHandle = await dirHandle.getDirectoryHandle(dirName);
	}

	const fileHandle = await dirHandle.getFileHandle(filename);
	return fileHandle.getFile();
}

/**
 * Assets middleware
 */
export function assets(config: AssetsConfig = {}) {
	const {cacheControl = "public, max-age=31536000, immutable"} = config;

	// Build URL -> entry map for O(1) lookup (computed once per middleware instance)
	// In dev mode, we skip caching so hot reload gets fresh manifest
	let manifestEntries: Map<string, AssetManifestEntry> | null = null;

	// Load manifest from config or bundled shovel:assets virtual module
	async function loadManifest(): Promise<Map<string, AssetManifestEntry>> {
		// In dev mode, skip cache to support hot reload
		if (!isDev && manifestEntries) return manifestEntries;

		// Use config manifest (for testing) or load from bundled module
		const manifest = config.manifest ?? (await getBundledManifest());

		// Build URL -> entry map for O(1) lookup
		const entries = new Map<string, AssetManifestEntry>();
		if (manifest.assets) {
			for (const entry of Object.values(manifest.assets)) {
				if (entry && typeof entry === "object" && "url" in entry) {
					entries.set(
						(entry as AssetManifestEntry).url,
						entry as AssetManifestEntry,
					);
				}
			}
		}

		// Only cache in production mode
		if (!isDev) {
			manifestEntries = entries;
		}

		return entries;
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

		// Load manifest (bundled at build time via shovel:assets)
		const entries = await loadManifest();

		// Serve manifested assets (hashed filenames, immutable cache)
		const manifestEntry = entries.get(requestedPath);
		if (manifestEntry) {
			const file = await readPublicFile(requestedPath);

			const contentType =
				manifestEntry.type ||
				Mime.getType(requestedPath) ||
				"application/octet-stream";

			const headers = new Headers({
				"Content-Type": contentType,
				"Content-Length":
					manifestEntry.size?.toString() || file.size.toString(),
				"Cache-Control": cacheControl,
				"Last-Modified": new Date(file.lastModified).toUTCString(),
			});

			if (manifestEntry.hash) {
				headers.set("ETag", `"${manifestEntry.hash}"`);
			}

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

			return new Response(file.stream(), {status: 200, headers});
		}

		// Fallback: serve static files from public directory (copied from ./public/)
		// Only try for URLs that look like files (have an extension)
		const lastSegment = requestedPath.split("/").pop() || "";
		if (!lastSegment.includes(".")) return;

		try {
			const file = await readPublicFile(requestedPath);

			const contentType =
				Mime.getType(requestedPath) || "application/octet-stream";
			const etag = `"${file.lastModified.toString(36)}-${file.size.toString(36)}"`;

			// Handle conditional requests (304 Not Modified)
			const ifNoneMatch = request.headers.get("if-none-match");
			if (ifNoneMatch === etag) {
				return new Response(null, {
					status: 304,
					headers: new Headers({
						"Cache-Control": "public, max-age=3600",
						ETag: etag,
					}),
				});
			}

			return new Response(file.stream(), {
				status: 200,
				headers: new Headers({
					"Content-Type": contentType,
					"Content-Length": file.size.toString(),
					"Cache-Control": "public, max-age=3600",
					"Last-Modified": new Date(file.lastModified).toUTCString(),
					ETag: etag,
				}),
			});
		} catch (_notFound) {
			// File doesn't exist in public directory — pass through
			return;
		}
	};
}
