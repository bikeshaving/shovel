---
title: Introducing Shovel
description: The story behind Shovel.js
date: 2026-02-05
author: Brian Kim
---

Today, I’m happy to announce my first major AI-built open source project, which took approximately three months of development. No, it’s not an AI village tool where bots waste tokens. Rather, **Shovel.js** is a three-month meditation on the question “what if your server was just a service worker?” It is a CLI and set of libraries for developing and deploying Service Workers as web applications. It is both a full-stack server framework replacing tools like Express, Fastify or Hono, and a meta-framework / compiler replacing tools like Vite or Next.js.

The following is a contemporary description of what building a greenfield open source project with AI is like, and a quick tour of some of its most elegantly designed features.

## The Journey

Work on Shovel began in earnest in October 2025, right about when the Remix team announced a reboot of their full stack runtime. Notably, they decided to divorce from React.js as their UI framework, opting to roll their own instead. As the author of [Crank.js](https://crank.js.org), I was disappointed that they didn’t choose to adopt Crank directly, even though it was [mentioned as inspiration for their own UI framework](https://xcancel.com/ryanflorence/status/1977719354180485197). Nevertheless, it would have been intensely hypocritical for me to begrudge any developer for choosing to roll their own anything, and it seems like the Remix team is having fun owning the entire stack.

Ultimately though, this signaled to me that I couldn’t wait for some other framework author to build a full-stack Crank meta-framework: I would have to do it myself. At the time, the Crank documentation website was running on a rudimentary static site generator I had hacked together with ESBuild, aspirationally named “Shovel.js.” Could I expand this to a full-fledged server framework? What would it look like? How long would it take? I was eager to see how much more efficiently I could write code with Claude Code by my side.

## The Design Philosophy

The plan for the design of Shovel was simple: create a way to run Service Workers anywhere and implement all related web standards. For the longest time I’ve been fascinated by this idea. In my free time, I would look through MDN the same way other people go down Wikipedia rabbit holes, finding hidden gems like [the FileSystem API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API), [the CookieStore API](https://developer.mozilla.org/en-US/docs/Web/API/CookieStore), and [the Cache API](https://developer.mozilla.org/en-US/docs/Web/API/Cache). These are real, rigorously specified abstractions which are shipped in all major browsers.

Could these battle-tested APIs be repurposed for servers? Most contemporary JavaScript server frameworks seem to be moving in this direction. For instance, almost all server frameworks written today use the fetch standard’s `Request` and `Response` classes rather than Node’s idiosyncratic `IncomingMessage` and `OutgoingMessage` ones. And there’s been a push to find a minimal common API for browsers (WinterTC). But I wanted to take things a step further. What if, rather than designing new APIs, we could just provide shims and implementations of all the applicable browser standards found on MDN?

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
const cache = await self.caches.open("kv");

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

The router uses `MatchPattern`, a URLPattern-compatible implementation with routing enhancements like order-independent search parameters. Our bundled `URLPattern` class passes 100% of the Web Platform Tests while being ~40-60x faster than the native browser implementation. Under the hood, routes compile to a radix tree for O(1) path matching—the same algorithm used by fastify and other high-performance routers.

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
  const response = yield req;
  response.headers.set("X-Response-Time", `${Date.now() - start}ms`);
  return response;
});

// The router package provides built-in middleware as higher-order functions
import {cors} from "@b9g/router/middleware";

// Built-in CORS middleware
router.use(cors({origin: "https://example.com"}));
```

The `yield` statement marks where control passes to the next handler. When that handler returns, execution resumes after the yield with the response. Most frameworks use a separate `next()` function parameter, whereas the Shovel router uses control flow to make the request/response lifecycle explicit: before `yield` is the request phase, after `yield` is the response phase. Using control flow means you can't have situations where you forget to call `next()`, or call it outside of the async handler's execution window.

### Curated Globals

As we’ve seen, browser Service Workers have a built-in cache abstraction (`self.caches`), but servers also need stateful file systems, loggers, access to relational databases. While you could import these directly as libraries, we’ve taken the Service Worker storage pattern and expanded them into a curated set of helpful abstractions.

Not everything earns a spot on `self`. Each API has to be:
- Configurable to work with multiple backends
- Standards-quality rigor (feels like it belongs on MDN)
- Universal runtime support (works on Node, Bun, and Cloudflare)

Some are direct web standards: the [Cache API](https://developer.mozilla.org/en-US/docs/Web/API/Cache) for caching, the [FileSystem API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API) for file storage, and the [CookieStore API](https://developer.mozilla.org/en-US/docs/Web/API/CookieStore) for cookie management. Others are carefully chosen libraries that feel like they *could* be standards—like [LogTape](https://logtape.org/) for structured logging, or ZenDB, our SQL library with IndexedDB-style migrations and Zod-based schemas.

Shovel provides an env-driven configuration format `shovel.json` which ties it all together, following the [12-factor app](https://12factor.net/) philosophy of separating config from code:

```json
{
  "caches": {
    "pages": {
      "module": "$MODE === production ? @b9g/cache-redis : @b9g/cache/memory"
    }
  },
  "databases": {
    "main": {
      "module": "@b9g/zen/bun",
      "url": "$DATABASE_URL"
    }
  },
  "directories": {
    "uploads": {
      "module": "$MODE === production ? @b9g/filesystem-s3 : @b9g/filesystem",
      "bucket": "$S3_BUCKET"
    }
  },
  "logging": {
    "sinks": {
      "otel": {
        "module": "@logtape/otel",
        "export": "getOpenTelemetrySink"
      }
    },
    "loggers": [
      { "category": "app", "level": "info", "sinks": ["otel"] }
    ]
  }
}
```

Same code, any backend. Your service worker calls `self.caches.open("pages")` or `self.databases.get("main")`, and it can be configured to work with SQLite or Postgres, local disk or Redis. Here's what file upload handler might look like using some of the global storages we mentioned:

```ts
router.route("/api/uploads").post(async (req, ctx) => {
  const logger = self.loggers.get(["app", "uploads"]);
  const db = self.databases.get("main");
  const uploads = await self.directories.open("uploads");

  const form = await req.formData();
  const file = form.get("file") as File;

  logger.info("Upload started", {name: file.name, size: file.size});

  // Save to filesystem (local in dev, S3 in prod)
  const userDir = await uploads.getDirectoryHandle(ctx.user.id, {create: true});
  const handle = await userDir.getFileHandle(file.name, {create: true});
  const writable = await handle.createWritable();
  await writable.write(file);
  await writable.close();

  // Record in database
  const record = await db.insert(Uploads, {
    userId: ctx.user.id,
    filename: file.name,
    size: file.size,
  });

  logger.info("Upload complete", {id: record.id});
  return Response.json(record, {status: 201});
});
```

### Client-side Assets

One of the harder parts to design was the way client assets are referenced and used... The key innovation is that we use [import attributes](https://github.com/tc39/proposal-import-attributes) to declare asset dependencies:

```ts
import favicon from "./favicon.ico" with { assetBase: "/", assetName: "favicon.ico" };
import styles from "./styles.css" with { assetBase: "/static/" };
import client from "./client.ts" with { assetBase: "/static/" };

// favicon = "/favicon.ico" (no hash, well-known path)
// styles = "/static/styles-abc123.css"
// client = "/static/client-def456.js"

router.route("/").get(() => {
  return new Response(`
    <!DOCTYPE html>
    <html>
      <head>
        <link rel="icon" href="${favicon}">
        <link rel="stylesheet" href="${styles}">
      </head>
      <body>
        <h1>Hello from Shovel</h1>
        <script src="${client}"></script>
      </body>
    </html>
  `, { headers: { "Content-Type": "text/html" } });
});
```

ESBuild handles bundling, content hashing, and code splitting under the hood. This approach works naturally with HTML-first UI libraries: [Crank](https://crank.js.org), [HTMX](https://htmx.org), [Lit](https://lit.dev), [Alpine.js](https://alpinejs.dev)—anything that doesn't require deep compiler integration. If your framework renders HTML strings or DOM nodes, it works with Shovel.

### One Framework, Every Rendering Strategy

Shovel doesn't force you into a single architecture. The same codebase can serve:

- **SPA**: Serve a shell HTML file, let client JavaScript handle routing
- **MPA**: Traditional multi-page apps with full page navigations
- **SSR**: Dynamic server rendering on each request
- **SSG**: Pre-rendered static HTML at build time

The clever bit is how SSG works. During the build, Shovel spins up your service worker and calls `fetch()` against your own routes. The responses get written to static HTML files:

```ts
self.addEventListener("install", (ev) => {
  ev.waitUntil(async () => {
    // These fetch calls hit your own router
    await fetch("/");
    await fetch("/about");
    await fetch("/blog");
    // Responses are saved as static HTML in dist/public/
  });
});
```

The same route handler that serves dynamic requests also generates your static pages. No separate SSG tooling, no duplicate templates, no build-time data fetching abstraction. Just `fetch()`.

## Shovel Ready

Three months ago, I set out to answer a simple question: what if your server was just a service worker? With Claude Code as my pair programmer, I've shipped more code in less time than I ever thought possible. The AI didn't just write boilerplate—it implemented entire browser specifications from scratch, correctly, often in a single pass.

But the interesting parts were still mine to figure out. The decision to extrapolate from standards rather than invent new APIs. The generator middleware pattern. The curated globals philosophy. The self-fetching SSG trick. Claude helped me move fast, but the architectural vision required a human touch.

Shovel is ready for early adopters. The documentation is comprehensive, the test suite is thorough, and I'm using it in production for this very website. If you've been looking for a framework that respects web standards, runs anywhere, and doesn't lock you into a single rendering strategy, give it a try.

```bash
npm install -g @b9g/shovel
shovel create my-app
cd my-app && shovel dev
```

Star the repo, file issues, send PRs. Let's dig in.

[GitHub](https://github.com/bikeshaving/shovel) · [Documentation](/docs)
