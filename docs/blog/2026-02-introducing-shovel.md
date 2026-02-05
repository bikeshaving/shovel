---
title: Introducing Shovel
description: The story behind Shovel.js
date: 2026-02-05
author: Brian Kim
authorURL: https://github.com/brainkim
---

Today, I’m happy to announce my first major AI-built open source project, which took approximately three months of development. No, it’s not an AI village tool where bots waste tokens. Rather, **Shovel.js** is a three-month meditation on the question “what if your server was just a service worker?” It is a CLI and set of libraries for developing and deploying Service Workers as web applications. It is both a full-stack server framework replacing tools like Express, Fastify or Hono, and a meta-framework / compiler replacing tools like Vite or Next.js.

The following is a contemporary description of what building a greenfield open source project with AI is like, and a quick tour of some of its most elegantly designed features.

## The Journey

Work on Shovel began in earnest in October 2025, right about when the Remix team announced a reboot of their full stack runtime. Notably, they decided to divorce from React.js as their UI framework, opting to roll their own instead. As the author of [Crank.js](https://crank.js.org), I was disappointed that they didn’t choose to adopt Crank directly, even though it was [mentioned as inspiration for their own UI framework](https://xcancel.com/ryanflorence/status/1977719354180485197). Nevertheless, it would have been intensely hypocritical for me to begrudge any developer for choosing to roll their own anything, and it seems like the Remix team is having fun owning the entire stack.

Ultimately though, this signaled to me that I couldn’t wait for some other framework author to build a full-stack Crank meta-framework: I would have to do it myself. At the time, the Crank documentation website was running on a rudimentary static site generator I had hacked together with ESBuild, aspirationally named “Shovel.js.” Could I expand this to a full-fledged server framework? What would it look like? How long would it take? I was eager to see how much more efficiently I could write code with Claude Code by my side.

## The Design Philosophy

The plan for the design of Shovel was simple: create a way to run Service Workers anywhere. For the longest time I’ve been fascinated by this idea. In my free time, I would look through MDN the same way other people go down Wikipedia rabbit holes, finding hidden gems like [the FileSystem API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API), [the CookieStore API](https://developer.mozilla.org/en-US/docs/Web/API/CookieStore) and [the Cache API](https://developer.mozilla.org/en-US/docs/Web/API/Cache). These are real, rigorously specified abstractions which are shipped in all major browsers.

Surely, these abstractions could be repurposed for server contexts? Most contemporary JavaScript server frameworks are headed in this direction. For instance, almost all server frameworks written today use the fetch standard’s `Request` and `Response` classes rather than Node’s idiosyncratic `IncomingMessage` and `OutgoingMessage` ones. But I wanted to take things a step further. What if, rather than designing new APIs, we could just provide shims and implementations of all the applicable browser standards found on MDN?

I started by asking Claude Code to implement the Service Worker’s `Cache` and `CacheStorage` classes for Bun and Node. It did so quickly and accurately. As it turns out, this type of work is right in Claude’s wheelhouse. I discovered you could just direct Claude to a web specification, and it would write a reasonable implementation, usually by one-shot.

As of today, we’ve implemented at least six different browser standards and brought them together as a feature-complete constellation of NPM packages, tied together by a command line interface which covers both development and deployment workflows. Together, these APIs create a cohesive user experience where you can write code that looks like browser service worker code but run it on Node, Bun or Cloudflare.

For example, here is a service worker which exposes the cache system as a RESTful API:

```ts
async function handleResponse(ev: FetchEvent): Promise<Response> {
  const url = new URL(ev.request.url);
  const cache = await self.caches.open("kv");

  if (ev.request.method === "GET") {
    const cached = await cache.match(url);
    return cached || new Response("Not Found", {status: 404});
  }

  if (ev.request.method === "PUT") {
    const body = await ev.request.text();
    await cache.put(url, new Response(body));
    return new Response("OK", {status: 201});
  }

  if (ev.request.method === "DELETE") {
    await cache.delete(url);
    return new Response("OK", {status: 204});
  }

  return new Response("Method Not Allowed", {status: 405});
}

self.addEventListener("fetch", (ev) => {
  ev.respondWith(handleResponse(ev));
});
```

## Architectural Flourishes

While the plan of implementing standards was straightforward, there were still gaps which needed to be filled. The browser service worker doesn’t implement essential features like routing, middleware, local filesystems, database adapters, logging, or the configuration of all requisite services. This would require some careful design thinking from me, the human. The approach I decided to take was to extrapolate rather than invent: if browser service workers look like this, then what do these server features look like? Here’s some of what we’ve come up with.

### Router and Middleware

While the browser has a concept of URLs and matching with [URLPattern](https://developer.mozilla.org/en-US/docs/Web/API/URLPattern), there is still no unified routing abstraction for calling code based on requests and method. Therefore, the package `@b9g/router` implements a fast, fetch and Promise-based router with middleware.

```ts
import {Router} from "@b9g/router";

const router = new Router();
const cache = await caches.open("kv");

router.route("/kv/:key")
  .get(async (req, ctx) => {
    const cached = await cache.match(ctx.params.key);
    return cached || new Response("Not Found", {status: 404});
  })
  .put(async (req, ctx) => {
    await cache.put(ctx.params.key, new Response(await req.text()));
    return new Response("OK", {status: 201});
  })
  .delete(async (req, ctx) => {
    await cache.delete(ctx.params.key);
    return new Response(null, {status: 204});
  });

self.addEventListener("fetch", (ev) => {
  ev.respondWith(router.handle(ev.request));
});
```

The router uses MatchPattern, a slightly simplified subset of URLPattern optimized for server-side routing. Under the hood, routes compile to a radix tree for O(1) path matching—the same algorithm used by fastify and other high-performance routers.

Of course, it wouldn't be a Brian Kim open source project without a creative use of generator functions. The router implements a flexible Rack-style (last in, first out) middleware system where you can modify requests and responses with functions and generator functions.

```ts
// Function middleware: return Response to short-circuit, or null to continue
router.use("/api", async (req, ctx) => {
  const token = req.headers.get("Authorization");
  if (!token) {
    return new Response("Unauthorized", {status: 401});
  }
  ctx.user = await verifyToken(token);
});

// Generator middleware: yield to call next, then modify the response
router.use(async function* timing(req) {
  const start = Date.now();
  const response = yield;
  response.headers.set("X-Response-Time", `${Date.now() - start}ms`);
  return response;
});

// The router package provides built-in middleware as higher-order functions
import {cors} from "@b9g/router/middleware";

// Built-in CORS middleware
router.use(cors({origin: "https://example.com"}));
```

The `yield` statement marks where control passes to the next handler. When that handler returns, execution resumes after the yield with the response. Most frameworks use a separate `next()` function parameter, but generators make the control flow explicit — before `yield` is the request phase, after `yield` is the response phase.

### Curated Globals

<!--
Not everything earns a spot on `self`. Each API has to be:
- Configurable backends (swap implementations without changing code)
- Standards-quality rigor (feels like it belongs on MDN)
- Universal runtime support (works on Node, Bun, and Cloudflare)

Examples: caches, directories, databases, loggers, cookieStore

Brief mention of how it works: Shovel patches globalThis with the ServiceWorker API surface.
-->

### Assets

<!--
Shovel is also a meta-framework/compiler (the Vite/Next.js replacement).

Import attributes for assets:
```ts
import styles from "./styles.css" with { assetBase: "/static/" };
```

ESBuild under the hood, code splitting, content hashing.

Works with HTML-first UI approaches: Crank, HTMX, Lit, Alpine.js - anything that doesn't require complex compiler integration.
-->

### Self-fetching and SSG

<!--
The clever bit: fetch() during install/activate calls your own router.

```typescript
self.addEventListener("install", (event) => {
  event.waitUntil(async () => {
    const response = await fetch("/about");
    // writes to dist/public/about.html
  });
});
```

Same code serves dynamic requests and generates static pages. No separate SSG tooling.
-->

### Configuration

<!--
shovel.json ties it all together:

```json
{
  "caches": {
    "pages": {
      "module": "$NODE_ENV === production ? @b9g/cache-redis : @b9g/cache"
    }
  },
  "databases": {
    "main": {
      "module": "@b9g/zen/bun",
      "url": "$DATABASE_URL"
    }
  }
}
```

Same code, different backends per environment. The capstone of the curated globals story.
-->

## Shovel Ready
