# Shovel.js

**Run Service Workers anywhere.**

Shovel is a meta-framework for building server applications using the ServiceWorker API. Write once, deploy to Node.js, Bun, or Cloudflare Workers.

```typescript
// server.ts
import {Router} from "@b9g/router";

const router = new Router();

router.route("/kv/:key")
  .get(async (req, ctx) => {
    const cache = await self.caches.open("kv");
    const cached = await cache.match(ctx.params.key);
    return cached ?? new Response(null, {status: 404});
  })
  .put(async (req, ctx) => {
    const cache = await self.caches.open("kv");
    await cache.put(ctx.params.key, new Response(await req.text()));
    return new Response(null, {status: 201});
  })
  .delete(async (req, ctx) => {
    const cache = await self.caches.open("kv");
    await cache.delete(ctx.params.key);
    return new Response(null, {status: 204});
  });

self.addEventListener("fetch", (ev) => {
  ev.respondWith(router.handle(ev.request));
});
```

```bash
$ shovel develop server.ts
listening on http://localhost:7777

$ curl -X PUT :7777/kv/hello -d "world"

$ curl :7777/kv/hello
world
```

## Quick Start

```bash
# Create a new project
npm create @b9g/shovel my-app

# Development with hot reload
npx @b9g/shovel develop src/server.ts

# Build for production
npx @b9g/shovel build src/server.ts --platform=node
npx @b9g/shovel build src/server.ts --platform=bun
npx @b9g/shovel build src/server.ts --platform=cloudflare
```

## Documentation

Visit [shovel.js.org](https://shovel.js.org) for guides and API reference.

## Packages

| Package | Description |
|---------|-------------|
| `@b9g/shovel` | CLI for development and deployment |
| `@b9g/router` | URLPattern-based routing with middleware |
| `@b9g/cache` | Cache API implementation |
| `@b9g/filesystem` | File System Access implementation |
| `@b9g/async-context` | AsyncContext.Variable implementation |
| `@b9g/http-errors` | Standard HTTP error classes |
| `@b9g/assets` | Static asset handling |
| `@b9g/platform` | Core runtime and platform APIs |
| `@b9g/platform-node` | Node.js adapter |
| `@b9g/platform-bun` | Bun adapter |
| `@b9g/platform-cloudflare` | Cloudflare Workers adapter |

## License

MIT
