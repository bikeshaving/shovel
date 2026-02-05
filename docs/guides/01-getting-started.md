---
title: Getting Started
description: Get up and running with Shovel in minutes.
---

Shovel is a framework for building and deploying ServiceWorker applications. Write your application once using web standards, then deploy it anywhere—Node.js, Bun, or Cloudflare Workers.

## Create a Project

The fastest way to start is with `shovel create`:

```bash
npm create shovel my-app
cd my-app
npm install
npm run dev
```

This scaffolds a new project with your choice of template (hello-world, api, static-site, or full-stack).

## Manual Setup

Or set up manually:

```bash
npm install @b9g/shovel @b9g/router
```

Create a ServiceWorker entry point:

```typescript
// src/server.ts
import {Router} from "@b9g/router";

const router = new Router();

router.route("/").get(() => {
  return new Response("Hello from Shovel!");
});

self.addEventListener("fetch", (event) => {
  event.respondWith(router.handle(event.request));
});
```

Run in development mode:

```bash
npx shovel develop src/server.ts
```

Your server is now running at `http://localhost:3000`.

## Building for Production

```bash
npx shovel build src/server.ts
```

This creates an optimized build in the `dist/` directory that you can deploy to your target platform.

## Platforms

Shovel supports multiple deployment targets:

- **Node.js** - `--platform node`
- **Bun** - `--platform bun` (default)
- **Cloudflare Workers** - `--platform cloudflare`

Example with a specific platform:

```bash
npx shovel develop src/server.ts --platform node
```

## Next Steps

- Learn about [Configuration](./02-configuration.md) options
- Explore [Routing](/api/router) with `@b9g/router`
- Add [Static Assets](/api/assets) to your application
