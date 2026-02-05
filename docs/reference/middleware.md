# Middleware

Middleware intercepts requests and responses, enabling cross-cutting concerns like authentication, logging, CORS, and caching. Part of the [@b9g/router](https://npmjs.com/package/@b9g/router) package.

For a tutorial introduction, see the [Middleware Guide](../guides/06-middleware.md).

---

## Middleware Types

Shovel supports two middleware patterns:

### Function Middleware

Simple functions that can short-circuit or continue:

```typescript
type FunctionMiddleware = (
  request: Request,
  context: RouteContext
) => Response | null | void | Promise<Response | null | void>;
```

- Return a `Response` to short-circuit (stop processing)
- Return `null` or `void` to continue to the next middleware

```typescript
const authMiddleware = async (request, context) => {
  const token = request.headers.get("Authorization");

  if (!token) {
    return new Response("Unauthorized", { status: 401 });
  }

  context.user = await validateToken(token);
  return null; // Continue
};
```

### Generator Middleware

Advanced pattern using `yield` for before/after hooks:

```typescript
type GeneratorMiddleware = (
  request: Request,
  context: RouteContext
) => AsyncGenerator<Request, Response, Response>;
```

```typescript
const loggingMiddleware = async function* (request, context) {
  const start = Date.now();
  console.log("→", request.method, request.url);

  const response = yield request; // Pass to next middleware

  console.log("←", response.status, Date.now() - start, "ms");
  return response;
};
```

---

## Registering Middleware

### Global Middleware

Runs on every request:

```typescript
router.use(loggingMiddleware);
router.use(corsMiddleware);
```

### Path-Scoped Middleware

Runs only for matching paths:

```typescript
router.use("/api", authMiddleware);
router.use("/admin", adminOnlyMiddleware);
```

### Route-Scoped Middleware

Runs only for a specific route:

```typescript
router
  .route("/api/users/:id")
  .use(authMiddleware)
  .use(rateLimitMiddleware)
  .get(getUser)
  .put(updateUser);
```

---

## Execution Order

Middleware executes in **LIFO (Last In, First Out)** order for generator middleware:

```
Request
  ↓
Global middleware (before yield)
  ↓
Path middleware (before yield)
  ↓
Route middleware (before yield)
  ↓
Handler
  ↓
Route middleware (after yield)
  ↓
Path middleware (after yield)
  ↓
Global middleware (after yield)
  ↓
Response
```

Example:

```typescript
router.use(async function* (req) {
  console.log("1: before");
  const res = yield req;
  console.log("5: after");
  return res;
});

router.use("/api", async function* (req) {
  console.log("2: before");
  const res = yield req;
  console.log("4: after");
  return res;
});

router.route("/api/test").get(() => {
  console.log("3: handler");
  return new Response("OK");
});

// Output:
// 1: before
// 2: before
// 3: handler
// 4: after
// 5: after
```

---

## Built-in Middleware

### CORS

```typescript
import { cors } from "@b9g/router/middleware";

router.use(cors({
  origin: ["https://example.com", "https://app.example.com"],
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
  maxAge: 86400,
}));
```

#### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `origin` | `string \| string[] \| ((origin: string) => boolean)` | `"*"` | Allowed origins |
| `methods` | `string[]` | `["GET", "POST", ...]` | Allowed methods |
| `allowedHeaders` | `string[]` | `[]` | Allowed request headers |
| `exposedHeaders` | `string[]` | `[]` | Exposed response headers |
| `credentials` | `boolean` | `false` | Allow credentials |
| `maxAge` | `number` | `0` | Preflight cache duration |

### Trailing Slash

```typescript
import { trailingSlash } from "@b9g/router/middleware";

// Redirect /path/ → /path
router.use(trailingSlash("strip"));

// Redirect /path → /path/
router.use(trailingSlash("add"));
```

### Static Assets

```typescript
import { assets } from "@b9g/assets/middleware";

router.use(assets({
  manifestPath: "assets.json",
  cacheControl: "public, max-age=31536000, immutable",
}));
```

---

## Context Augmentation

Middleware can add properties to the context:

```typescript
// Declare the context extension
declare module "@b9g/router" {
  interface RouteContext {
    user?: User;
    requestId?: string;
  }
}

// Middleware adds properties
const authMiddleware = async (request, context) => {
  context.user = await getUser(request);
  context.requestId = crypto.randomUUID();
  return null;
};

// Handler uses them
router.route("/profile").get((request, context) => {
  return Response.json({
    user: context.user,
    requestId: context.requestId,
  });
});
```

---

## Composing Middleware

### Middleware Factory

Create configurable middleware:

```typescript
function requireRole(role: string) {
  return async (request, context) => {
    if (context.user?.role !== role) {
      return Response.json(
        { error: "Forbidden" },
        { status: 403 }
      );
    }
    return null;
  };
}

router.use("/admin", requireRole("admin"));
```

### Combining Middleware

```typescript
function combine(...middlewares) {
  return async function* (request, context) {
    for (const mw of middlewares) {
      const result = await mw(request, context);
      if (result) return result;
    }
    return yield request;
  };
}

router.use(combine(
  loggingMiddleware,
  authMiddleware,
  rateLimitMiddleware
));
```

---

## Error Handling in Generators

Generator middleware can catch errors from downstream:

```typescript
const errorBoundary = async function* (request, context) {
  try {
    const response = yield request;
    return response;
  } catch (error) {
    // Log the error
    console.error("Error:", error);

    // Return error response
    if (error instanceof ValidationError) {
      return Response.json(
        { error: error.message },
        { status: 400 }
      );
    }

    return Response.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
};

// Must be first to catch all errors
router.use(errorBoundary);
```

---

## See Also

- [Routing](./routing.md) - Route definition and matching
- [ServiceWorker](./serviceworker.md) - Event handling lifecycle
- [Caches](./caches.md) - Response caching
