---
title: Introducing Shovel
description: The story behind Shovel.js, a framework which asks the question “What if your server was just a service worker?”
date: 2026-02-07
author: Brian Kim
authorURL: https://github.com/brainkim
---

Today, I’m happy to announce my first major AI-assisted open source project. And no, it’s not a weird AI village creating tool. Rather, *Shovel.js* is a three-month meditation on the question: “what if your server was just a service worker?” The result is a command-line interface and a set of libraries for developing and deploying Service Workers as web applications. Shovel is both a full-stack server framework replacing tools like Express, Fastify or Hono, and a meta-framework / compiler replacing tools like Vite or Next.js.

The following is a contemporary description of what building a greenfield open source project with AI is like, as well as a quick tour of some of Shovel’s most elegantly designed features.

## The Start of the Journey

Work on Shovel began in earnest in October 2025, right about when the Remix team announced a reboot of their full stack runtime. Notably, they decided to [migrate away from React.js as their UI framework](https://remix.run/blog/wake-up-remix), opting to roll their own [component framework](https://github.com/remix-run/remix/tree/main/packages/component) instead. As the author of [Crank.js](https://crank.js.org), I was disappointed that they didn’t choose to adopt Crank directly, even though it was [mentioned as inspiration for the framework they built](https://xcancel.com/ryanflorence/status/1977719354180485197). Nevertheless, it would have been intensely hypocritical for me to begrudge any developer for choosing to roll their own anything, and it seems like the Remix team is having fun owning the entire stack.

Ultimately though, this signaled to me that I couldn’t wait for someone else to build a full-stack Crank meta-framework: I would have to do it myself. At the time, the Crank documentation website was running on a rudimentary static site generator I had hacked together with ESBuild, aspirationally named “Shovel.js.” Could I expand this into a full-fledged framework? What would it look like? How long would it take? I was eager to see how much more efficiently I could complete this immense, open-ended task with Claude Code by my side.

## The Design Philosophy

The plan for Shovel was simple: create a way to run Service Workers anywhere, by implementing all related standards and specifications. For years, I’ve been fascinated by this idea. In my free time, I would look through MDN the same way other people go down Wikipedia rabbit holes, finding hidden gems like [the FileSystem API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API), [the CookieStore API](https://developer.mozilla.org/en-US/docs/Web/API/CookieStore), and [the Cache API](https://developer.mozilla.org/en-US/docs/Web/API/Cache). These are real, rigorously specified abstractions which are shipped in all major browsers.

Could these battle-tested APIs be repurposed for server runtimes? Most contemporary JavaScript server frameworks seem to be moving in this direction. For instance, almost all server frameworks written today use the fetch standard’s `Request` and `Response` classes rather than Node’s idiosyncratic `IncomingMessage` and `OutgoingMessage` ones. And there’s been a push to find a **minimal common API** across JavaScript runtimes like Bun, Node and Cloudflare Workers (see [WinterTC](https://wintertc.org/)). But I wanted to take things a step further. What if, rather than designing new APIs, we just provided shims and implementations of all the applicable browser standards found on MDN?

I started by asking Claude Code to implement the Service Worker’s `Cache` abstractions for Bun and Node. It produced a working implementation in a single shot. As it turns out, this type of work is right in Claude’s wheelhouse. I discovered you could just direct Claude to a web specification, and it would write a reasonable implementation.

As of today, we’ve implemented at least six different browser standards and brought them together as a feature-complete constellation of NPM packages, tied together by a CLI which covers both development and deployment workflows. Together, these tools create a cohesive user experience where you can write code that looks like browser service workers but run it on Node, Bun or Cloudflare.

For example, here is a service worker which exposes the cache system as a REST-ful API:

```ts
self.addEventListener("fetch", (ev) => {
  ev.respondWith(handleRequest(ev.request));
});

async function handleRequest(req: Request): Promise<Response> {
  const cache = await self.caches.open("kv");

  if (req.method === "GET") {
    const cached = await cache.match(req.url);
    return cached || new Response("Not Found", {status: 404});
  }

  if (req.method === "PUT") {
    const body = await req.text();
    await cache.put(req.url, new Response(body));
    return new Response("OK", {status: 201});
  }

  if (req.method === "DELETE") {
    await cache.delete(req.url);
    return new Response("OK", {status: 204});
  }

  return new Response("Method Not Allowed", {status: 405});
}
```

## Architectural Flourishes

While the plan of shimming all of MDN for servers was straightforward, there were still gaps in what’s necessary for a full-stack framework. Browser service workers don’t implement features like routing, middleware, local filesystems, database adapters, structured logging, or the configuration of all these services. This would require some careful design thinking from me, the human. The approach I decided to take was to extrapolate rather than invent: if browser service workers look like *this*, then what would the missing server features look like? Here’s some of what we’ve come up with.

### Router and Middleware

While the browser has a concept of URLs and matching with [URLPattern](https://developer.mozilla.org/en-US/docs/Web/API/URLPattern), there is still no unified routing abstraction for executing code based on request and method. Therefore, the package `@b9g/router` implements a fast router with middleware.

```ts
import {Router} from "@b9g/router";

const router = new Router();
const logger = self.loggers.get(["app", "cache"]);

router.route("/kv/:key")
  .get(async (req, ctx) => {
    logger.info`GET ${ctx.params.key}`;
    const cache = await self.caches.open("kv");
    const cached = await cache.match(req.url);
    return cached || new Response("Not Found", {status: 404});
  })
  .put(async (req, ctx) => {
    logger.info`PUT ${ctx.params.key}`;
    const cache = await self.caches.open("kv");
    await cache.put(req.url, new Response(await req.text()));
    return new Response("OK", {status: 201});
  })
  .delete(async (req, ctx) => {
    logger.info`DELETE ${ctx.params.key}`;
    const cache = await self.caches.open("kv");
    await cache.delete(req.url);
    return new Response(null, {status: 204});
  });

self.addEventListener("fetch", (ev) => {
  ev.respondWith(router.handle(ev.request));
});
```

The router uses [`MatchPattern`](https://github.com/bikeshaving/shovel/tree/main/packages/match-pattern), a URLPattern-compatible implementation. Our bundled `URLPattern` class passes 100% of the Web Platform Tests while being significantly faster than native browser implementations. Under the hood, routes compile to a radix tree for O(1) path matching — the same algorithm used by Fastify and other high-performance routers.

Of course, it wouldn’t be a Brian Kim open source project without a creative use of generator functions. The router implements a flexible, Rack-style (last in, first out) middleware system where you can modify requests and responses with functions and generator functions.

```ts
// Function middleware: return Response to short-circuit, or null/undefined to continue
router.use("/api", async (req, ctx) => {
  const token = req.headers.get("Authorization");
  if (!token) {
    return new Response("Unauthorized", {status: 401});
  }
  ctx.user = await verifyToken(token);
});

// Generator middleware: yield to get next response and modify it
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

The `yield` operator marks where control passes to the next handler. When that handler returns, execution resumes after the yield with the response. Other frameworks typically use a separate `next()` function to pass to later middleware, whereas the Shovel router uses control flow to clarify the middleware lifecycle: before `yield` is the request phase, after `yield` is the response phase. Using control flow means you can’t have situations where you forget to call `next()`, or call it outside of an async middleware’s execution window.

### Curated Globals

As we’ve seen, browser Service Workers have a built-in cache abstraction (`self.caches`), but servers also need stateful file systems, loggers, relational databases. While you could import these directly as libraries, we’ve taken the Service Worker storage pattern and expanded them into a curated set of helpful globals.

Not everything earns a spot on `self`. Each API has to be:
- Configurable across multiple backends
- Rigorous enough to feel like it belongs on MDN
- Universal across server and server-less platforms

Many are direct web standards: the [Cache API](https://developer.mozilla.org/en-US/docs/Web/API/Cache) for caching, the [FileSystem API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API) for file storage, and the [CookieStore API](https://developer.mozilla.org/en-US/docs/Web/API/CookieStore) for cookie management. Others are carefully chosen libraries that feel like they *could* be standards: [LogTape](https://logtape.org/) for structured logging, or [ZenDB](https://github.com/bikeshaving/ZenDB), a SQL library which brings IndexedDB-style migrations and Zod-based schemas to relational databases. Okay, ZenDB is also written by me, but I do think it exhibits “standard-like” qualities.

Shovel provides an env-driven configuration format `shovel.json` which ties all of these services together, following the [12-factor app](https://12factor.net/) philosophy of separating config from code:

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

Same code, any backend. Your service worker calls `self.caches.open("pages")` or `self.databases.get("main")`, and it can be configured to work with SQLite or PostgreSQL, local disk or Redis. For example, here’s what a file upload handler might look like using some of the globals we mentioned:

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

### Simpler Static Assets

I wanted Shovel to be a meta-framework, transpiling and bundling both server and client code with ESBuild. I knew that figuring out how to reference, transform and serve client assets was a key part of the developer experience, but I didn’t yet know what it would look like.

It seemed like every major JavaScript build tool — Webpack, Parcel, Vite, Next.js — invented its own frustratingly complex loader system, or required brittle file-based routing to essentially inject asset references into the final bundle. What I wanted was simpler: pass a local filepath, get back a public URL.

Luckily, another standard, [import attributes](https://github.com/tc39/proposal-import-attributes) allowed us to turn local references into public URLs, with the same import syntax you use to read modules:

```ts
import favicon from "./favicon.ico" with {assetBase: "/", assetName: "favicon.ico"};
import styles from "./styles.css" with {assetBase: "/static/"};
import client from "./client.ts" with {assetBase: "/static/"};

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

No file-based routing, no special bundler plugins.

While I set out to build a meta-framework for my own UI framework (Crank.js), it turned out that using import attributes meant that Shovel could be a framework-agnostic server and compiler. Shovel passes imports to ESBuild for bundling, hashing, and code splitting, then serves them via middleware backed by `self.directories.open("public")`. Because assets resolve to plain URL strings, Shovel works with any client framework that doesn’t require complex bespoke compilation ([HTMX](https://htmx.org), [Lit](https://lit.dev), [Alpine.js](https://alpinejs.dev)), and it can even work with vanilla JavaScript.

### Truly Universal Rendering

JavaScript frameworks love using three-letter acronyms to describe rendering strategies. SSR (server-side rendering) is when the server creates HTML during the request/response lifecycle, SSG (static-site generation) is when this HTML generation is moved to a build step, SPA (single-page application) is when the HTML generation is moved to the client. Each of these modes describes when and where HTML gets rendered, and frameworks might have wildly different workflows for each mode.

With Shovel, most code is just written in the fetch handler, regardless of rendering mode. The difference between SSR and SSG is just timing.

For instance, I’m particularly fond of how static-site generation is implemented with Shovel. You can use the service worker’s `install` event to self-fetch HTML pages, using essentially the same pattern browser service workers use to pre-cache pages:

```ts
self.addEventListener("install", (ev) => {
  ev.waitUntil(generateStaticSite());
});

async function generateStaticSite() {
  const publicDir = await self.directories.open("public");

  for (const route of ["/", "/about", "/blog"]) {
    const response = await fetch(route); // hits your own router
    const html = await response.text();

    // /about -> about/index.html
    const path = route === "/" ? "index.html" : `${route.slice(1)}/index.html`;
    const file = await publicDir.getFileHandle(path, {create: true});
    const writable = await file.createWritable();
    await writable.write(html);
    await writable.close();
  }
}
```

The same route handlers that serve dynamic requests also generate your static pages. No separate SSG tooling, no build-time data fetching abstraction, just `fetch()`. And because you can write to the same directory where assets are written, client-side JavaScript and other static references just work.

## Early Adopters Welcome

Three months ago, I didn’t know if AI could help me build a server framework, or if the result would be good. Shovel turned out to be the framework I’ve always dreamed of. It’s obsessively standards-based, carefully designed, and definitely not a vibe-coded throwaway.

Shovel was built primarily with Claude Code, and in the development process I bore witness to numerous superhuman feats by it along the way: when the router was slow, Claude added radix trees; when native `URLPattern` was slow, Claude implemented a `RegExp`-based alternative passing 100% of web platform tests; when I wanted a DSL for `shovel.json`, Claude one-shot it after careful planning; when I got frustrated with DrizzleORM, we designed [ZenDB](https://github.com/bikeshaving/ZenDB) over the holidays. Open source software development is still hard work, but it’s new work, where I ideate and plan with Claude, watch it grant my wishes, and then verify the code wasn’t written in a dumb way.

Therefore, I’m happy to announce that Shovel.js is ready for early adopters. There are certainly bugs, and there will be breaking changes, but I’m using it for everything now. And if you’re building with AI, you should know that Shovel works great with LLMs because it targets one of their greatest strengths: high-fidelity knowledge of web standards. Shovel provides the predictable, standards-based foundation that lets agents do their best work, and if you encounter any inconsistent behavior that’s a bug.

The roadmap is ambitious: sessions, authentication, websockets, cron jobs, email; ultimately, I want Shovel to be maximally batteries included, complete with an admin interface like Django. If you know of any interesting web standards, or libraries that are so well-specified that they *should* be web standards, please let me know.

Thank you so much for reading this far. I hope I’ve convinced you to try Shovel, which you can do by running `npm create shovel`. You can also [read the docs](/guides/getting-started), or follow [development on GitHub](https://github.com/bikeshaving/shovel). Remember, if you know how to write a Service Worker, you already know how to write a Shovel app.
