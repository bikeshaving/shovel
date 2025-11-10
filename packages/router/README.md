# @b9g/router

Universal request router built on web standards with cache-aware routing and middleware support.

## Features

- **Web Standards Based**: Built on URLPattern, Request, Response, and Cache APIs
- **Cache-Aware Routing**: First-class cache integration with automatic population
- **Middleware Support**: Global and route-specific middleware with generator `yield` pattern
- **Method Routing**: HTTP method shortcuts (get, post, put, delete, etc.)
- **Universal**: Same code runs in browsers, Node.js, Bun, and edge platforms

## Installation

```bash
npm install @b9g/router @b9g/match-pattern
```

## Quick Start

```javascript
import { Router } from '@b9g/router';

const router = new Router();

// Simple route
router.get('/hello', () => new Response('Hello World!'));

// Route with parameters
router.get('/posts/:id', (request, context) => {
  const { id } = context.params;
  return Response.json({ id, title: `Post ${id}` });
});

// Handle request
const response = await router.handler(request);
```

## Cache-Aware Routing

```javascript
import { Router } from '@b9g/router';
import { CacheStorage, MemoryCache } from '@b9g/cache';

// Setup cache storage
const caches = new CacheStorage();
caches.register('posts', () => new MemoryCache('posts'));

const router = new Router({ caches });

// Route with cache declaration
router.route({
  pattern: '/api/posts/:id',
  cache: { name: 'posts' }
}).get(async (request, context) => {
  // context.cache is the opened 'posts' cache
  const post = await db.posts.get(context.params.id);
  return Response.json(post);
});
```

## Middleware

```javascript
// Global middleware using generator pattern
router.use(async function* (request, context) {
  console.log(`${request.method} ${request.url}`);
  const response = yield request;
  return response;
});

// Route-specific middleware
router.route('/admin/*')
  .use(authMiddleware)
  .use(rateLimitMiddleware)
  .get(adminHandler);

// Pattern-based middleware
router.use('/api/*', corsMiddleware);
```

## API Reference

### Router

#### Constructor

```javascript
new Router(options?)
```

Options:
- `caches`: CacheStorage instance for cache-aware routing

#### Methods

##### `route(pattern, options?)`

Create a route builder for the given pattern.

```javascript
router.route('/api/posts/:id', { cache: { name: 'posts' } })
  .use(middleware)
  .get(handler);
```

##### HTTP Method Shortcuts

```javascript
router.get(pattern, handler)
router.post(pattern, handler)
router.put(pattern, handler)
router.delete(pattern, handler)
router.patch(pattern, handler)
router.head(pattern, handler)
router.options(pattern, handler)
```

##### `use(pattern?, middleware)`

Add middleware globally or for specific patterns.

##### `handler(request): Promise<Response>`

Bound handler function for processing requests.

### Context Object

Handler and middleware functions receive a context object:

```javascript
{
  params: Record<string, string>,    // URL parameters
  cache?: Cache,                     // Opened cache for this route
  caches?: CacheStorage,            // All available caches
  // ... additional context
}
```

## Examples

### Basic API Router

```javascript
const router = new Router();

router.get('/api/health', () => 
  Response.json({ status: 'ok' })
);

router.get('/api/posts', async () => {
  const posts = await db.posts.findAll();
  return Response.json(posts);
});

router.post('/api/posts', async (request) => {
  const data = await request.json();
  const post = await db.posts.create(data);
  return Response.json(post, { status: 201 });
});
```

### With Caching

```javascript
import { Router } from '@b9g/router';
import { CacheStorage, MemoryCache } from '@b9g/cache';

const caches = new CacheStorage();
caches.register('api', () => new MemoryCache('api'));

const router = new Router({ caches });

// Cache-aware middleware
router.use(async function* (request, context) {
  if (request.method === 'GET' && context.cache) {
    const cached = await context.cache.match(request);
    if (cached) return cached;
  }
  
  const response = yield request;
  
  if (request.method === 'GET' && context.cache && response.ok) {
    await context.cache.put(request, response.clone());
  }
  
  return response;
});

router.route('/api/posts/:id', { cache: { name: 'api' } })
  .get(async (request, context) => {
    const post = await db.posts.get(context.params.id);
    return Response.json(post);
  });
```

## License

MIT