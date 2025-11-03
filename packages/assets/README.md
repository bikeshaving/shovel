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
// Import with URL directive
import logoUrl from './logo.svg' with { url: '/static/' };
import stylesUrl from './styles.css' with { url: '/static/' };

// Use in your application
const img = document.createElement('img');
img.src = logoUrl; // '/static/logo-a1b2c3d4.svg'
```

### Asset Middleware

```javascript
import { Router } from '@b9g/router';
import { createAssetMiddleware } from '@b9g/assets';

const router = new Router();

// Add asset middleware
router.use('/static/*', createAssetMiddleware({
  root: './public',
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

function getAssetUrl(filename) {
  return manifest[filename] || filename;
}

// Get hashed URL
const logoUrl = getAssetUrl('logo.svg'); // '/static/logo-a1b2c3d4.svg'
```

## Middleware Options

```javascript
import { createAssetMiddleware } from '@b9g/assets';

const middleware = createAssetMiddleware({
  root: './public',              // Asset root directory
  prefix: '/static',             // URL prefix
  maxAge: 31536000,             // Cache-Control max-age
  immutable: true,              // Add immutable directive
  etag: true,                   // Generate ETags
  lastModified: true,           // Set Last-Modified headers
  index: ['index.html'],        // Directory index files
  extensions: ['.html', '.htm'], // Try extensions
  fallback: '/index.html'       // SPA fallback
});

router.use('/static/*', middleware);
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
import { createAssetMiddleware } from '@b9g/assets';

const router = new Router();

// Serve static assets
router.use('/static/*', createAssetMiddleware({
  root: './dist/static',
  maxAge: 31536000
}));

// SPA fallback for client-side routing
router.use(createAssetMiddleware({
  root: './dist',
  fallback: '/index.html',
  maxAge: 0 // Don't cache HTML
}));
```

### CDN Integration

```javascript
const assetMiddleware = createAssetMiddleware({
  root: './dist/static',
  headers: {
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff'
  }
});

// Serve from CDN in production
if (process.env.NODE_ENV === 'production') {
  // Assets served by CDN
  router.get('/static/*', () => new Response(null, { status: 404 }));
} else {
  router.use('/static/*', assetMiddleware);
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

## Security Headers

Built-in security headers for static assets:

```javascript
const middleware = createAssetMiddleware({
  root: './public',
  security: {
    contentTypeOptions: 'nosniff',
    frameOptions: 'deny',
    xssProtection: '1; mode=block'
  }
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
const middleware = createAssetMiddleware({
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

## API Reference

### createAssetMiddleware(options)

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