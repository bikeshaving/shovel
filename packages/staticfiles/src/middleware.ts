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
		cacheControl = config.dev ? 'no-cache' : 'public, max-age=31536000',
		dev = false,
		mimeTypes = {},
	} = config;

	return async function staticFilesMiddleware(request: Request): Promise<Response | null> {
		const url = new URL(request.url);
		
		// Only handle requests that start with our base path
		if (!url.pathname.startsWith(basePath)) {
			return null; // Pass through to next middleware
		}

		// Extract the file path relative to base path
		const filePath = url.pathname.slice(basePath.length);
		
		// Security: prevent directory traversal
		if (filePath.includes('..') || filePath.includes('//')) {
			return new Response('Forbidden', { status: 403 });
		}

		// Remove leading slash and handle empty path
		const cleanPath = filePath.replace(/^\/+/, '') || 'index.html';

		try {
			// Get filesystem root
			const root = await getFileSystemRoot(filesystem);
			
			// Get file handle
			const fileHandle = await root.getFileHandle(cleanPath);
			const file = await fileHandle.getFile();
			
			// Determine content type
			const contentType = getMimeType(cleanPath, mimeTypes);
			
			// Create response headers
			const headers = new Headers({
				'Content-Type': contentType,
				'Content-Length': file.size.toString(),
				'Cache-Control': cacheControl,
				'Last-Modified': new Date(file.lastModified).toUTCString(),
			});

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