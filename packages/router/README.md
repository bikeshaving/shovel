# @b9g/router

**Universal request router for ServiceWorker applications. Built on web standards with generator-based middleware.**

## Features

- **ServiceWorker Compatible**: Designed for ServiceWorker `fetch` event handling
- **Generator Middleware**: Uses `yield` for flow control (no Express-style `next()`)
- **Web Standards**: Built on URLPattern, Request, and Response APIs
- **Universal**: Same code runs in browsers, Node.js, Bun, and edge platforms
- **Simple Context**: Route parameters and middleware-extensible context

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

## Middleware

The router supports generator-based middleware with `yield` for clean flow control:

```javascript
// Global middleware using generator pattern
router.use(async function* (request, context) {
  console.log(`${request.method} ${request.url}`);
  const response = yield request;
  console.log(`${response.status}`);
  return response;
});

// Function middleware (can short-circuit)
router.use(async (request, context) => {
  if (!request.headers.get('Authorization')) {
    return new Response('Unauthorized', { status: 401 });
  }
  // Return null/undefined to continue to next middleware
  return null;
});
```

## Caching

The router doesn't provide built-in cache integration. For caching, use the global `caches` API directly in your handlers:

```javascript
router.get('/api/posts/:id', async (request, context) => {
  // Use global caches API
  const cache = await caches.open('api-v1');

  const cached = await cache.match(request);
  if (cached) return cached;

  const post = await db.posts.get(context.params.id);
  const response = Response.json(post);

  await cache.put(request, response.clone());
  return response;
});
```

Or implement caching as middleware:

```javascript
// Cache middleware
async function* cacheMiddleware(request, context) {
  if (request.method !== 'GET') {
    return yield request;
  }

  const cache = await caches.open('pages-v1');
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = yield request;

  if (response.ok) {
    await cache.put(request, response.clone());
  }

  return response;
}

router.use(cacheMiddleware);
```

## API Reference

### Router

#### Constructor

```javascript
new Router(options?)
```

Options: Currently no options needed (reserved for future use)

#### Methods

##### `route(pattern)`

Create a route builder for the given pattern.

```javascript
router.route('/api/posts/:id')
  .get(handler)
  .post(handler)
  .delete(handler);
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

##### `use(middleware)`

Add global middleware.

```javascript
router.use(loggingMiddleware);
```

##### `handler(request): Promise<Response>`

Bound handler function for processing requests.

```javascript
const response = await router.handler(request);
```

### Context Object

Handler and middleware functions receive a context object:

```javascript
{
  params: Record<string, string>,    // URL parameters
  // Middleware can add arbitrary properties
}
```

Middleware can extend context with custom properties:

```javascript
router.use(async function* (request, context) {
  context.user = await authenticate(request);
  return yield request;
});
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

### Authentication Middleware

```javascript
const router = new Router();

// Add user to context
router.use(async function* (request, context) {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (token) {
    context.user = await verifyToken(token);
  }
  return yield request;
});

// Protected route
router.get('/api/profile', async (request, context) => {
  if (!context.user) {
    return new Response('Unauthorized', { status: 401 });
  }
  return Response.json(context.user);
});
```

### Subrouter Mounting

```javascript
// API subrouter
const apiRouter = new Router();
apiRouter.get('/users', getUsersHandler);
apiRouter.get('/posts', getPostsHandler);

// Main router
const mainRouter = new Router();
mainRouter.mount('/api/v1', apiRouter);
// Routes become: /api/v1/users, /api/v1/posts
```

## License

MIT
