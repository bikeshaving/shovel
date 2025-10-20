# Shovel: A Cache-First Universal, AnyStack, (Meta)-Framework

> server - noun. a thing which populates caches with responses based on requests

Shovel is a built on web standards (Cache API, Fetch API,
URLPattern) that treats caching as the key architectural decision for routes, not an
optimization. It works universally across browsers, Node, Bun, Deno, and edge
runtimes.

## Philosophy

### Cache-First Architecture
Shovel implements the Cache and CacheStorage APIs from service workers.
```js
// Fill this in with the Cache backend API
// Add handler which reads `ctx.cache`
```

Different backends/runtimes can use different storage mechanisms.

```js
// Fill this in with the CacheStorage constructor
```

### Any Stack
- Cache backends can be used to support
  - SSG (Static-site generation)
  - SSR (Server-side rendering)
  - ISR (Incremental static regeneration)
  - CSR (Client-side rendering)
  - SPA (Single page applications)
  - MPA (Multi page applications)

### Universal Routing
- URLPattern-based route syntax
- Handlers declare caches for responses
- Middlewares declare caching behaviors across routes

## Modules
### 1. `@b9g/match-pattern`

Extended URLPattern for better routing:
- Subclass of `URLPattern` with enhanced string parameter parsing
- Saner search parameter matching (non-exhaustive, order-independent)
- Provides the pattern matching primitive for the router

**Status:** Design phase

### 2. `@b9g/router`

Universal request router built on web standards:
- Two primitives: `router.use()` (middleware) and `router.app()` (handlers)
- Async-capable middleware chain
- Works in any JavaScript runtime
- Cache-aware routing with automatic cache population

**API:**

```javascript
// Middleware: flow control with cache access
router.use(options, async (request, context) => {
  // context.caches  - CacheStorage API
  // context.cache   - Opened Cache instance for this route
  // context.params  - URL parameters
  // context.next()  - Next middleware/handler in chain
  return response;
});

// Handler: terminal response producer with cache access
router.app(options, async (request, context) => {
  // context.caches  - CacheStorage API
  // context.cache   - Opened Cache instance for this route
  // context.params  - URL parameters
  // NO context.next - handlers are terminal
  return response;
});

// Options
{
  pattern: URLPattern | string,
  verbs: string[] | string,
  cache: {
    name: 'my-cache',      // Named cache (router opens this)
    ignoreSearch: true,    // Cache API match options
    ignoreMethod: false,
    ignoreVary: false
  }
}
```

**Status:** Design phase

### 3. `@b9g/import-with-type-url`

ESBuild/Bun plugin for asset pipeline:
- Import files and get URLs with type information
- Enables proper asset handling in universal code
- Works with the router for serving static assets

**Status:** Design phase

### 4. `@b9g/cache-storage`

Universal Cache API implementation:
- Provides CacheStorage/Cache APIs everywhere via shim (Node, Bun, Deno)
- Cache is an abstract interface with multiple implementations
- CacheStorage is a registry for named caches
- Request/Response-aware caching with HTTP semantics
- Same API works in browser, service worker, and server

**Architecture:**
```javascript
// Cache - abstract interface
interface Cache {
  match(request: Request, options?: CacheQueryOptions): Promise<Response | undefined>;
  matchAll(request?: Request, options?: CacheQueryOptions): Promise<Response[]>;
  put(request: Request, response: Response): Promise<void>;
  add(request: Request): Promise<void>;
  addAll(requests: Request[]): Promise<void>;
  delete(request: Request, options?: CacheQueryOptions): Promise<boolean>;
  keys(request?: Request, options?: CacheQueryOptions): Promise<Request[]>;
}

// CacheStorage - registry of named caches
class CacheStorage {
  register(name: string, factory: () => Cache): void;
  open(name: string): Promise<Cache>;
  has(name: string): Promise<boolean>;
  delete(name: string): Promise<boolean>;
  keys(): Promise<string[]>;
}
```

**Cache Implementations:**
- `FilesystemCache` - Filesystem-backed (for SSG, Node servers)
- `MemoryCache` - In-memory (for dev, testing)
- `CloudflareKVCache` - Cloudflare KV storage
- `DenoKVCache` - Deno KV storage
- Native browser CacheStorage (when available)

**Usage:**
```javascript
import { CacheStorage, FilesystemCache, MemoryCache } from '@b9g/cache-storage';

const cacheStorage = new CacheStorage();

// Register different implementations for different cache names
cacheStorage.register('posts', () =>
  new FilesystemCache('posts', { directory: './dist/.cache' })
);

cacheStorage.register('api', () =>
  new MemoryCache('api')
);

// Router uses the cache storage
const router = new Router({ cacheStorage });

// When handler declares cache: { name: 'posts' }
// Router calls: context.cache = await cacheStorage.open('posts')
// Gets the registered FilesystemCache instance
```

**Status:** Design phase

### 5. `shovel` CLI

Command-line tool for development and deployment:
- `shovel dev` - Development server with HMR
- `shovel build` - Production bundling and optimization
- `shovel static` - SSG: populate caches from static paths
- `shovel deploy` - Deploy to various platforms

**SSG Example:**
```javascript
// generate-paths.js
export default async function() {
  return [
    '/',
    '/about',
    '/blog/hello-world',
    '/blog/another-post'
  ];
}
```

```bash
shovel static --paths-from ./generate-paths.js
# What happens:
# 1. Loads your router
# 2. Creates CacheStorage with FilesystemCache
# 3. Calls cache.addAll(paths)
# 4. cache.add() fetches through the router
# 5. Router handlers run and produce responses
# 6. cache.put() stores responses to filesystem
# Result: Filesystem cache pre-populated with rendered pages
```

**How it works:**
```javascript
// FilesystemCache.add() makes real requests through your router
class FilesystemCache {
  async add(request) {
    // Fetch through the router!
    const response = await this.fetch(request);
    // Store the response
    await this.put(request, response);
  }
}

// Your router IS the SSG renderer
router.app({
  pattern: '/blog/:slug',
  cache: { name: 'posts' }
}, async (request, context) => {
  const post = await db.posts.get(context.params.slug);
  return new Response(renderHTML(post), {
    headers: { 'Content-Type': 'text/html' }
  });
});

// At build time: cache.add('/blog/hello-world')
// → Fetches through router → Handler runs → Returns HTML → Stored to filesystem
// At runtime: Request arrives → cache.match() → Returns pre-rendered HTML
```

**Status:** Design phase

## Architecture

### The Cache-First Request Flow

```
1. Request arrives
2. Router matches pattern â†’ opens named cache (context.cache)
3. Middleware checks context.cache.match(request, context.cacheOptions)
4. Cache hit? â†’ Return cached response (fast path)
5. Cache miss? â†’ Call context.next() â†’ Handler runs
6. Handler returns response (may invalidate related caches for mutations)
7. Middleware stores in context.cache.put(request, response)
8. Return response
```

**Key points:**
- Middleware orchestrates caching (check, populate, respect cache headers)
- Read handlers produce responses with cache metadata (Cache-Control, ETag)
- Write handlers invalidate caches after mutations
- Both middleware and handlers can access `context.cache` and `context.caches`
- The distinction: middleware has `context.next()`, handlers are terminal

### Deployment Modes

All modes use the same code - only the cache backend changes:

**SSG (Static Site Generation):**
- Cache backend: Filesystem
- Build time: Populate all caches from static paths
- Runtime: Serve from filesystem cache (or service worker)

**SSR (Server-Side Rendering):**
- Cache backend: Memory or KV store
- Runtime: Populate cache on first request

**ISR (Incremental Static Regeneration):**
- Cache backend: Memory or KV store
- Runtime: Populate cache, respect TTL, repopulate on expiry

**CSR (Client-Side Rendering):**
- Cache backend: Browser CacheStorage
- Service worker: Serve from cache, populate on miss

### Universal Example

```javascript
import { Router } from '@b9g/router';

const router = new Router();

// Cache-aware middleware (cross-cutting concern)
router.use({}, async (request, context) => {
  // Only cache GET requests
  if (request.method !== 'GET') {
    return context.next();
  }

  // Check cache first
  if (context.cache) {
    const cached = await context.cache.match(request, context.cacheOptions);
    if (cached && isFresh(cached)) {
      return cached;
    }
  }

  // Cache miss - resolve it
  const response = await context.next();

  // Populate cache for successful responses
  if (context.cache && response.ok && shouldCache(response)) {
    await context.cache.put(request, response.clone());
  }

  return response;
});

// Read handler - produces response, middleware handles caching
router.app({
  pattern: '/api/posts/:id',
  verbs: 'GET',
  cache: { name: 'posts' }
}, async (request, context) => {
  const post = await db.posts.get(context.params.id);
  return new Response(JSON.stringify(post), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'max-age=3600'
    }
  });
});

// Write handler - invalidates cache after mutation
router.app({
  pattern: '/api/posts/:id',
  verbs: 'PUT',
  cache: { name: 'posts' }
}, async (request, context) => {
  const data = await request.json();
  const post = await db.posts.update(context.params.id, data);

  // Invalidate this post and list view
  await context.cache.delete(new Request(`/api/posts/${context.params.id}`));
  await context.cache.delete(new Request('/api/posts'));

  return Response.json(post);
});

export default router;
```

This same code works:
- In Node with filesystem cache (SSG)
- In browser with CacheStorage (SPA)
- In Cloudflare Workers with KV cache (Edge)
- In service workers (Offline-first PWA)

## Design Constraints

1. **Middleware chains, handlers terminate** - Middleware has `context.next()` for flow control, handlers are terminal response producers
2. **Both can access caches** - Middleware for cross-cutting cache logic, handlers for route-specific invalidation
3. **Cache API is the abstraction** - All storage goes through CacheStorage/Cache
4. **Web standards only** - URLPattern, Request, Response, Fetch, Cache API
5. **Universal by default** - Same code runs everywhere, with runtime/platform specific fallbacks for maximum compatibility.

## Project Status

All components are currently in the **design phase**. This README captures the architectural decisions and API design for the metaframework.

## Philosophy in Practice

Traditional framework:
```javascript
// Handler does everything
app.get('/post/:id', async (req, res) => {
  const cached = await redis.get(req.params.id);
  if (cached) return res.json(cached);

  const post = await db.get(req.params.id);
  await redis.set(req.params.id, post);
  res.json(post);
});
```

Shovel (cache-first):
```javascript
// Read handler focuses on business logic
router.app({
  pattern: '/post/:id',
  verbs: 'GET',
  cache: { name: 'posts' }
}, async (req, ctx) => {
  // Just produce the response with cache headers
  const post = await db.get(ctx.params.id);
  return new Response(JSON.stringify(post), {
    headers: { 'Cache-Control': 'max-age=300' }
  });
});

// Write handler invalidates related caches
router.app({
  pattern: '/post/:id',
  verbs: 'PUT',
  cache: { name: 'posts' }
}, async (req, ctx) => {
  const post = await db.update(ctx.params.id, await req.json());

  // Invalidate this post
  await ctx.cache.delete(new Request(`/post/${ctx.params.id}`));

  return Response.json(post);
});

// Middleware handles caching (once, for all routes)
router.use({}, cacheMiddleware);
```

The cache isn't a side effect - it's the primary data flow. Read handlers produce responses with cache metadata. Write handlers invalidate when data changes. Middleware orchestrates the caching strategy.

---

**Status:** Design phase | **License:** TBD | **Author:** TBD
