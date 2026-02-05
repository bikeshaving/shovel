# @b9g/assets

Static asset pipeline with content-based hashing.

---

## Import Attributes

Import assets using [import attributes](https://github.com/tc39/proposal-import-attributes):

```typescript
import logo from "./logo.svg" with { assetBase: "/assets/" };
import styles from "./styles.css" with { assetBase: "/assets/" };
import client from "./client.ts" with { assetBase: "/assets/" };

// logo = "/assets/logo-a1b2c3d4.svg"
// styles = "/assets/styles-e5f6g7h8.css"
// client = "/assets/client-i9j0k1l2.js"
```

### Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `assetBase` | `string` | Required. URL path prefix |
| `assetName` | `string` | Override output filename |
| `type` | `"css"` | Extract CSS from JS bundle |

### Custom Filenames

```typescript
import favicon from "./favicon.ico" with {
  assetBase: "/",
  assetName: "favicon.ico"
};
// Returns: "/favicon.ico" (no hash)
```

### CSS Extraction

```typescript
import clientJs from "./client.ts" with { assetBase: "/assets/" };
import clientCss from "./client.ts" with { assetBase: "/assets/", type: "css" };
```

---

## Supported File Types

### Transpiled

- TypeScript: `.ts`, `.tsx`, `.mts`, `.cts`
- JavaScript: `.js`, `.jsx`, `.mjs`, `.cjs`
- CSS: `.css`

### Static

- Images: `.svg`, `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.ico`
- Fonts: `.woff`, `.woff2`, `.ttf`, `.otf`, `.eot`
- Media: `.mp4`, `.webm`, `.mp3`, `.ogg`

---

## Assets Middleware

```typescript
import { assets } from "@b9g/assets/middleware";

router.use(assets());
```

### Options

| Option | Type | Default |
|--------|------|---------|
| `manifestPath` | `string` | `"assets.json"` |
| `cacheControl` | `string` | `"public, max-age=31536000, immutable"` |

---

## Asset Manifest

Generated at `[outdir]/server/assets.json`:

```json
{
  "assets": {
    "./logo.svg": {
      "source": "./logo.svg",
      "output": "assets/logo-a1b2c3d4.svg",
      "url": "/assets/logo-a1b2c3d4.svg",
      "hash": "a1b2c3d4",
      "size": 1234,
      "type": "image/svg+xml"
    }
  }
}
```

---

## Build Output

```
dist/
├── public/
│   ├── assets/
│   │   ├── app-abc123.js
│   │   └── styles-xyz789.css
│   └── favicon.ico
└── server/
    └── assets.json
```

---

## See Also

- [Middleware](./middleware.md) - Request processing
- [Router](./router.md) - URL routing

