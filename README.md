# Shovel.js 🪏

**The portable meta-framework built on web standards.**

Shovel is a CLI platform for developing and deploying service workers as application servers.

```javascript
import {Router} from "@b9g/router";
const router = new Router();

router.route("/").get(() => new Response("Hello world"));

self.addEventListener("fetch", (ev) => {
  ev.respondWith(router.handle(ev.request));
});
```

```bash
shovel develop app.js
```
## Quick Start

```javascript
// app.js
import {Router} from "@b9g/router";

const router = new Router();

router.route("/").get(() => new Response("Hello World"));

router.route("/greet/:name").get((request, {params}) => {
  return new Response(`Hello ${params.name}`);
});

self.addEventListener("fetch", (event) => {
  event.respondWith(router.handle(event.request));
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


## Web Standards
Shovel is obsessively standards-first. All Shovel APIs use web standards , and implements/shims 

  | API | Standard | Purpose |
  |-----|----------|--------------|
  | `fetch()` | [Fetch](https://fetch.spec.whatwg.org) | Networking |
  | `addEventListener()` | [Service Workers](https://w3c.github.io/ServiceWorker/) | Server lifecycle |
  | `caches` | [Cache API](https://w3c.github.io/ServiceWorker/#cache-interface) | Response caching |
  | `directories` | [FileSystem API](https://fs.spec.whatwg.org/) | Storage (local, S3, R2) |
  | `cookieStore` | [Cookie Store API](https://wicg.github.io/cookie-store/) | Cookie management |
  | `URLPattern` | [URLPattern](https://urlpattern.spec.whatwg.org/) | Route matching |
  | `AsyncContext.Variable` | [TC39 Stage 2](https://github.com/tc39/proposal-async-context) | Request-scoped state |

Your code uses standards. Shovel makes them work everywhere.

## True Portability

Shovel is a complete meta-framework. Same code, any runtime, any rendering strategy:

- **Server runtimes**: Node.js, Bun, Cloudflare Workers for development and production
- **Browser ServiceWorkers**: The same app can run as a PWA service worker
- **Universal rendering**: Dynamic, static, or client-side - link and deploy assets automatically

## Platform APIs

```javascript
// Cache API - response caching
const cache = await self.caches.open("my-cache");
await cache.put(request, response.clone());
const cached = await cache.match(request);

// File System Access - storage directories (local, S3, R2)
const directory = await self.directories.open("uploads");
const file = await directory.getFileHandle("image.png");
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
- **Node/Bun**: Static file middleware or directory storage

## Configuration

Configure Shovel using `shovel.json` in your project root:

```json
{
  "port": "PORT || 3000",
  "host": "HOST || localhost",
  "workers": "WORKERS ?? 1",
  "logging": {
    "level": "LOG_LEVEL || info",
    "sinks": [{"provider": "console"}]
  },
  "caches": {
    "sessions": {
      "provider": "MODE === production ? redis : memory",
      "url": "REDIS_URL"
    }
  },
  "directories": {
    "uploads": {
      "provider": "s3",
      "bucket": "S3_BUCKET"
    }
  }
}
```

### Expression Syntax

Configuration values support environment variable expressions:

| Expression | Meaning |
|------------|---------|
| `PORT \|\| 3000` | Use PORT env var, fallback to 3000 if falsy |
| `PORT ?? 3000` | Use PORT, fallback only if null/undefined |
| `MODE === production ? redis : memory` | Conditional based on environment |
| `REDIS_URL` | Environment variable reference |
| `localhost` | String literal (lowercase/kebab-case) |

### Built-in Providers

**Caches**: `memory`, `redis`
**Directories**: `node-fs`, `memory`, `s3`
**Logging sinks**: `console`, `file`, `rotating`, `otel`, `sentry`, `cloudwatch`

### Access in Code

```javascript
import {config} from "shovel:config";
console.log(config.port); // Resolved value
```

## Packages

| Package | Description |
|---------|-------------|
| `@b9g/shovel` | CLI for development and deployment |
| `@b9g/platform` | Core runtime and platform APIs |
| `@b9g/platform-node` | Node.js adapter |
| `@b9g/platform-bun` | Bun.js adapter |
| `@b9g/platform-cloudflare` | Cloudflare Workers adapter |
| `@b9g/router` | URLPattern-based routing with middleware |
| `@b9g/cache` | Cache API implementation |
| `@b9g/filesystem` | File System Access implementation |
| `@b9g/match-pattern` | URLPattern with extensions (100% WPT) |
| `@b9g/async-context` | AsyncContext.Variable implementation |
| `@b9g/http-errors` | Standard HTTP error classes |
| `@b9g/assets` | Static asset handling |

## License

MIT
