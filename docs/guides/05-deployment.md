---
title: Deployment
description: Deploy your Shovel app to Node, Bun, or Cloudflare Workers.
---

Shovel apps run on multiple platforms with minimal changes.

## Build for Production

```bash
shovel build src/server.ts
```

This creates a `dist/` directory:

```
dist/
├── server/
│   ├── worker.js      # Bundled ServiceWorker
│   └── server.js      # Server entry point
└── public/            # Static assets
```

## Node.js

```bash
cd dist/server
node server.js
```

With environment variables:

```bash
PORT=8080 node dist/server/server.js
```

## Bun

```bash
cd dist/server
bun server.js
```

## Cloudflare Workers

Set platform in `shovel.json`:

```json
{
  "platform": "cloudflare"
}
```

Build and deploy:

```bash
shovel build src/server.ts --platform cloudflare
npx wrangler deploy
```

Basic `wrangler.toml`:

```toml
name = "my-app"
main = "dist/server/server.js"
compatibility_date = "2024-01-01"

[site]
bucket = "./dist/public"
```

## Health Checks

Add a health endpoint for monitoring:

```typescript
router.route("/health").get(() => {
  return Response.json({ ok: true });
});
```

## Next Steps

- See [Deployment Reference](/docs/deployment) for Docker, Nginx, and more
- Learn about [shovel.json](/docs/shovel-json) configuration
