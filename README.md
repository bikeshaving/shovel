# Shovel

**The ServiceWorker platform for server-side JavaScript.**

Same code. Any runtime. Node.js, Bun, Cloudflare Workers.

```javascript
// app.js
self.addEventListener("fetch", (event) => {
  event.respondWith(new Response("Hello World"));
});
```

```bash
npx @b9g/shovel develop app.js
```

## Why Shovel?

Browsers have ServiceWorker. Cloudflare has Workers. Node.js and Bun have... Express?

Shovel brings the ServiceWorker programming model to server-side JavaScript. Write your app once using web standards, deploy it anywhere.

## Web Standards

Shovel implements web platform APIs that server-side JavaScript is missing:

| API | Standard | What it does |
|-----|----------|--------------|
| `fetch` event | [Service Workers](https://w3c.github.io/ServiceWorker/) | Request handling |
| `self.caches` | [Cache API](https://w3c.github.io/ServiceWorker/#cache-interface) | Response caching |
| `self.buckets` | [FileSystem API](https://fs.spec.whatwg.org/) | Storage (local, S3, R2) |
| `self.cookieStore` | [Cookie Store API](https://wicg.github.io/cookie-store/) | Cookie management |
| `URLPattern` | [URLPattern](https://urlpattern.spec.whatwg.org/) | Route matching (100% WPT) |
| `AsyncContext.Variable` | [TC39 Stage 2](https://github.com/tc39/proposal-async-context) | Request-scoped state |

Your code uses standards. Shovel makes them work everywhere.

## True Portability

Shovel is a complete meta-framework. Same code, any runtime, any rendering strategy:

- **Server runtimes**: Node.js, Bun, Cloudflare Workers for development and production
- **Browser ServiceWorkers**: The same app can run as a PWA service worker
- **Universal rendering**: Dynamic, static, or client-side - link and deploy assets automatically

## Quick Start

```javascript
// app.js
import {Router} from "@b9g/router";

const router = new Router();

router.route("/").get(() => new Response("Hello World"));

router.route("/users/:id").get((request, {params}) => {
  return Response.json({id: params.id});
});

self.addEventListener("fetch", (event) => {
  event.respondWith(router.handler(event.request));
});
```

```bash
# Create a new project
npm create @b9g/shovel my-app

# Development with hot reload
npx @b9g/shovel develop app.js

# Build for production
npx @b9g/shovel build app.js --platform=node
npx @b9g/shovel build app.js --platform=bun
npx @b9g/shovel build app.js --platform=cloudflare
```

## Platform APIs

```javascript
// Cache API - response caching
const cache = await self.caches.open("my-cache");
await cache.put(request, response.clone());
const cached = await cache.match(request);

// File System Access - storage buckets (local, S3, R2)
const bucket = await self.buckets.open("uploads");
const file = await bucket.getFileHandle("image.png");
const contents = await (await file.getFile()).arrayBuffer();

// Cookie Store - cookie management
const session = await self.cookieStore.get("session");
await self.cookieStore.set("theme", "dark");

// AsyncContext - request-scoped state without prop drilling
const requestId = new AsyncContext.Variable();
requestId.run(crypto.randomUUID(), async () => {
  console.log(requestId.get()); // Works anywhere in the call stack
});
```

## Asset Pipeline

Import any file and get its production URL with content hashing:

```javascript
import styles from "./styles.css" with { assetBase: "/assets" };
import logo from "./logo.png" with { assetBase: "/assets" };

// styles = "/assets/styles-a1b2c3d4.css"
// logo = "/assets/logo-e5f6g7h8.png"
```

At build time, Shovel:
- Copies assets to the output directory with content hashes
- Generates a manifest mapping original paths to hashed URLs
- Transforms imports to return the final URLs

Assets are served via the platform's best option:
- **Cloudflare**: Workers Assets (edge-cached, zero config)
- **Node/Bun**: Static file middleware or bucket storage

## Packages

| Package | Description |
|---------|-------------|
| `@b9g/shovel` | CLI for development and deployment |
| `@b9g/platform` | Core runtime and platform APIs |
| `@b9g/platform-node` | Node.js adapter |
| `@b9g/platform-bun` | Bun adapter |
| `@b9g/platform-cloudflare` | Cloudflare Workers adapter |
| `@b9g/router` | URLPattern-based routing with middleware |
| `@b9g/cache` | Cache API implementation |
| `@b9g/filesystem` | File System Access implementation |
| `@b9g/match-pattern` | URLPattern with extensions (100% WPT) |
| `@b9g/async-context` | AsyncContext.Variable implementation |
| `@b9g/http-errors` | Standard HTTP error classes |
| `@b9g/auth` | OAuth2/PKCE and CORS middleware |
| `@b9g/assets` | Static asset handling |

## License

MIT
