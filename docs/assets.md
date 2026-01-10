# Assets

Shovel provides an asset pipeline for serving static files with content-based hashing for cache busting.

## Quick Start

Import assets with the `with { assetBase }` syntax:

```typescript
import logo from "./logo.svg" with { assetBase: "/assets/" };
import styles from "./styles.css" with { assetBase: "/assets/" };

// logo = "/assets/logo-a1b2c3d4.svg"
// styles = "/assets/styles-e5f6g7h8.css"
```

Serve assets with the middleware:

```typescript
import { Router } from "@b9g/router";
import { assets } from "@b9g/assets/middleware";

const router = new Router();
router.use(assets());

self.addEventListener("fetch", (event) => {
  event.respondWith(router.handle(event.request));
});
```

---

## Importing Assets

Use import attributes to include assets in your build:

```typescript
// Images
import logo from "./logo.svg" with { assetBase: "/assets/" };
import photo from "./photo.png" with { assetBase: "/images/" };

// Stylesheets
import styles from "./styles.css" with { assetBase: "/assets/" };

// TypeScript/JavaScript (transpiled)
import client from "./client.ts" with { assetBase: "/assets/" };
```

The import returns the public URL with a content hash:

```typescript
console.log(logo);   // "/assets/logo-a1b2c3d4e5f6g7h8.svg"
console.log(styles); // "/assets/styles-1234567890abcdef.css"
```

### Import Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `assetBase` | `string` | Required. URL path prefix for the asset |
| `assetName` | `string` | Optional. Override the output filename |
| `type` | `"css"` | Optional. Extract CSS from JS bundle |

### Custom Filenames

Use `assetName` for files that need specific names:

```typescript
// Well-known files (no hash)
import favicon from "./favicon.ico" with {
  assetBase: "/",
  assetName: "favicon.ico"
};
// Returns: "/favicon.ico"

// Placeholders
import photo from "./photo.png" with {
  assetBase: "/images/",
  assetName: "[name].[ext]"
};
// Returns: "/images/photo.png"
```

### CSS Extraction

Extract CSS from TypeScript/JavaScript bundles:

```typescript
// Get the JS bundle
import clientJs from "./client.ts" with { assetBase: "/assets/" };

// Get the extracted CSS
import clientCss from "./client.ts" with { assetBase: "/assets/", type: "css" };
```

---

## Supported File Types

### Transpiled Files

These files are processed through ESBuild:

- TypeScript: `.ts`, `.tsx`, `.mts`, `.cts`
- JavaScript: `.js`, `.jsx`, `.mjs`, `.cjs`
- CSS: `.css` (with `@import` resolution)

### Static Files

These files are copied as-is with content hashing:

- Images: `.svg`, `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.ico`
- Fonts: `.woff`, `.woff2`, `.ttf`, `.otf`, `.eot`
- Media: `.mp4`, `.webm`, `.mp3`, `.ogg`

---

## Assets Middleware

The `assets()` middleware serves files from the asset manifest.

```typescript
import { assets } from "@b9g/assets/middleware";

router.use(assets());
```

### Options

```typescript
router.use(assets({
  manifestPath: "assets.json",
  cacheControl: "public, max-age=31536000, immutable",
}));
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `manifestPath` | `string` | `"assets.json"` | Path to manifest file |
| `cacheControl` | `string` | `"public, max-age=31536000, immutable"` | Cache-Control header |

### Features

- **Content hashing**: Files are fingerprinted with SHA256 hashes
- **Immutable caching**: Long-term caching with cache busting on content change
- **ETag support**: Handles conditional requests (304 Not Modified)
- **MIME types**: Automatic content-type detection
- **Security**: Prevents directory traversal attacks

---

## Asset Manifest

The build generates an `assets.json` manifest in the server directory:

```json
{
  "assets": {
    "./logo.svg": {
      "source": "./logo.svg",
      "output": "assets/logo-a1b2c3d4e5f6g7h8.svg",
      "url": "/assets/logo-a1b2c3d4e5f6g7h8.svg",
      "hash": "a1b2c3d4e5f6g7h8",
      "size": 1234,
      "type": "image/svg+xml"
    }
  },
  "generated": "2024-01-15T10:30:00.000Z",
  "config": {
    "outDir": "dist"
  }
}
```

The manifest is stored in the server directory (not public) for security.

---

## Build Output

Assets are written to the public directory:

```
dist/
├── public/
│   ├── assets/
│   │   ├── app-abc123def456.js
│   │   ├── styles-xyz789abc123.css
│   │   └── logo-def456ghi789.svg
│   └── favicon.ico
└── server/
    ├── assets.json    # Manifest (server-side only)
    ├── worker.js
    └── server.js
```

---

## Common Patterns

### CSS with Images

CSS `url()` references are automatically resolved:

```css
/* styles.css */
.logo {
  background-image: url("./logo.svg");
}
```

```typescript
import styles from "./styles.css" with { assetBase: "/assets/" };
// The CSS includes the hashed URL for logo.svg
```

### Multiple Asset Directories

Organize assets by type:

```typescript
import logo from "./images/logo.svg" with { assetBase: "/images/" };
import app from "./scripts/app.ts" with { assetBase: "/js/" };
import styles from "./styles/main.css" with { assetBase: "/css/" };
```

### Serving in HTML

Use the imported URLs in your HTML responses:

```typescript
import styles from "./styles.css" with { assetBase: "/assets/" };
import app from "./app.ts" with { assetBase: "/assets/" };

router.route("/").get(() => {
  return new Response(`
    <!DOCTYPE html>
    <html>
      <head>
        <link rel="stylesheet" href="${styles}">
      </head>
      <body>
        <script src="${app}"></script>
      </body>
    </html>
  `, {
    headers: { "Content-Type": "text/html" },
  });
});
```

### Well-Known Files

Serve files at specific URLs without hashing:

```typescript
import favicon from "./favicon.ico" with {
  assetBase: "/",
  assetName: "favicon.ico"
};

import robots from "./robots.txt" with {
  assetBase: "/",
  assetName: "robots.txt"
};

import manifest from "./manifest.json" with {
  assetBase: "/",
  assetName: "manifest.json"
};
```

---

## Hashing

Assets use SHA256 content hashing:

- Hash is based on the **output content** (after transpilation)
- First **16 characters** of the hash are used
- Format: `{name}-{hash}{ext}`

This ensures:
- Cache invalidation when content changes
- Long-term caching when content is unchanged
- Consistent hashes across builds for the same content

---

## See Also

- [Middleware](./middleware.md) - Request processing
- [Routing](./routing.md) - URL routing
- [Directories](./directories.md) - File storage
