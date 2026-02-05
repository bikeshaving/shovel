---
title: Middleware
description: Add authentication, logging, and other cross-cutting concerns.
---

Middleware intercepts requests and responses for authentication, logging, CORS, and more.

## Basic Middleware

Return `null` to continue, or a `Response` to stop:

```typescript
const authMiddleware = async (request, context) => {
  const token = request.headers.get("Authorization");

  if (!token) {
    return new Response("Unauthorized", { status: 401 });
  }

  context.user = await validateToken(token);
  return null; // Continue to handler
};

router.use("/api", authMiddleware);
```

## Generator Middleware

Use `yield` for before/after hooks:

```typescript
const loggingMiddleware = async function* (request) {
  const start = Date.now();
  console.log("→", request.method, request.url);

  const response = yield request;

  console.log("←", response.status, Date.now() - start, "ms");
  return response;
};

router.use(loggingMiddleware);
```

## Scoped Middleware

Apply middleware to specific paths or routes:

```typescript
// Global
router.use(loggingMiddleware);

// Path-scoped
router.use("/api", authMiddleware);

// Route-scoped
router
  .route("/admin/users")
  .use(requireAdmin)
  .get(listUsers);
```

## Built-in CORS

```typescript
import { cors } from "@b9g/router/middleware";

router.use(cors({
  origin: ["https://example.com"],
  methods: ["GET", "POST"],
  credentials: true,
}));
```

## Error Handling

Catch errors with generator middleware:

```typescript
const errorHandler = async function* (request) {
  try {
    return yield request;
  } catch (error) {
    console.error(error);
    return Response.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
};

router.use(errorHandler);
```

## Next Steps

- See [Middleware Reference](/api/middleware) for all patterns
- Learn about [Caches](/api/cache) for response caching
