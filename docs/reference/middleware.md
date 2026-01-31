# Middleware

Middleware intercepts requests and responses, enabling cross-cutting concerns like authentication, logging, CORS, and caching.

## Quick Start

```typescript
import { Router } from "@b9g/router";

const router = new Router();

// Global middleware
router.use(async (request, context) => {
  console.log(request.method, request.url);
  return null; // Continue to next middleware
});

// Route with handler
router.route("/api/users").get(getUsers);

self.addEventListener("fetch", (event) => {
  event.respondWith(router.handle(event.request));
});
```

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

## Common Patterns

### Authentication

```typescript
const authMiddleware = async (request, context) => {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");

  if (!token) {
    return Response.json(
      { error: "Missing token" },
      { status: 401 }
    );
  }

  try {
    context.user = await verifyToken(token);
    return null;
  } catch {
    return Response.json(
      { error: "Invalid token" },
      { status: 401 }
    );
  }
};

router.use("/api", authMiddleware);
```

### Logging

```typescript
const loggingMiddleware = async function* (request, context) {
  const start = Date.now();
  const { method, url } = request;

  console.log(`→ ${method} ${url}`);

  const response = yield request;

  console.log(`← ${method} ${url} ${response.status} ${Date.now() - start}ms`);

  return response;
};

router.use(loggingMiddleware);
```

### Error Handling

```typescript
const errorHandler = async function* (request, context) {
  try {
    const response = yield request;
    return response;
  } catch (error) {
    console.error("Unhandled error:", error);

    return Response.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
};

router.use(errorHandler);
```

### Response Timing

```typescript
const timingMiddleware = async function* (request) {
  const start = Date.now();

  const response = yield request;

  const duration = Date.now() - start;
  response.headers.set("X-Response-Time", `${duration}ms`);

  return response;
};
```

### Request ID

```typescript
const requestIdMiddleware = async function* (request, context) {
  context.requestId = crypto.randomUUID();

  const response = yield request;

  response.headers.set("X-Request-ID", context.requestId);

  return response;
};
```

### Caching

```typescript
const cacheMiddleware = async function* (request) {
  const cache = await caches.open("api");

  // Check cache
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }

  // Get fresh response
  const response = yield request;

  // Cache successful responses
  if (response.ok) {
    await cache.put(request, response.clone());
  }

  return response;
};
```

### Rate Limiting

```typescript
const rateLimits = new Map<string, { count: number; reset: number }>();

const rateLimitMiddleware = async (request, context) => {
  const ip = request.headers.get("X-Forwarded-For") || "unknown";
  const now = Date.now();
  const limit = rateLimits.get(ip);

  if (limit && limit.reset > now && limit.count >= 100) {
    return new Response("Too Many Requests", {
      status: 429,
      headers: { "Retry-After": String(Math.ceil((limit.reset - now) / 1000)) },
    });
  }

  if (!limit || limit.reset <= now) {
    rateLimits.set(ip, { count: 1, reset: now + 60000 });
  } else {
    limit.count++;
  }

  return null;
};
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
