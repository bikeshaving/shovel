---
title: Static Assets
description: Serve images, CSS, and JavaScript with automatic cache busting.
---

Shovel provides an asset pipeline with content-based hashing for cache busting.

## Import Assets

Use import attributes to include assets:

```typescript
import logo from "./logo.svg" with { assetBase: "/assets/" };
import styles from "./styles.css" with { assetBase: "/assets/" };

// logo = "/assets/logo-a1b2c3d4.svg"
// styles = "/assets/styles-e5f6g7h8.css"
```

## Serve Assets

Add the assets middleware to serve files:

```typescript
import { Router } from "@b9g/router";
import { assets } from "@b9g/assets/middleware";

const router = new Router();
router.use(assets());

self.addEventListener("fetch", (event) => {
  event.respondWith(router.handle(event.request));
});
```

## Use in HTML

Reference assets in your responses:

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

## Well-Known Files

Serve files at specific URLs without hashing:

```typescript
import favicon from "./favicon.ico" with {
  assetBase: "/",
  assetName: "favicon.ico"
};
// Returns: "/favicon.ico"
```

## Next Steps

- See [Assets Reference](/api/assets) for all options
- Learn about [Deployment](/api/cli) for production builds
