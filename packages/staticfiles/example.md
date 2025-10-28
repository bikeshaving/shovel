# @b9g/staticfiles Usage Example

This example shows how to set up and use the staticfiles package in a Shovel project (following Django's staticfiles pattern).

## Installation

```bash
bun add @b9g/staticfiles
```

## Build Configuration

Create a build script that uses the assets plugin:

```typescript
// build.js
import { build } from 'esbuild';
import { staticFilesPlugin } from '@b9g/staticfiles/plugin';

await build({
  entryPoints: ['src/app.ts'],
  bundle: true,
  outdir: 'dist',
  format: 'esm',
  plugins: [
    staticFilesPlugin({
      publicPath: '/static/',
      outputDir: 'dist/static',
      manifest: 'dist/static-manifest.json'
    })
  ]
});
```

## Runtime Setup

Set up the asset handler in your server:

```typescript
// server.ts
import { Router } from '@b9g/router';
import { CacheStorage } from '@b9g/cache/cache-storage';
import { MemoryCache } from '@b9g/cache/memory-cache';
import { createStaticFilesHandler } from '@b9g/staticfiles';

// Set up cache storage
const caches = new CacheStorage();
caches.register('static', () => new MemoryCache('static'));

// Create router with cache
const router = new Router({ caches });

// Add assets handler
router.use('/static/*', createStaticFilesHandler({
  publicPath: '/static/',
  outputDir: 'dist/static',
  manifest: 'dist/static-manifest.json',
  dev: process.env.NODE_ENV !== 'production'
}));

// Your app routes
router.route('/').get(() => {
  return new Response(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>My App</title>
      </head>
      <body>
        <h1>Hello Shovel!</h1>
      </body>
    </html>
  `, {
    headers: { 'Content-Type': 'text/html' }
  });
});

export default router;
```

## Using Assets in Your Code

```typescript
// app.ts
import logo from './assets/logo.svg' with { type: 'url' };
import styles from './assets/app.css' with { type: 'url' };
import heroImage from './assets/hero.jpg' with { type: 'url' };

console.log(logo);      // "/static/logo-abc12345.svg"
console.log(styles);    // "/static/app-def67890.css"
console.log(heroImage); // "/static/hero-ghi24680.jpg"

// Use in HTML
document.body.innerHTML = \`
  <div>
    <img src="\${heroImage}" alt="Hero" />
    <link rel="stylesheet" href="\${styles}" />
  </div>
\`;
```

## TypeScript Support

Add global types to your project:

```typescript
// global.d.ts
/// <reference types="@b9g/staticfiles/global" />
```

Or import explicitly:

```typescript
// types.ts
import '@b9g/staticfiles/global';
```

## Development vs Production

### Development Mode
- Assets served directly from source files
- No hashing or manifest required
- Hot reload support
- `/static/logo.svg` → serves `src/assets/logo.svg`

### Production Mode
- Assets processed and hashed during build
- Manifest file required for lookup
- Long-term caching with ETags
- `/static/logo-abc12345.svg` → serves `dist/static/logo-abc12345.svg`

## Example Project Structure

```
my-shovel-app/
├── src/
│   ├── app.ts
│   ├── server.ts
│   └── assets/
│       ├── logo.svg
│       ├── app.css
│       └── hero.jpg
├── dist/                    # Generated during build
│   ├── app.js
│   ├── static/              # Generated assets
│   │   ├── logo-abc123.svg
│   │   ├── app-def456.css
│   │   └── hero-ghi789.jpg
│   └── static-manifest.json # Asset manifest
├── build.js
└── package.json
```

## Asset Manifest Example

The generated manifest looks like this:

```json
{
  "assets": {
    "src/assets/logo.svg": {
      "source": "src/assets/logo.svg",
      "output": "logo-abc12345.svg",
      "url": "/static/logo-abc12345.svg",
      "hash": "abc12345",
      "size": 2048,
      "type": "image/svg+xml"
    },
    "src/assets/app.css": {
      "source": "src/assets/app.css", 
      "output": "app-def67890.css",
      "url": "/static/app-def67890.css",
      "hash": "def67890",
      "size": 1024,
      "type": "text/css"
    }
  },
  "generated": "2024-01-15T10:30:00.000Z",
  "config": {
    "publicPath": "/static/",
    "outputDir": "dist/static"
  }
}
```

## Cache Integration

The assets handler automatically integrates with Shovel's cache system:

```typescript
import { createCachedAssetsHandler } from '@b9g/staticfiles';

// Automatically caches assets when cache is available
router.use('/static/*', createCachedAssetsHandler({
  cache: { name: 'static-assets' }
}));
```

## Benefits

- **Zero Config**: Works out of the box with sensible defaults
- **Cache-First**: Automatic integration with Shovel's cache system  
- **Universal**: Same code works in SSG, SSR, and SPA modes
- **Type Safe**: Full TypeScript support with asset URL types
- **Performance**: Content hashing for cache busting and ETags
- **Developer Experience**: Hot reload in dev, optimized for production