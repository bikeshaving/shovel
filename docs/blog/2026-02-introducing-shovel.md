---
title: Introducing Shovel
description: The story behind Shovel.js
date: 2026-02-03
author: Brian Kim
---

Today, I’m happy to announce my first major post-Claude Code open source project, which took approximately three months of development. No, it’s not an AI village tool where bots spend tokens. Rather, **Shovel.js** is a CLI and collection of libraries for developing and deploying Service Workers as web applications. It is both a full-stack server framework replacing tools like Express, Fastify or Hono, and a meta-framework / compiler replacing tools like Vite or Next.js.

The following is a contemporary description of what building a greenfield open source project with AI is like, and a tour of some of my favorite API features.

## The Journey

Work on Shovel began in earnest in October 2025, right about when the Remix team announced a reboot of their full stack runtime. Notably, they decided to divorce from React.js as their UI framework, opting to roll their own instead. As the author of [Crank.js](https://crank.js.org), I was disappointed that they didn’t choose to adopt Crank directly (one of the creators even [mentioned Crank as inspiration](https://twitter.com/ryanflorence/status/1977719354180485197)), but it would have been intensely hypocritical for me to begrudge any developer for choosing to roll their own anything.

Nevertheless, this signaled to me that I couldn’t wait for some other framework author to build a full-stack Crank meta-framework. I would have to do it myself. At the time, the Crank documentation website was running on a rudimentary static site generator I had hacked together with ESBuild, aspirationally named “Shovel.js” Could I expand this to a full-fledged server framework, and replace the cooked ?

## The Design Philosophy

The plan for the design of Shovel was simple: create a way to run Service Workers anywhere. For the longest time I’ve fascinated on this idea. In my free time, I would look through MDN the same way other people browse Wikipedia or Amazon, finding hidden gems like [FileSystem API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API), [the CookieStore API](https://developer.mozilla.org/en-US/docs/Web/API/CookieStore) and [the Cache API](https://developer.mozilla.org/en-US/docs/Web/API/Cache). These are real, rigorously specified abstractions which are shipped in all major browsers.

The question I had was why not Node/Bun/Cloudflare servers too? Most contemporary JavaScript libraries and runtimes are headed in this direction, by for instance, using the browser’s `Request` / `Response` classes rather than Node’s non-standard `IncomingMessage` / `OutgoingMessage`. But I wanted to take things a step further. What if, rather than designing new APIs, we could just provide shims and implementations of all the applicable browser standards found in MDN?

I started by asking Claude Code to implement the Service Worker’s `Cache` and `CacheStorage` classes. It did so quickly. As it turns out, this type of work is right in Claude’s wheelhouse. I discovered you could just direct Claude to a web specification, and it would write a reasonable implementation, usually by one-shot.

As of today, we’ve implemented at least six different browser standards and brought them together as a constellation of NPM packages and command line interface. Together, these APIs create a cohesive user experience where you can write code that looks like browser service worker code but run it on Node, Bun or Cloudflare.

```typescript
self.addEventListener("fetch", (event) => {
  event.respondWith(new Response("Hello World"));
});
```

## Architectural Flourishes

While the plan of implementing standards was straightforward, there were still gaps which needed to be filled. The browser APIs don't really include features like routing, middleware, usage with databases or local filesystems,

### Router and Middleware

The router uses a radix tree for fast path matching, but the middleware system is where things get interesting.

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

<!--
How do you run ServiceWorker code on Node.js or Bun, which have no ServiceWorker support? Shovel patches `globalThis` with the complete ServiceWorker API surface. After calling `scope.install()`, your code has access to `self.caches`, `self.clients`, `self.registration`, and all the event interfaces.

This means any ServiceWorker-compatible code runs unmodified. The same fetch handler works in Cloudflare Workers, Node.js, and the browser.
-->

### Static Site Generation as self-fetches during install.

<!--
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
-->

## Shovel Ready
