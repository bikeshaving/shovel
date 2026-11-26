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
new Router({maxPathLength: 4096})
```

`maxPathLength` is the longest pathname the router will match, in characters, and defaults to 2048. A longer request gets `414 URI Too Long` before any route or middleware runs, and `match()` returns `null`. The query string doesn't count. It must be a positive number; `Infinity` disables the limit.

The limit caps how long matching can take, but it doesn't make every pattern safe. A pattern with three or more params or wildcards that can split a URL several ways, such as `/:a-:b-:c` or `/*/*/*/end`, makes the regular expression engine try each split before it fails, and the time grows quickly with the path's length: at the default limit a crafted path can still take seconds to reject. Keep patterns to at most two such pieces, or lower `maxPathLength` if you need more.

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

### `redirect(from, to, options?)`

Create a redirect. `from` is a pattern like `/old/:id`, with `:id` reusable in `to`, or a `RegExp` with `$1` and so on in `to`. The default status is 301.

```javascript
import {redirect} from '@b9g/router';

// Registered: runs at its place in the middleware chain
router.use(redirect('/old/:id', '/new/:id'));

// Called inside middleware: returns the redirect Response, or null
router.use(async function* (request) {
  const response = redirect(/^\/beta\/(.*)$/, '/$1')(request);
  if (response) return response;
  return yield request;
});
```

A registered redirect runs where it was declared. Middleware declared before it wraps the redirect response, and middleware declared after it does not run when it redirects. It wins over routes declared after it and does not redirect a route declared before it. So watch the declaration order: to make a redirect win over every route, declare it before them.

```javascript
router.use(cors());                 // adds CORS headers to the redirect
router.redirect('/old', '/new');
router.use(auth);                   // skipped when /old redirects
```

Pass `{fallback: true}` for a redirect that only applies when the request would otherwise be a 404, wherever it is declared. It lets the rest of the chain run first, middleware and route alike, and redirects if the result is a 404. `trailingSlash()` is a fallback redirect.

```javascript
// /docs/intro is served by its route; every other /docs/* page redirects
router.redirect('/docs/:page', '/guides/:page', {fallback: true});
router.route('/docs/intro').get(handler);
```

The router does not send a request around a loop of its own redirects. Before it redirects, it follows its redirects from the target, and if they lead back to a URL already visited, as with `/a` to `/b` and `/b` to `/a`, it logs an error and carries on as if the redirect were not there, which usually means a 404. It only sees redirects declared this way: one returned by a handler, by other middleware or by another server is not followed.

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

interface RouterOptions {
  maxPathLength?: number
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
import {cors, logger, trailingSlash} from '@b9g/router/middleware';

// Request logging
router.use(logger());

// CORS middleware
router.use(cors({
  origin: "https://example.com",
  credentials: true
}));

// Trailing slash normalization
router.use(trailingSlash("strip")); // /path/ → /path
```

### Available Middleware

#### `logger(options?: LoggerOptions)`

Logs incoming requests and outgoing responses with timing information via [LogTape](https://github.com/dahlia/logtape).

```
→ GET /
← 200 GET / (3ms)
```

```typescript
interface LoggerOptions {
  category?: string[];  // Default: ["app", "router"]
}
```

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

Normalizes URL trailing slashes via 301 redirect. It is a fallback redirect: it only redirects when the request as written would be a 404, wherever you declare it.

```typescript
type TrailingSlashMode = "strip" | "add";
```

## License

MIT
