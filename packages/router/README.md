# @b9g/router

**Universal request router built on web standards with generator-based middleware.**

## Features

- **Web Standards**: Built on URLPattern-like syntax, Request, and Response APIs
- **Generator Middleware**: Uses `yield` for flow control (no Express-style `next()`)
- **Universal**: Same code runs in browsers, Node.js, Bun, and edge platforms
- **Simple Context**: Route parameters and middleware-extensible context
- **Router Composition**: Mount subrouters with path prefixes

## Installation

```bash
npm install @b9g/router
```

## Quick Start

```javascript
import {Router} from '@b9g/router';

const router = new Router();

// Simple route
router.route('/hello').get(() => new Response('Hello World!'));

// Route with parameters
router.route('/posts/:id').get((request, context) => {
  const {id} = context.params;
  return Response.json({id, title: `Post ${id}`});
});

// Handle request
const response = await router.handle(request);
```

## Middleware

The router supports function and generator-based middleware with `yield` for clean flow control:
```javascript
// Function middleware
router.use(async (request, context) => {
  if (!request.headers.get('Authorization')) {
    return new Response('Unauthorized', { status: 401 });
  }
  // Return null/undefined to continue to next middleware
  return null;
});

// Generator middleware
router.use(async function* (request, context) {
  console.log(`${request.method} ${request.url}`);
  const response = yield request;
  console.log(`${response.status}`);
  return response;
});
```

## API Reference

### Router

#### Constructor

```javascript
new Router()
```

#### Methods

##### `route(pattern)`

Create a route builder for the given pattern.

```javascript
router.route('/api/posts/:id')
  .get(handler)
  .post(handler)
  .delete(handler);
```


##### `use(middleware)`

Add global middleware.

```javascript
router.use(loggingMiddleware);
```

##### `handle(request): Promise<Response>`

Handle an incoming request and return a response.

```javascript
const response = await router.handle(request);
```

##### `mount(path, subrouter)`

Mount a subrouter at a specific path prefix.

```javascript
const apiRouter = new Router();
apiRouter.route('/users').get(handler);

const mainRouter = new Router();
mainRouter.mount('/api/v1', apiRouter);
// Routes become: /api/v1/users
```

##### `match(url): RouteMatch | null`

Match a URL against registered routes without executing handlers.

```javascript
const match = router.match(new URL('https://example.com/api/users'));
if (match) {
  console.log(match.params, match.methods);
}
```

#### Properties

##### `routes: RouteEntry[]`

Read-only array of registered routes for introspection.

```javascript
router.routes.forEach(route => {
  console.log(route.pattern, route.method);
});
```

##### `middlewares: MiddlewareEntry[]`

Read-only array of registered middleware for introspection.

```javascript
router.middlewares.forEach(mw => {
  console.log(mw.pathPrefix);
});
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

router.route('/api/health').get(() =>
  Response.json({status: 'ok'})
);

router.route('/api/posts')
  .get(async () => {
    const posts = await db.posts.findAll();
    return Response.json(posts);
  })
  .post(async (request) => {
    const data = await request.json();
    const post = await db.posts.create(data);
    return Response.json(post, {status: 201});
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
router.route('/api/profile').get(async (request, context) => {
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
apiRouter.route('/users').get(getUsersHandler);
apiRouter.route('/posts').get(getPostsHandler);

// Main router
const mainRouter = new Router();
mainRouter.mount('/api/v1', apiRouter);
// Routes become: /api/v1/users, /api/v1/posts
```

## Exports

### Classes

- `Router` - Main router class
- `RouteBuilder` - Fluent API for defining routes (returned by `router.route()`)

### Types

```typescript
// Handler and middleware types
type Handler = (request: Request, context: RouteContext) => Response | Promise<Response>
type FunctionMiddleware = (request: Request, context: RouteContext) => Response | null | undefined | Promise<Response | null | undefined>
type GeneratorMiddleware = (request: Request, context: RouteContext) => Generator<Request, Response | null | undefined, Response> | AsyncGenerator<Request, Response | null | undefined, Response>
type Middleware = GeneratorMiddleware | FunctionMiddleware

// Context and route types
interface RouteContext {
  params: Record<string, string>
}

interface RouteOptions {
  name?: string
}

interface RouteMatch {
  params: Record<string, string>
  methods: string[]
}

interface RouteEntry {
  pattern: MatchPattern
  method: string
  handler: Handler
  name?: string
  middleware: Middleware[]
}

interface MiddlewareEntry {
  middleware: Middleware
  pathPrefix?: string
}

// HTTP methods
type HTTPMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS"

// Utility types
type TrailingSlashMode = "strip" | "add"
```

## Middleware Utilities

Standard middleware is available from `@b9g/router/middleware`:

```typescript
import {cors, trailingSlash} from '@b9g/router/middleware';

// CORS middleware
router.use(cors({
  origin: "https://example.com",
  credentials: true
}));

// Trailing slash normalization
router.use(trailingSlash("strip")); // /path/ → /path
```

### Available Middleware

#### `cors(options?: CORSOptions)`

Handles Cross-Origin Resource Sharing headers and preflight requests.

```typescript
interface CORSOptions {
  origin?: string | string[] | ((origin: string) => boolean);  // Default: "*"
  methods?: string[];  // Default: ["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH"]
  allowedHeaders?: string[];  // Default: ["Content-Type", "Authorization"]
  exposedHeaders?: string[];
  credentials?: boolean;  // Default: false
  maxAge?: number;  // Default: 86400 (24 hours)
}
```

#### `trailingSlash(mode: TrailingSlashMode)`

Normalizes URL trailing slashes via 301 redirect.

```typescript
type TrailingSlashMode = "strip" | "add";
```

## License

MIT
