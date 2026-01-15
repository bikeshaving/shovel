---
title: Getting Started
description: Get up and running with Shovel in minutes.
---

Shovel is a ServiceWorker-first universal deployment platform. Write your application once using the ServiceWorker API, then deploy it anywhere - Node.js, Bun, or Cloudflare Workers.

## Installation

```bash
npm install @b9g/shovel
```

Or with Bun:

```bash
bun add @b9g/shovel
```

## Quick Start

Create a simple ServiceWorker application:

```typescript
// src/server.ts
self.addEventListener("fetch", (event) => {
  event.respondWith(
    new Response("Hello from Shovel!", {
      headers: { "content-type": "text/plain" },
    })
  );
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

- Learn about [Configuration](/guides/configuration) options
- Explore [Routing](/guides/routing) with `@b9g/router`
- Add [Static Assets](/guides/assets) to your application
