import {readFileSync, existsSync, statSync} from "fs";
import {join} from "path";
import {lookup} from "mime-types";
import type {RuntimeConfig, AssetManifest} from "./shared.js";
import {mergeRuntimeConfig} from "./shared.js";

/**
 * Create static files middleware for serving assets
 *
 * @param options - Runtime configuration options
 * @returns Middleware function that handles asset requests or calls next()
 *
 * @example
 * ```typescript
 * import { createStaticFilesMiddleware } from '@b9g/shovel-compiler';
 *
 * // Use as middleware
 * router.use(createStaticFilesMiddleware({
 *   outputDir: 'dist/static',
 *   manifest: 'dist/static-manifest.json'
 * }));
 * ```
 */
export function createStaticFilesMiddleware(options: RuntimeConfig = {}) {
	const config = mergeRuntimeConfig(options);
	let manifest: AssetManifest | null = null;

	// Load manifest (needed in both dev and production modes)
	if (existsSync(config.manifest)) {
		try {
			const manifestContent = readFileSync(config.manifest, "utf-8");
			manifest = JSON.parse(manifestContent);
		} catch (error) {
			console.warn(`Failed to load asset manifest: ${error.message}`);
		}
	}

	return async (
		request: Request,
		context: any,
		next: () => Promise<Response>,
	): Promise<Response> => {
		const url = new URL(request.url);

		let response: Response | null;
		if (config.dev) {
			// Development mode: serve from source files
			response = serveFromSource(url.pathname, config, manifest, context);
		} else {
			// Production mode: serve from manifest
			response = serveFromManifest(url.pathname, config, manifest, context);
		}

		// If we couldn't handle this request, call next middleware
		if (!response) {
			return next();
		}

		return response;
	};
}

/**
 * Serve assets directly from source in development mode
 */
function serveFromSource(
	pathname: string,
	config: RuntimeConfig & Required<import("./shared.js").AssetsConfig>,
	manifest: AssetManifest | null,
	_context?: any,
): Response | null {
	try {
		// Check if we have this asset in our manifest (even in dev mode)
		// This ensures we only serve assets that were imported with { url: '...' }
		if (!manifest?.assets) {
			return null; // No manifest available, fall through
		}

		// Find asset by URL pathname
		const assetEntry = Object.values(manifest.assets).find(
			(asset) => asset.url === pathname,
		);

		if (!assetEntry) {
			return null; // Not our asset, fall through
		}

		// Serve from source file
		const sourcePath = join(process.cwd(), assetEntry.source);

		if (!existsSync(sourcePath)) {
			return null; // Source not found, fall through
		}

		const content = readFileSync(sourcePath);
		const mimeType = lookup(sourcePath) || "application/octet-stream";
		const stats = statSync(sourcePath);

		const headers = new Headers({
			"Content-Type": mimeType,
			"Content-Length": content.length.toString(),
			"Last-Modified": stats.mtime.toUTCString(),
			"Cache-Control": "no-cache", // No caching in dev mode
		});

		return new Response(content, {headers});
	} catch (error) {
		console.error(`Error serving asset ${pathname}:`, error);
		return null; // Error occurred, fall through
	}
}

/**
 * Serve assets from built files using manifest in production mode
 */
function serveFromManifest(
	pathname: string,
	config: RuntimeConfig & Required<import("./shared.js").AssetsConfig>,
	manifest: AssetManifest | null,
	_context?: any,
): Response | null {
	try {
		if (!manifest?.assets) {
			return null; // No manifest, fall through
		}

		// Find the asset in the manifest by URL pathname
		const assetEntry = Object.values(manifest.assets).find(
			(asset) => asset.url === pathname,
		);

		if (!assetEntry) {
			return null; // Not our asset, fall through
		}

		const filePath = join(config.outputDir, assetEntry.output);

		if (!existsSync(filePath)) {
			return null; // File not found, fall through
		}

		const content = readFileSync(filePath);
		const mimeType = assetEntry.type || "application/octet-stream";

		const headers = new Headers({
			"Content-Type": mimeType,
			"Content-Length": content.length.toString(),
			ETag: `"${assetEntry.hash}"`,
			"Cache-Control": "public, max-age=31536000, immutable", // 1 year cache for hashed assets
		});

		return new Response(content, {headers});
	} catch (error) {
		console.error(`Error serving asset ${pathname}:`, error);
		return null; // Error occurred, fall through
	}
}

/**
 * Create cached static files middleware with cache integration
 * This version automatically integrates with the cache system when available
 */
export function createCachedStaticFilesMiddleware(options: RuntimeConfig = {}) {
	const config = mergeRuntimeConfig(options);
	let manifest: AssetManifest | null = null;

	// Load manifest (needed in both dev and production modes)
	if (existsSync(config.manifest)) {
		try {
			const manifestContent = readFileSync(config.manifest, "utf-8");
			manifest = JSON.parse(manifestContent);
		} catch (error) {
			console.warn(`Failed to load asset manifest: ${error.message}`);
		}
	}

	return async (
		request: Request,
		context: any,
		next: () => Promise<Response>,
	): Promise<Response> => {
		// If cache is available and this is a GET request, try cache first
		if (context?.cache && request.method === "GET") {
			try {
				const cached = await context.cache.match(request);
				if (cached) {
					// Add cache hit header
					cached.headers.set("X-Cache", "HIT");
					return cached;
				}
			} catch (error) {
				console.warn("Cache lookup failed:", error);
			}
		}

		const url = new URL(request.url);

		let response: Response | null;
		if (config.dev) {
			// Development mode: serve from source files
			response = serveFromSource(url.pathname, config, manifest, context);
		} else {
			// Production mode: serve from manifest
			response = serveFromManifest(url.pathname, config, manifest, context);
		}

		// If we couldn't handle this request, call next middleware
		if (!response) {
			return next();
		}

		// Cache successful responses in production mode
		if (context?.cache && response.ok && !config.dev) {
			try {
				await context.cache.put(request, response.clone());
			} catch (error) {
				console.warn("Failed to cache asset response:", error);
			}
		}

		// Add cache miss header
		response.headers.set("X-Cache", "MISS");
		return response;
	};
}

// Default export
export default createStaticFilesMiddleware;
