# @b9g/assets

Asset pipeline and static file middleware for web applications with content hashing and manifest generation.

## Features

- **Import Syntax**: Import files with `with { url: "/static/" }` syntax
- **Content Hashing**: Automatic file hashing for cache busting
- **Manifest Generation**: Asset manifest for production builds
- **Middleware Integration**: Router middleware for serving static files
- **Universal**: Works across all JavaScript runtimes and bundlers

## Installation

```bash
npm install @b9g/assets
```

## Quick Start

### Import Assets

```javascript
// Import with assetBase directive
import logoURL from './logo.svg' with { assetBase: '/static/' };
import stylesURL from './styles.css' with { assetBase: '/static/' };

// Use in your application
const img = document.createElement('img');
img.src = logoURL; // '/static/logo-a1b2c3d4.svg'
```

### Asset Middleware

```javascript
import { Router } from '@b9g/router';
import { assets } from '@b9g/assets/middleware';

const router = new Router();

// Add asset middleware with 1-to-1 path mapping
router.use(assets({
  dev: false,
  maxAge: 31536000 // 1 year cache for hashed files
}));

// Your app routes
router.get('/', () => new Response('Hello World'));
```

## Asset Manifest

The build process generates an asset manifest:

```json
{
  "logo.svg": "/static/logo-a1b2c3d4.svg",
  "styles.css": "/static/styles-e5f6g7h8.css",
  "app.js": "/static/app-i9j0k1l2.js"
}
```

### Using the Manifest

```javascript
import manifest from './dist/assets/manifest.json' with { type: 'json' };

function getAssetURL(filename) {
  return manifest[filename] || filename;
}

// Get hashed URL
const logoURL = getAssetURL('logo.svg'); // '/static/logo-a1b2c3d4.svg'
```

## Middleware Options

```javascript
import { assets } from '@b9g/assets/middleware';

const middleware = assets({
  manifestPath: 'manifest.json',    // Path to asset manifest
  cacheControl: 'public, max-age=31536000', // Cache-Control header
  dev: false,                       // Development mode
  mimeTypes: {                      // Custom MIME types
    '.webp': 'image/webp'
  }
});

router.use(middleware);
```

## Content Hashing

Files are automatically hashed based on content:

```javascript
// Original filename
'logo.svg'

// Hashed filename (SHA-256 based)
'logo-a1b2c3d4.svg'

// Hash changes only when content changes
'logo-e5f6g7h8.svg' // After file modification
```

## Integration Examples

### With Build Tools

```javascript
// vite.config.js
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        assetFileNames: 'static/[name]-[hash][extname]'
      }
    }
  }
});
```

### SPA Routing

```javascript
import { Router } from '@b9g/router';
import { assets } from '@b9g/assets/middleware';

const router = new Router();

// Single middleware serves all assets with 1-to-1 path mapping
// Public URL → bucket path (just strip leading slash)
// /assets/app.js → assets/app.js in bucket
// /favicon.ico → favicon.ico in bucket
router.use(assets({
  dev: process.env.NODE_ENV === 'development'
}));
```

### CDN Integration

```javascript
// In production, assets can be served by CDN
// In development, serve from assets bucket
if (process.env.NODE_ENV === 'production') {
  // Configure CDN URLs in build process
  // Assets middleware can be disabled or serve as fallback
} else {
  router.use(assets({
    dev: true,
    cacheControl: 'no-cache'
  }));
}
```

## MIME Type Detection

Automatic MIME type detection for common file types:

```javascript
// Supported file types
{
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  // ... and more
}
```

## Security Features

Built-in security features:

```javascript
const middleware = assets({
  // Automatic MIME type detection prevents content-type confusion
  // Directory traversal protection (prevents .. in paths)
  // Manifest validation (only serves files listed in build manifest)
  dev: false // In production, only built assets are served
});
```

## Performance Features

### Conditional Requests

- **ETag**: Generate entity tags for cache validation
- **Last-Modified**: Use file modification time
- **If-None-Match**: Return 304 for matching ETags
- **If-Modified-Since**: Return 304 for unchanged files

### Compression

```javascript
const middleware = assets({
  root: './public',
  compression: {
    gzip: true,
    brotli: true,
    threshold: 1024 // Minimum size to compress
  }
});
```

### Range Requests

Support for HTTP range requests (partial content):

```javascript
// Automatic range request handling
// Useful for large files, video streaming, etc.
const response = await middleware(request);
// Returns 206 Partial Content when appropriate
```

## Exports

### Functions

- `assets(config?)` - Create middleware for serving static assets (from `@b9g/assets/middleware`)
- `getMimeType(path)` - Get MIME type for file extension
- `assetsPlugin(options?)` - Esbuild plugin for asset handling

### Types

- `AssetsConfig` - Configuration for assets middleware
- `AssetManifestEntry` - Single entry in asset manifest
- `AssetManifest` - Complete asset manifest
- `AssetsPluginConfig` - Configuration for esbuild plugin

## API Reference

### assets(options)

Creates middleware function for serving static assets.

#### Options

```typescript
interface AssetMiddlewareOptions {
  root: string;                    // Asset root directory
  prefix?: string;                 // URL prefix
  maxAge?: number;                 // Cache-Control max-age
  immutable?: boolean;             // Add immutable directive
  etag?: boolean;                  // Generate ETags
  lastModified?: boolean;          // Set Last-Modified
  index?: string[];                // Directory index files
  extensions?: string[];           // Try extensions
  fallback?: string;               // SPA fallback file
  headers?: Record<string, string>; // Additional headers
  security?: SecurityOptions;       // Security headers
  compression?: CompressionOptions; // Compression settings
}
```

## License

MIT
