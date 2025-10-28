import { readFileSync, existsSync, statSync } from 'fs';
import { join, extname } from 'path';
import { lookup } from 'mime-types';
import type { RuntimeConfig, AssetManifest } from './shared.js';
import { mergeRuntimeConfig } from './shared.js';

/**
 * Create a static assets handler for serving files
 * 
 * @param options - Runtime configuration options
 * @returns Handler function that can be used as middleware or route handler
 * 
 * @example
 * ```typescript
 * import { createStaticFilesHandler } from '@b9g/staticfiles';
 * 
 * // Use as middleware
 * router.use('/static/*', createStaticFilesHandler());
 * 
 * // Use as route handler
 * router.route('/static/*').get(createStaticFilesHandler());
 * ```
 */
export function createStaticFilesHandler(options: RuntimeConfig = {}) {
  const config = mergeRuntimeConfig(options);
  let manifest: AssetManifest | null = null;
  
  // Load manifest in production mode
  if (!config.dev && existsSync(config.manifest)) {
    try {
      const manifestContent = readFileSync(config.manifest, 'utf-8');
      manifest = JSON.parse(manifestContent);
    } catch (error) {
      console.warn(`Failed to load asset manifest: ${error.message}`);
    }
  }

  return async (request: Request, context?: any): Promise<Response> => {
    const url = new URL(request.url);
    
    // Check if this request is for our assets
    if (!url.pathname.startsWith(config.publicPath)) {
      return new Response('Not Found', { status: 404 });
    }

    // Extract the asset path
    const assetPath = url.pathname.slice(config.publicPath.length);
    
    if (config.dev) {
      // Development mode: serve from source files
      return serveFromSource(assetPath, config, context);
    } else {
      // Production mode: serve from manifest
      return serveFromManifest(assetPath, config, manifest, context);
    }
  };
}

/**
 * Serve assets directly from source in development mode
 */
function serveFromSource(
  assetPath: string, 
  config: RuntimeConfig & Required<import('./shared.js').AssetsConfig>,
  context?: any
): Response {
  try {
    // In dev mode, the asset path should match the source file structure
    // For example: /static/logo.svg -> src/logo.svg
    const sourcePath = join(config.sourceDir!, assetPath);
    
    if (!existsSync(sourcePath)) {
      return new Response('Asset not found', { status: 404 });
    }

    const content = readFileSync(sourcePath);
    const mimeType = lookup(sourcePath) || 'application/octet-stream';
    const stats = statSync(sourcePath);
    
    const headers = new Headers({
      'Content-Type': mimeType,
      'Content-Length': content.length.toString(),
      'Last-Modified': stats.mtime.toUTCString(),
      'Cache-Control': 'no-cache', // No caching in dev mode
    });

    return new Response(content, { headers });
  } catch (error) {
    console.error(`Error serving asset ${assetPath}:`, error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

/**
 * Serve assets from built files using manifest in production mode
 */
function serveFromManifest(
  assetPath: string,
  config: RuntimeConfig & Required<import('./shared.js').AssetsConfig>,
  manifest: AssetManifest | null,
  context?: any
): Response {
  try {
    if (!manifest) {
      return new Response('Asset manifest not found', { status: 404 });
    }

    // Find the asset in the manifest by output filename
    const assetEntry = Object.values(manifest.assets).find(
      asset => asset.output === assetPath
    );

    if (!assetEntry) {
      return new Response('Asset not found', { status: 404 });
    }

    const filePath = join(config.outputDir, assetEntry.output);
    
    if (!existsSync(filePath)) {
      return new Response('Asset file not found', { status: 404 });
    }

    const content = readFileSync(filePath);
    const mimeType = assetEntry.type || 'application/octet-stream';
    
    const headers = new Headers({
      'Content-Type': mimeType,
      'Content-Length': content.length.toString(),
      'ETag': `"${assetEntry.hash}"`,
      'Cache-Control': 'public, max-age=31536000, immutable', // 1 year cache for hashed assets
    });

    // Handle conditional requests
    const ifNoneMatch = request.headers.get('If-None-Match');
    if (ifNoneMatch === `"${assetEntry.hash}"`) {
      return new Response(null, { status: 304, headers });
    }

    return new Response(content, { headers });
  } catch (error) {
    console.error(`Error serving asset ${assetPath}:`, error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

/**
 * Create assets handler with cache integration
 * This version automatically integrates with the cache system when available
 */
export function createCachedStaticFilesHandler(options: RuntimeConfig = {}) {
  const baseHandler = createStaticFilesHandler(options);
  const config = mergeRuntimeConfig(options);
  
  return async (request: Request, context?: any): Promise<Response> => {
    // If cache is available and this is a GET request, try cache first
    if (context?.cache && request.method === 'GET') {
      try {
        const cached = await context.cache.match(request);
        if (cached) {
          // Add cache hit header
          cached.headers.set('X-Cache', 'HIT');
          return cached;
        }
      } catch (error) {
        console.warn('Cache lookup failed:', error);
      }
    }

    // Get response from handler
    const response = await baseHandler(request, context);

    // Cache successful responses in production mode
    if (context?.cache && response.ok && !config.dev) {
      try {
        await context.cache.put(request, response.clone());
      } catch (error) {
        console.warn('Failed to cache asset response:', error);
      }
    }

    // Add cache miss header
    response.headers.set('X-Cache', 'MISS');
    return response;
  };
}

// Default export
export default createStaticFilesHandler;