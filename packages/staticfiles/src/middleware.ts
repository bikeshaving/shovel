/**
 * Static files middleware using File System Access API
 * 
 * Runtime middleware that serves static files from any storage backend
 * without requiring ESBuild or build-time dependencies.
 */

import { getFileSystemRoot } from "@b9g/platform";

export interface StaticFilesConfig {
	/** File system name/bucket for static assets (default: 'static') */
	filesystem?: string;
	/** Base path for static files (default: '/static') */
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
 * Default MIME type mappings for static files
 */
const DEFAULT_MIME_TYPES: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.css': 'text/css',
	'.js': 'application/javascript',
	'.mjs': 'application/javascript',
	'.json': 'application/json',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.svg': 'image/svg+xml',
	'.ico': 'image/x-icon',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.ttf': 'font/ttf',
	'.eot': 'application/vnd.ms-fontobject',
	'.pdf': 'application/pdf',
	'.txt': 'text/plain',
	'.xml': 'application/xml',
	'.zip': 'application/zip',
	'.webp': 'image/webp',
	'.avif': 'image/avif',
	'.mp4': 'video/mp4',
	'.webm': 'video/webm',
	'.mp3': 'audio/mpeg',
	'.wav': 'audio/wav',
	'.ogg': 'audio/ogg',
};

/**
 * Get MIME type for a file path
 */
function getMimeType(filePath: string, customTypes: Record<string, string> = {}): string {
	const ext = '.' + filePath.split('.').pop()?.toLowerCase();
	return customTypes[ext] || DEFAULT_MIME_TYPES[ext] || 'application/octet-stream';
}

/**
 * Create static files middleware
 */
export function createStaticFilesMiddleware(config: StaticFilesConfig = {}) {
	const {
		filesystem = 'static',
		basePath = '/static',
		manifestPath = 'manifest.json',
		cacheControl = config.dev ? 'no-cache' : 'public, max-age=31536000',
		dev = false,
		mimeTypes = {},
	} = config;

	// Cache for the manifest
	let manifestCache: Record<string, any> | null = null;
	let manifestError: string | null = null;

	// Load manifest from filesystem
	async function loadManifest(): Promise<Record<string, any>> {
		if (manifestCache) return manifestCache;
		if (manifestError && !dev) throw new Error(manifestError);

		try {
			const root = await getFileSystemRoot(filesystem);
			const manifestHandle = await root.getFileHandle(manifestPath);
			const manifestFile = await manifestHandle.getFile();
			const manifestText = await manifestFile.text();
			const manifest = JSON.parse(manifestText);
			
			// Convert manifest.assets to URL lookup map
			// manifest.assets[sourcePath] = { url, output, hash, size, type }
			const urlMap: Record<string, any> = {};
			
			if (manifest.assets) {
				for (const [sourcePath, entry] of Object.entries(manifest.assets)) {
					if (entry && typeof entry === 'object' && 'url' in entry) {
						// Extract filename from URL (remove base path)
						const url = entry.url as string;
						const filename = url.split('/').pop();
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
				console.warn('[StaticFiles] Manifest not found, falling back to direct file serving');
				return {}; // Empty manifest in dev mode
			}
			throw new Error(manifestError);
		}
	}

	return async function staticFilesMiddleware(request: Request, context: any, next: () => Promise<Response>): Promise<Response> {
		const url = new URL(request.url);
		
		// Only handle requests that start with our base path
		if (!url.pathname.startsWith(basePath)) {
			return await next(); // Pass through to next middleware
		}

		// Extract the file path relative to base path
		const requestedPath = url.pathname.slice(basePath.length);
		
		// Security: prevent directory traversal
		if (requestedPath.includes('..') || requestedPath.includes('//')) {
			return new Response('Forbidden', { status: 403 });
		}

		// Remove leading slash and handle empty path
		const requestedFilename = requestedPath.replace(/^\/+/, '') || 'index.html';

		try {
			// Load manifest to validate file exists in build
			const manifest = await loadManifest();
			
			// Check if file exists in manifest (security: only serve built assets)
			const manifestEntry = manifest[requestedFilename];
			if (!manifestEntry && !dev) {
				// In production, only serve files that went through ESBuild
				return new Response('Not Found', { status: 404 });
			}
			
			// Get filesystem root
			const root = await getFileSystemRoot(filesystem);
			
			// Get file handle (serve requested filename directly)
			const fileHandle = await root.getFileHandle(requestedFilename);
			const file = await fileHandle.getFile();
			
			// Use content type from manifest if available, otherwise detect
			const contentType = manifestEntry?.type || getMimeType(requestedFilename, mimeTypes);
			
			// Create response headers
			const headers = new Headers({
				'Content-Type': contentType,
				'Content-Length': manifestEntry?.size?.toString() || file.size.toString(),
				'Cache-Control': cacheControl,
				'Last-Modified': new Date(file.lastModified).toUTCString(),
			});

			// Add hash-based ETag if available
			if (manifestEntry?.hash) {
				headers.set('ETag', `"${manifestEntry.hash}"`);
			}

			// Handle conditional requests
			const ifModifiedSince = request.headers.get('if-modified-since');
			if (ifModifiedSince) {
				const modifiedSince = new Date(ifModifiedSince);
				const lastModified = new Date(file.lastModified);
				if (lastModified <= modifiedSince) {
					return new Response(null, { 
						status: 304,
						headers: new Headers({
							'Cache-Control': cacheControl,
							'Last-Modified': headers.get('Last-Modified')!,
						})
					});
				}
			}

			// Return file response
			return new Response(file.stream(), {
				status: 200,
				headers,
			});

		} catch (error) {
			if ((error as any).name === 'NotFoundError') {
				return new Response('Not Found', { status: 404 });
			}
			
			console.error('[StaticFiles] Error serving file:', error);
			return new Response('Internal Server Error', { status: 500 });
		}
	};
}

/**
 * Default export for convenience
 */
export default createStaticFilesMiddleware;