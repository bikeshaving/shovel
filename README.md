# Shovel: The web framework built on the web platform

🚧 UNDER CONSTRUCTION DO NOT INVESTIGATE 🚧

> server - noun. a thing which populates caches with responses based on requests

Shovel is a cache-first web framework built entirely on web platform APIs (`fetch`/`Request`/`Response`) and Service Worker APIs (`Cache`/`CacheStorage`). Shovel treats caching as a first-class routing concern, not an optimization. It runs universally across browsers, Node, Bun, Deno, and edge platforms using the same code.

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

### Configurations for Any Stack
Cache backends can be used to support:
- SSG (Static-site generation)
- ISR (Incremental static regeneration)
- SSR (Server-side rendering)
- CSR (Client-side rendering)
- SPA (Single page applications)
- MPA (Multi page applications)

### How `cache.add()`/`cache.addAll()` Unify Everything

`cache.add(request)` does three things:
1. Fetches the request through your router
2. Your handler runs and produces a response
3. Stores the response in the cache

This same operation is:
- **SSG** when called at build time
- **ISR** when called after TTL expiry
- **SSR** when called on first request

Same handlers, same API. Only **when** you call it differs.

### Universal Routing
- URLPattern-based route syntax
- Handlers declare caches for responses
- Middlewares declare caching behaviors across routes

## Modules
### 1. `@b9g/match-pattern`

Extended `MatchPattern` for better routing:
- Subclass of `URLPattern`
- Rich, standards based :param syntax
- Full URL string pattern API
- Saner search parameter matching (order-independent)

**Status:** ✅ Implemented

### 2. `@b9g/router`

Universal request router built on web standards:
- Bound handler function API: `router.handler(request)` 
- RouteBuilder pattern: `router.route(pattern).use(middleware).get(handler)`
- Global and route-specific middleware support
- Cache-aware routing with automatic cache population
- HTTP method conveniences (get, post, put, delete, etc.)

**API:**

```javascript
const router = new Router({ caches });

// Global middleware
router.use(async (request, context, next) => {
  // context.caches  - CacheStorage API
  // context.cache   - Opened Cache instance for this route
  // context.params  - URL parameters
  // next()          - Next middleware/handler in chain
  const response = await next();
  return response;
});

// Route-specific middleware and handlers
router.route({
  pattern: '/api/posts/:id',
  cache: { name: 'posts' }
})
.use(authMiddleware)
.use(rateLimitMiddleware)
.get(async (request, context) => {
  // Terminal handler - no next() function
  const post = await db.posts.get(context.params.id);
  return new Response(JSON.stringify(post));
});

// Pattern-based middleware (applies to all methods on pattern)
router.use('/admin/*', adminAuthMiddleware);

// HTTP method shortcuts
router.get('/posts', listPostsHandler);
router.post('/posts', createPostHandler);

// Bound handler for integration
await router.handler(request); // Returns Response
```

**Status:** ✅ Implemented

### 3. `@b9g/import-with-type-url`

ESBuild/Bun plugin for asset pipeline:
- Import files and get URLs with type information
- Enables proper asset handling in universal code
- Works with the router for serving static assets

**Status:** ✅ Implemented

### 4. `@b9g/platform`

Universal platform abstraction for ServiceWorker-style applications:
- Platform-agnostic ServiceWorker entrypoint loading
- Worker thread architecture with configurable concurrency
- Multiple platform targets: Node.js, Bun, Cloudflare Workers
- Automatic platform detection for development
- ESBuild integration with static file handling
- Cache coordination across worker threads

**Platform Implementations:**
- `@b9g/platform-node` - Node.js with Worker threads and coordinated caching
- `@b9g/platform-bun` - Bun runtime with native ESBuild integration  
- `@b9g/platform-cloudflare` - Cloudflare Workers with Wrangler

**ServiceWorker Pattern:**
```javascript
// Your app as a ServiceWorker-style entrypoint
import { Router } from '@b9g/router';

const router = new Router();
router.get('/', () => new Response('Hello World'));

// Platform loads this as a ServiceWorker
addEventListener('install', event => {
  console.log('App installing...');
});

addEventListener('activate', event => {
  console.log('App activated!');
});

addEventListener('fetch', event => {
  event.respondWith(router.handler(event.request));
});
```

**Status:** ✅ Implemented

### 5. `@b9g/cache`

Universal Cache API implementation:
- Provides CacheStorage/Cache APIs everywhere
- Cache is an abstract interface with multiple implementations for different backends
- CacheStorage is a registry for named caches
- Request/Response-oriented caching with HTTP semantics
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
- `FileSystemCache` - FileSystem-backed (for SSG, Node servers)
- `InMemoryCache` - In-memory (for dev, testing)
- `CloudflareKVCache` - Cloudflare KV storage
- Native browser CacheStorage (when available)

**Usage:**
```javascript
import { CacheStorage, FilesystemCache, MemoryCache } from '@b9g/cache';

const caches = new CacheStorage();

// Register different implementations for different cache names
caches.register('posts', () =>
  new FilesystemCache('posts', { directory: './dist/posts' })
);

caches.register('api', () => new MemoryCache('api'));

// Router uses the cache storage
const router = new Router({caches});

// When handler declares a cache name:
// Router opens the specified cache and places it under `context.cache`.
// Other caches are accessible under `context.caches`
```

**Status:** ✅ Implemented

### 6. `shovel` CLI

Universal command-line tool with platform auto-detection:
- `shovel develop` - Development server with hot reloading
- `shovel build` - Production bundling and optimization  
- `shovel static` - Static site generation via cache population
- `shovel info` - Platform and runtime information
- Platform targeting: `--platform=node|bun|cloudflare`
- Worker count configuration: `--workers=N`
- Auto-detects runtime (Node.js, Bun) for optimal defaults

**Development Server:**
```bash
# Auto-detect platform
shovel develop src/app.js

# Explicit platform targeting  
shovel develop src/app.js --platform=bun --port=3000

# Custom worker count (default: 2 in dev, CPU count in prod)
shovel develop src/app.js --workers=4

# Verbose output for debugging
shovel develop src/app.js --verbose
```

The CLI uses the platform abstraction to provide consistent development experience across all runtimes. Worker configuration encourages concurrency thinking from the start while maximizing production throughput.

**SSG Example:**
```javascript
// TODO: Determine what the ideal SSG script looks like
```
1. Loads your router
2. Creates CacheStorage with FilesystemCache
3. Calls cache.addAll(paths)
4. cache.add() fetches through the router
5. Router handlers run and produce responses
6. cache.put() stores responses to filesystem
Result: Filesystem cache pre-populated with rendered pages

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
router.route({
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
2. Router matches pattern, and opens named cache (context.cache)
3. Middleware checks context.cache.match(request, context.cacheOptions)
4. Cache hit? Return cached response (fast path)
5. Cache miss? Call context.next() â†’ Handler runs
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
- Runtime: Service worker, serve from cache, populate on miss

### Universal Example

```javascript
import {Router} from '@b9g/router';

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
router.route({
  pattern: '/api/posts/:id',
  methods: 'GET',
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
router.route({
  pattern: '/api/posts/:id',
  methods: 'PUT',
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
3. **Web standards only** - URLPattern, Request, Response, Fetch, Cache API
4. **Universal by default** - Same code runs everywhere, with runtime/platform specific fallbacks for maximum compatibility.

## Recent Developments

### Implemented Features
- **Router API**: Complete rewrite with bound handler functions and fluent RouteBuilder pattern
- **Platform Abstraction**: Universal ServiceWorker-style application loading across Node.js, Bun, and Cloudflare
- **Hot Reloading**: VM module isolation for clean reloads in Node.js platform  
- **CLI Tool**: Auto-detecting development server with platform targeting
- **Cache Integration**: Full Cache/CacheStorage API implementation with multiple backends
- **Static Files**: ESBuild plugin for asset handling with URL imports

### Architecture Decisions
- **ServiceWorker Pattern**: Applications written as ServiceWorker entrypoints work universally
- **Bound Handler API**: `router.handler(request)` replaces factory pattern for cleaner integration
- **Route-Specific Middleware**: `router.route().use().get()` for composable request handling
- **Worker Thread Architecture**: Multi-worker concurrency with coordinated cache storage
- **Platform Detection**: Automatic runtime detection with explicit override capabilities

### Worker Architecture
- **Development**: 2 workers by default to encourage concurrency thinking
- **Production**: CPU count workers for maximum throughput
- **Configurable**: `--workers` CLI flag for custom worker counts
- **Coordinated Caching**: PostMessage-based cache coordination across workers
- **Standard APIs**: Uses Web Worker APIs for cross-platform compatibility

## Project Status

Core components are **implemented and functional**. The framework successfully runs universal applications across multiple platforms with a consistent API.

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
router.route({
  pattern: '/post/:id',
  methods: 'GET',
  cache: { name: 'posts' }
}, async (req, ctx) => {
  // Just produce the response with cache headers
  const post = await db.get(ctx.params.id);
  return new Response(JSON.stringify(post), {
    headers: { 'Cache-Control': 'max-age=300' }
  });
});

// Write handler invalidates related caches
router.route({
  pattern: '/post/:id',
  methods: 'PUT',
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
