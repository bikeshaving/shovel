# Routing

Shovel includes a fast, universal router built on web standards. It works across all JavaScript runtimes using the standard [Request](https://developer.mozilla.org/en-US/docs/Web/API/Request) / [Response](https://developer.mozilla.org/en-US/docs/Web/API/Response) APIs.

## Quick Start

```typescript
import { Router } from "@b9g/router";

const router = new Router();

router.route("/").get(() => new Response("Hello World"));

router.route("/users/:id").get((request, context) => {
  return Response.json({ id: context.params.id });
});

self.addEventListener("fetch", (event) => {
  event.respondWith(router.handle(event.request));
});
```

---

## Route Definition

### Basic Routes

```typescript
const router = new Router();

// Static path
router.route("/").get(handler);
router.route("/about").get(handler);

// Path parameters
router.route("/users/:id").get(handler);
router.route("/posts/:postId/comments/:commentId").get(handler);

// Wildcard (matches rest of path)
router.route("/files/*").get(handler);
```

### HTTP Methods

Chain methods on a route:

```typescript
router
  .route("/users/:id")
  .get(getUser)
  .put(updateUser)
  .delete(deleteUser);

router
  .route("/users")
  .get(listUsers)
  .post(createUser);
```

Available methods:
- `.get(handler)`
- `.post(handler)`
- `.put(handler)`
- `.delete(handler)`
- `.patch(handler)`
- `.head(handler)`
- `.options(handler)`

### Named Routes

```typescript
router.route("/users/:id", { name: "user" }).get(handler);

// Generate URLs
const url = router.url("user", { id: "123" });
// "/users/123"
```

---

## Route Parameters

Parameters are extracted from the URL and available in `context.params`:

```typescript
router.route("/users/:id").get((request, context) => {
  const { id } = context.params;
  return Response.json({ id });
});

router.route("/posts/:year/:month/:slug").get((request, context) => {
  const { year, month, slug } = context.params;
  return Response.json({ year, month, slug });
});
```

### Parameter Constraints

Use regex constraints to validate parameters:

```typescript
// Only match numeric IDs
router.route("/users/:id(\\d+)").get(handler);

// Only match UUIDs
router.route("/items/:uuid([a-f0-9-]{36})").get(handler);
```

### Modifiers

```typescript
// Optional parameter
router.route("/users/:id?").get(handler);
// Matches: /users, /users/123

// One or more segments
router.route("/files/:path+").get(handler);
// Matches: /files/a, /files/a/b, /files/a/b/c

// Zero or more segments
router.route("/docs/:path*").get(handler);
// Matches: /docs, /docs/a, /docs/a/b
```

---

## Handlers

Handlers receive the request and a context object:

```typescript
type Handler = (
  request: Request,
  context: RouteContext
) => Response | Promise<Response>;

interface RouteContext {
  params: Record<string, string>;
  // Plus any properties added by middleware
}
```

### Returning Responses

```typescript
// Plain text
router.route("/text").get(() => {
  return new Response("Hello");
});

// JSON
router.route("/json").get(() => {
  return Response.json({ message: "Hello" });
});

// HTML
router.route("/html").get(() => {
  return new Response("<h1>Hello</h1>", {
    headers: { "Content-Type": "text/html" },
  });
});

// Redirect
router.route("/old").get(() => {
  return Response.redirect("/new", 301);
});

// Error
router.route("/error").get(() => {
  return new Response("Not Found", { status: 404 });
});
```

### Async Handlers

```typescript
router.route("/users/:id").get(async (request, context) => {
  const db = databases.get("main");
  const user = await db.get`
    SELECT * FROM users WHERE id = ${context.params.id}
  `;

  if (!user) {
    return new Response("Not Found", { status: 404 });
  }

  return Response.json(user);
});
```

### Reading Request Body

```typescript
router.route("/users").post(async (request) => {
  // JSON body
  const body = await request.json();

  // Form data
  const formData = await request.formData();

  // Text
  const text = await request.text();

  // Binary
  const buffer = await request.arrayBuffer();

  return Response.json({ received: true });
});
```

---

## Route Mounting

Compose routers by mounting subrouters:

```typescript
// API routes
const apiRouter = new Router();
apiRouter.route("/users").get(listUsers);
apiRouter.route("/users/:id").get(getUser);
apiRouter.route("/posts").get(listPosts);

// Mount under /api/v1
const mainRouter = new Router();
mainRouter.mount("/api/v1", apiRouter);

// Routes become:
// /api/v1/users
// /api/v1/users/:id
// /api/v1/posts
```

### Versioned APIs

```typescript
const v1 = new Router();
v1.route("/users").get(v1ListUsers);

const v2 = new Router();
v2.route("/users").get(v2ListUsers);

const router = new Router();
router.mount("/api/v1", v1);
router.mount("/api/v2", v2);
```

---

## 404 Handling

Use a catch-all route or middleware:

```typescript
// Catch-all route (must be last)
router.route("/*").get(() => {
  return new Response("Not Found", { status: 404 });
});

// Or use middleware
router.use(async function* (request) {
  const response = yield request;
  if (!response) {
    return new Response("Not Found", { status: 404 });
  }
  return response;
});
```

---

## ServiceWorker Integration

Connect the router to the fetch event:

```typescript
import { Router } from "@b9g/router";

const router = new Router();

// Define routes
router.route("/").get(() => new Response("Home"));
router.route("/api/health").get(() => Response.json({ ok: true }));

// Handle fetch events
self.addEventListener("fetch", (event) => {
  event.respondWith(router.handle(event.request));
});
```

---

## URL Generation

Generate URLs from named routes:

```typescript
router.route("/users/:id", { name: "user" }).get(handler);
router.route("/posts/:year/:month/:slug", { name: "post" }).get(handler);

// Generate URLs
router.url("user", { id: "123" });
// "/users/123"

router.url("post", { year: "2024", month: "01", slug: "hello" });
// "/posts/2024/01/hello"
```

---

## Route Matching

### router.match(url)

Test if a URL matches any route:

```typescript
const match = router.match("/users/123");

if (match) {
  console.log(match.params);   // { id: "123" }
  console.log(match.methods);  // ["GET", "PUT", "DELETE"]
  console.log(match.pattern);  // "/users/:id"
  console.log(match.name);     // "user" (if named)
}
```

Returns `null` if no route matches.

---

## Pattern Matching Details

The router uses two matching strategies:

### Radix Tree (O(1) Lookup)

Used for simple patterns:
- Static: `/users`, `/api/health`
- Parameters: `/users/:id`, `/posts/:id/comments`
- Wildcards: `/files/*`

### Regex Compilation

Used for complex patterns:
- Constraints: `/users/:id(\\d+)`
- Modifiers: `/files/:path+`, `/docs/:path*`
- Optional segments: `/users/:id?`

The router automatically selects the optimal strategy.

---

## TypeScript

### Type-Safe Parameters

```typescript
interface UserParams {
  id: string;
}

router.route("/users/:id").get((request, context) => {
  const id: string = context.params.id;
  return Response.json({ id });
});
```

### Augmenting Context

Extend the context with middleware-provided properties:

```typescript
declare module "@b9g/router" {
  interface RouteContext {
    user?: User;
    session?: Session;
  }
}

// Now TypeScript knows about context.user
router.route("/profile").get((request, context) => {
  return Response.json(context.user);
});
```

---

## See Also

- [Middleware](./middleware.md) - Request/response processing
- [ServiceWorker](./serviceworker.md) - Event handling lifecycle
- [Caches](./caches.md) - Response caching
