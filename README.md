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
Shovel is obsessively standards-first. All Shovel APIs use web standards, and Shovel implements/shims useful standards when they're missing.

  | API | Standard | Purpose |
  |-----|----------|--------------|
  | `fetch()` | [Fetch](https://fetch.spec.whatwg.org) | Networking |
  | `"install"`, `"activate"`, `"fetch"` events | [Service Workers](https://w3c.github.io/ServiceWorker/) | Server lifecycle |
  | `AsyncContext.Variable` | [TC39 Stage 2](https://github.com/tc39/proposal-async-context) | Request-scoped state |
  | `self.caches` | [Cache API](https://w3c.github.io/ServiceWorker/#cache-interface) | Response caching |
  | `self.directories` | [FileSystem API](https://fs.spec.whatwg.org/) | Storage (local, S3, R2) |
  | `self.cookieStore` | [CookieStore API](https://cookiestore.spec.whatwg.org) | Cookie management |
  | `URLPattern` | [URLPattern](https://urlpattern.spec.whatwg.org/) | Route matching |

Your code uses standards. Shovel makes them work everywhere.

## Meta-Framework

Shovel is a meta-framework: it provides and implements primitives rather than opinions. Instead of dictating how you build, it gives you portable building blocks that work everywhere.

## True Portability

Same code, any runtime, any rendering strategy:

- **Server runtimes**: Node.js, Bun, Cloudflare Workers
- **Browser ServiceWorkers**: The same app can run as a PWA
- **Universal rendering**: Dynamic, static, or client-side

The core abstraction is the **ServiceWorker-style storage pattern**. Globals provide a consistent API for common web concerns:

```javascript
const cache = await self.caches.open("sessions");     // Cache API
const dir   = await self.directories.open("uploads"); // FileSystem API
const db    = await self.databases.open("main");      // ???
const log   = self.loggers.get("app", "requests");    // LogTape
```

Each storage type is:
- **Lazy** - connections created on first `open()`, cached thereafter
- **Configured uniformly** - all are configured by `shovel.json`
- **Platform-aware** - sensible defaults per platform, override what you need

This pattern means your app logic stays clean. Swap Redis for memory cache, S3 for local filesystem, Postgres for SQLite - change the config, not the code.


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

Configure Shovel using `shovel.json` in your project root.

### Philosophy

Shovel's configuration follows these principles:

1. **Platform Defaults, User Overrides** - Each platform provides sensible defaults. You only configure what you want to change.

2. **Uniform Interface** - Caches, directories, and loggers all use the same `{ module, export, ...options }` pattern. No magic strings or builtin aliases.

3. **Layered Resolution** - For any cache or directory name:
   - If config specifies `module`/`export` → use that
   - Otherwise → use platform default

4. **Platform Re-exports** - Each platform exports `DefaultCache` representing what makes sense for that environment:
   - Cloudflare: Native Cache API
   - Bun/Node: MemoryCache

5. **Transparency** - Config is what you see. Every backend is an explicit module path, making it easy to debug and trace.

### Basic Config

```json
{
  "port": "PORT || 3000",
  "host": "HOST || localhost",
  "workers": "WORKERS ?? 1",
  "caches": {
    "sessions": {
      "module": "@b9g/cache-redis",
      "export": "RedisCache",
      "url": "REDIS_URL"
    }
  },
  "directories": {
    "uploads": {
      "module": "@b9g/filesystem-s3",
      "export": "S3Directory",
      "bucket": "S3_BUCKET"
    }
  },
  "logging": {
    "loggers": [
      {"category": ["app"], "level": "info", "sinks": ["console"]}
    ]
  }
}
```

### Caches

Configure cache backends using `module` and `export`:

```json
{
  "caches": {
    "api-responses": {
      "module": "@b9g/cache/memory",
      "export": "MemoryCache"
    },
    "sessions": {
      "module": "@b9g/cache-redis",
      "export": "RedisCache",
      "url": "REDIS_URL"
    }
  }
}
```

- **Default**: Platform's `DefaultCache` when no config specified (MemoryCache on Bun/Node, native on Cloudflare)
- **Pattern matching**: Use wildcards like `"api-*"` to match multiple cache names
- **Empty config**: `"my-cache": {}` uses platform default explicitly

### Directories

Configure directory backends. Platforms provide defaults for well-known directories (`server`, `public`, `tmp`):

```json
{
  "directories": {
    "uploads": {
      "module": "@b9g/filesystem-s3",
      "export": "S3Directory",
      "bucket": "MY_BUCKET",
      "region": "us-east-1"
    },
    "data": {
      "module": "@b9g/filesystem/node-fs",
      "export": "NodeFSDirectory",
      "path": "./data"
    }
  }
}
```

- **Well-known defaults**: `server` (dist/server), `public` (dist/public), `tmp` (OS temp)
- **Custom directories**: Must be explicitly configured

### Logging

Shovel uses [LogTape](https://logtape.org/) for logging:

```json
{
  "logging": {
    "sinks": {
      "file": {
        "module": "@logtape/logtape",
        "export": "getFileSink",
        "path": "./logs/app.log"
      }
    },
    "loggers": [
      {"category": ["app"], "level": "info", "sinks": ["console"]},
      {"category": ["app", "db"], "level": "debug", "sinks": ["file"]}
    ]
  }
}
```

- **Console sink is implicit** - always available as `"console"`
- **Category hierarchy** - `["app", "db"]` inherits from `["app"]`
- **parentSinks** - use `"override"` to replace parent sinks instead of inheriting

### Expression Syntax

Configuration values support environment variable expressions:

| Expression | Meaning |
|------------|---------|
| `PORT \|\| 3000` | Use PORT env var, fallback to 3000 if falsy |
| `PORT ?? 3000` | Use PORT, fallback only if null/undefined |
| `MODE === production ? x : y` | Conditional based on environment |
| `REDIS_URL` | Environment variable reference |
| `@b9g/cache-redis` | String literal (supports @, /, -) |

Example with environment-based module selection:

```json
{
  "caches": {
    "sessions": {
      "module": "NODE_ENV === production ? @b9g/cache-redis : @b9g/cache/memory",
      "export": "NODE_ENV === production ? RedisCache : MemoryCache",
      "url": "REDIS_URL"
    }
  }
}
```

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
