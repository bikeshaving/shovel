# Routing

A fast router built on web standards. Part of [@b9g/router](https://npmjs.com/package/@b9g/router).

---

## Router

```typescript
import { Router } from "@b9g/router";
const router = new Router();
```

### route(pattern: string, options?: RouteOptions): Route

Defines a route. Returns a `Route` object for chaining HTTP methods.

```typescript
router.route("/users/:id").get(handler);
router.route("/posts/:id", { name: "post" }).get(handler);
```

### use(middleware: Middleware): void
### use(path: string, middleware: Middleware): void

Registers middleware globally or for a path prefix.

```typescript
router.use(loggingMiddleware);
router.use("/api", authMiddleware);
```

### mount(prefix: string, subrouter: Router): void

Mounts a subrouter at a path prefix.

```typescript
router.mount("/api/v1", apiRouter);
```

### handle(request: Request): Promise\<Response\>

Handles a request and returns a response.

```typescript
const response = await router.handle(request);
```

### match(url: string): RouteMatch | null

Tests if a URL matches any route.

```typescript
const match = router.match("/users/123");
// { params: { id: "123" }, methods: ["GET"], pattern: "/users/:id" }
```

### url(name: string, params: Record\<string, string\>): string

Generates a URL from a named route.

```typescript
router.url("post", { id: "123" }); // "/posts/123"
```

---

## Route

Returned by `router.route()`. Chain HTTP methods:

### get(handler: Handler): Route
### post(handler: Handler): Route
### put(handler: Handler): Route
### delete(handler: Handler): Route
### patch(handler: Handler): Route
### head(handler: Handler): Route
### options(handler: Handler): Route

```typescript
router.route("/users/:id")
  .get(getUser)
  .put(updateUser)
  .delete(deleteUser);
```

---

## Handler

```typescript
type Handler = (
  request: Request,
  context: RouteContext
) => Response | Promise<Response>;
```

### RouteContext

```typescript
interface RouteContext {
  params: Record<string, string>;
  // Plus properties added by middleware
}
```

---

## Pattern Syntax

| Pattern | Matches | Example |
|---------|---------|---------|
| `/users` | Static path | `/users` |
| `/users/:id` | Named parameter | `/users/123` → `{ id: "123" }` |
| `/users/:id(\\d+)` | With constraint | `/users/123` (not `/users/abc`) |
| `/users/:id?` | Optional parameter | `/users`, `/users/123` |
| `/files/:path+` | One or more segments | `/files/a/b/c` |
| `/files/:path*` | Zero or more segments | `/files`, `/files/a/b` |
| `/files/*` | Wildcard | `/files/anything/here` |

---

## RouteOptions

| Option | Type | Description |
|--------|------|-------------|
| `name` | `string` | Name for URL generation |

---

## RouteMatch

Returned by `router.match()`:

| Property | Type | Description |
|----------|------|-------------|
| `params` | `Record<string, string>` | Extracted parameters |
| `methods` | `string[]` | Registered HTTP methods |
| `pattern` | `string` | Matched pattern |
| `name` | `string \| undefined` | Route name if set |

---

## See Also

- [Middleware](./middleware.md) - Request/response middleware
- [ServiceWorker](./serviceworker.md) - Event handling
