# @b9g/assets

Runtime middleware for serving static assets with content hashing and manifest-based routing.

## Installation

```bash
npm install @b9g/assets
```

## Usage

### Asset Middleware

```javascript
import {assets} from '@b9g/assets/middleware';
import {Router} from '@b9g/router';

const router = new Router();

// Serve assets with 1-to-1 path mapping
// public/favicon.ico → /favicon.ico
// public/assets/app-abc123.js → /assets/app-abc123.js
router.use(assets({
  manifestPath: 'assets.json',  // default
  cacheControl: 'public, max-age=31536000, immutable'  // default
}));
```

## Architecture

### Build Time

Assets are processed during build with import attributes:

```javascript
// Import assets with assetBase directive
import logo from './logo.svg' with { assetBase: '/assets/' };
// → Returns: "/assets/logo-a1b2c3d4.svg"

import favicon from './favicon.ico' with { assetBase: '/', assetName: 'favicon.ico' };
// → Returns: "/favicon.ico"
```

The build process:
1. Rewrites file name according to assetName, hashing by default: `logo.svg` → `logo-a1b2c3d4.svg`
2. Writes files to `dist/public/{assetBase}/`
3. Generates manifest at `dist/server/assets.json`

### Runtime

The middleware serves assets from the manifest:

1. Loads manifest from server directory (not publicly accessible)
2. Maps incoming URL paths to files in public directory
3. Returns files with appropriate headers (MIME type, cache control, ETag)
4. Returns `undefined` for non-asset requests (passes to next middleware)

### Directory Structure

```
dist/
  server/
    server.js       # Your worker code
    assets.json     # Asset manifest (private)
  public/           # Public assets (served by middleware)
    favicon.ico     # assetBase: "/"
    assets/         # assetBase: "/assets/"
      app-a1b2c3.js
      styles-e5f6g7.css
```

### Manifest Format

```json
{
  "assets": {
    "src/logo.svg": {
      "source": "src/logo.svg",
      "output": "logo-a1b2c3d4.svg",
      "url": "/assets/logo-a1b2c3d4.svg",
      "hash": "a1b2c3d4",
      "size": 1234,
      "type": "image/svg+xml"
    }
  },
  "generated": "2025-01-01T00:00:00.000Z",
  "config": {
    "outDir": "dist"
  }
}
```

## API

### `assets(config?)`

Creates middleware for serving static assets.

```typescript
interface AssetsConfig {
  /** Path to asset manifest file (default: 'assets.json') */
  manifestPath?: string;

  /** Cache control header value (default: 'public, max-age=31536000, immutable') */
  cacheControl?: string;
}
```

**Returns:** Middleware function that returns:
- `Response` for matched assets
- `undefined` to pass through to next middleware
- Throws for manifest/filesystem errors

### Types

```typescript
import type {
  AssetsConfig,
  AssetManifestEntry,
  AssetManifest
} from '@b9g/assets/middleware';
```

## Security

- **Manifest allowlist**: Only files in manifest are served
- **Directory traversal protection**: Rejects paths with `..` or `//`
- **Private manifest**: Stored in server directory, not publicly accessible
- **No listing**: Directory contents not exposed

## Features

- Content-hashed filenames for cache busting
- Manifest-based O(1) lookups
- 1-to-1 URL to filesystem mapping
- Conditional requests (If-Modified-Since, ETag)
- MIME type detection (manifest + fallback)
- Long-term caching with immutable directive
- Works with Shovel `self.directories` API

## License

MIT
