---
title: Introducing Shovel
description: The story behind Shovel.js
date: 2025-01-31
author: Brian Kim
---

Today I’m happy to announce my first major post-Claude Code open source project, which took approximately three months of development. No, it’s not an AI village tool where bots spend tokens. Rather, **Shovel.js** is a library for developing and deploying Service Workers for web applications. It is both a full-stack server framework replacing tools like Express.js, Fastify or Hono, and a meta framework/compiler replacing tools like Vite or Next.js.

The following is a contemporary description of what building a greenfield open source project with AI is like, and a tour of some of the features and design decisions which I found particularly appealing.

## The Journey

Work on Shovel began in earnest in October of 2025, right about when the Remix team announced a remix of their full stack runtime. Delightfully, they decided to divorce from React.js as their UI framework, opting to roll their own instead. As the author of [Crank.js](https://crank.js.org), I was disappointed that they didn’t choose to adopt Crank directly (one of the creators even [mentioned Crank as inspiration](https://twitter.com/ryanflorence/status/1977719354180485197)), but it would be intensely hypocritical for me to begrudge any developer for choosing to roll their own anything.

Nevertheless, this signaled to me that I couldn’t wait for a meta-framework author to adopt Crank. I’d likely have to do it myself. At the time, the Crank documentation website was running on a rudimentary static site generator I had hacked together with ESBuild, aspirationally named “Shovel.js.” Could I expand this to a full-fledged server framework, with Crank.js support and static site generation in mind?

## The Design Philosophy

The plan for the design of Shovel was simple. Create a way to run Service Workers anywhere. For the longest time I’ve fascinated on this idea. In my free time, I would look through MDN the same way other people browse through Wikipedia, finding hidden gems like the [FileSystem API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API), [CookieStore API](https://developer.mozilla.org/en-US/docs/Web/API/CookieStore) and [the Cache API](https://developer.mozilla.org/en-US/docs/Web/API/Cache). These are real, rigorously specified APIs which are shipped in all major browsers, with potential use-cases for server development.

Why not? Most contemporary frameworks have settled on using the `fetch()` specification’s `Request` / `Response` classes rather than Node’s non-standard `IncomingMessage` / `OutgoingMessage` abstractions, but I wanted to take things a step further. What if, rather than designing new APIs, we could just provide shims and implementations of all the applicable browser standards?

I started by asking Claude Code to implement `Cache` and `CacheStorage`. Claude implemented it quickly. As it turns out, this type of work is right in Claude’s wheelhouse. I discovered you could just direct Claude to a specification, and it would write a reasonable implementation, usually by one-shot.

As of today, we’ve implemented at least six different browser standards and brought them together as a constellation of NPM packages and command line interface. Together, these APIs create a cohesive user experience where you can write code that looks like browser service worker code but run it on Node, Bun or Cloudflare.

```typescript
self.addEventListener("fetch", (event) => {
  event.respondWith(new Response("Hello World"));
});
```

## Architectural Flourishes

While the plan of implementing standards was straightforward, there were gaps to fill. The browser APIs don't include routing or middleware, and the ServiceWorker lifecycle events needed creative repurposing for static site generation. Here are some of the design choices I'm most pleased with.

### Router and Middleware

The router uses a radix tree for fast path matching, but the middleware system is where things get interesting. Inspired by Ruby's Rack and Koa.js, Shovel middleware can be written as generator functions:

```typescript
async function* loggingMiddleware(request: Request) {
  const start = Date.now();
  const response = yield;
  console.log(`${request.method} ${request.url} - ${Date.now() - start}ms`);
  return response;
}
```

The `yield` statement marks where control passes to the next middleware. When the handler returns, execution resumes after the yield with the response. This pattern makes before/after logic trivial to write and reason about.

### Client-side Assets

Static assets are compiled with content hashes and served via a bundled manifest. At build time, Shovel generates a virtual module `shovel:assets` containing the mapping from public URLs to hashed filenames. The assets middleware uses this manifest to serve files with aggressive caching:

```typescript
import manifest from "shovel:assets";
// { "/app.js": { hash: "a1b2c3", url: "/app.a1b2c3.js" } }
```

Files are read through `self.directories.open("public")`, the same FileSystem API you'd use in the browser. No special Node APIs required.

### The ServiceWorker Globals Pattern

How do you run ServiceWorker code on Node.js or Bun, which have no ServiceWorker support? Shovel patches `globalThis` with the complete ServiceWorker API surface. After calling `scope.install()`, your code has access to `self.caches`, `self.clients`, `self.registration`, and all the event interfaces.

This means any ServiceWorker-compatible code runs unmodified. The same fetch handler works in Cloudflare Workers, Node.js, and the browser.

### ServiceWorker Lifecycles for SSG

The real trick was repurposing ServiceWorker lifecycle events for static site generation. In the browser, `install` fires when a ServiceWorker is first registered, and `activate` fires when it takes control. Shovel dispatches these same events during the build process:

```typescript
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open("pages").then((cache) =>
      cache.addAll(["/", "/about", "/blog"])
    )
  );
});
```

During SSG, this code pre-renders pages into the cache. The output is written to disk as static HTML. The same code that warms a browser cache can generate a static site.

## Shovel Ready
