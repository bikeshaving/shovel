---
title: Introducing Shovel
description: The story behind Shovel.js
date: 2026-02-03
author: Brian Kim
---

Today, I’m happy to announce my first major AI-built open source project, which took approximately three months of development. No, it’s not an AI village tool where bots waste tokens. Rather, **Shovel.js** is a CLI and collection of libraries for developing and deploying Service Workers as web applications. It is both a full-stack server framework replacing tools like Express, Fastify or Hono, and a meta-framework / compiler replacing tools like Vite or Next.js.

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

While the plan of implementing standards was straightforward, there were still gaps which needed to be filled. The browser service worker doesn’t really include features like routing, middleware, local filesystems, database adapters or logging. This would require some careful design thinking from me, the human. The approach I decided to take was to extrapolate rather than invent: if browser service workers look like this, then what do server features look like? Here’s what we’ve come up with.

### Router and Middleware

One part missing from web standards is

<!--
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
-->

### Client-side assets and Filesystems

<!--
Static assets are compiled with content hashes and served via a bundled manifest. At build time, Shovel generates a virtual module `shovel:assets` containing the mapping from public URLs to hashed filenames. The assets middleware uses this manifest to serve files with aggressive caching:

```typescript
import manifest from "shovel:assets";
// { "/app.js": { hash: "a1b2c3", url: "/app.a1b2c3.js" } }
```

Files are read through `self.directories.open("public")`, the same FileSystem API you'd use in the browser. No special Node APIs required.
-->

### The ServiceWorker Globals Pattern

<!--
How do you run ServiceWorker code on Node.js or Bun, which have no ServiceWorker support? Shovel patches `globalThis` with the complete ServiceWorker API surface. After calling `scope.install()`, your code has access to `self.caches`, `self.clients`, `self.registration`, and all the event interfaces.

This means any ServiceWorker-compatible code runs unmodified. The same fetch handler works in Cloudflare Workers, Node.js, and the browser.
-->

### Static Site Generation as Build-time Server Side Rendering

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
