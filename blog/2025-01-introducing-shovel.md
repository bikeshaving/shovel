---
title: Introducing Shovel
description: Run Service Workers anywhere with Shovel.
date: 2025-01-31
author: Brian Kim
---

Today we're excited to announce **Shovel**, a framework for running Service Workers everywhere.

## The Problem

Web developers have long embraced the Request/Response model through Service Workers in browsers. But when it comes to server-side code, we're stuck with a fragmented ecosystem: Express for Node, Hono for edge, different patterns for each runtime.

What if you could write your server code once and run it anywhere?

## Enter Shovel

Shovel lets you write server applications using the Service Worker API you already know:

```typescript
self.addEventListener("fetch", (event) => {
  event.respondWith(new Response("Hello World"));
});
```

This code runs on:
- **Node.js** - For traditional server deployments
- **Bun** - For maximum performance
- **Cloudflare Workers** - For edge deployment

No code changes. No platform-specific APIs. Just standard web APIs.

## Why Service Workers?

The Service Worker specification is battle-tested. It's been running in browsers for years, handling billions of requests. The APIs are designed for:

- **Intercepting requests** - Full control over routing
- **Caching responses** - Built-in Cache API
- **Background processing** - Event-driven architecture

Shovel brings these capabilities to the server.

## Getting Started

Install Shovel and create your first app:

```bash
npm install @b9g/shovel
npx shovel init my-app
cd my-app
npx shovel dev
```

You'll have a running server in seconds.

## What's Included

Shovel comes with everything you need:

- **Router** - Fast, type-safe routing with path parameters
- **Middleware** - Generator-based middleware for clean before/after hooks
- **Assets** - Content-hashed static files with automatic cache busting
- **Databases** - Universal database adapters for SQLite, PostgreSQL, D1
- **Caches** - Standard Cache API with pluggable backends

## What's Next

We're just getting started. On our roadmap:

- More database adapters
- WebSocket support
- Improved developer tooling
- Additional deployment targets

Check out the [Getting Started guide](/guides/getting-started) to try Shovel today.

We can't wait to see what you build.
