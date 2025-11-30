/**
 * Assets middleware using self.buckets ServiceWorker API
 *
 * Serves assets with 1-to-1 path mapping from static bucket to public URLs.
 * Static bucket structure mirrors the public URL structure:
 * - static/favicon.ico -> /favicon.ico
 * - static/assets/app.[hash].js -> /assets/app.[hash].js
 * - static/index.html -> /index.html
 */

import type {AssetsConfig} from "./index.js";
import {getMimeType} from "./index.js";
import {getLogger} from "@logtape/logtape";

const logger = getLogger(["assets"]);

/**
 * Assets middleware with 1-to-1 path mapping
 */
export function assets(config: AssetsConfig = {}) {
	const {
		manifestPath = "manifest.json",
		cacheControl = "public, max-age=31536000, immutable",
		mimeTypes = {},
	} = config;

	// Cache for the manifest
	let manifestCache: Record<string, any> | null = null;

	// Load manifest from bucket
	async function loadManifest(): Promise<Record<string, any>> {
		if (manifestCache) return manifestCache;

		const bucketDir = await (self as any).buckets.open("static");
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
		return manifestCache;
	}

	return async function assetsMiddleware(request: Request) {
		try {
			const url = new URL(request.url);
			const requestedPath = url.pathname;

			// Security: prevent directory traversal
			if (requestedPath.includes("..") || requestedPath.includes("//")) {
				return new Response("Forbidden", {status: 403});
			}

			// Load manifest to validate file exists in build
			let manifest: Record<string, any>;
			try {
				manifest = await loadManifest();
			} catch (error) {
				// Manifest not available - pass through to routes
				// This happens when assets aren't configured or bucket doesn't exist
				logger.warn("Assets manifest not available, passing through: {error}", {
					error: error instanceof Error ? error.message : String(error),
				});
				return;
			}

			// Check if file exists in manifest (security: only serve built assets)
			const manifestEntry = manifest[requestedPath];
			if (!manifestEntry) {
				// Only serve files that went through build
				// Pass through to next middleware for 404 handling
				return;
			}

			try {
				// Get file from static bucket using direct path mapping
				// Public URL /assets/app.js → bucket path assets/app.js
				// (bucket root is dist/static/, just strip leading slash from URL)
				const bucketPath = requestedPath.slice(1);
				const bucketDir = await (self as any).buckets.open("static");
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

				logger.error("Assets middleware error", {error});
				return new Response("Internal Server Error", {status: 500});
			}
		} catch (error) {
			logger.error("Assets middleware outer error", {error});
			const message = error instanceof Error ? error.message : String(error);
			return new Response("Assets middleware error: " + message, {
				status: 500,
			});
		}
	};
}
