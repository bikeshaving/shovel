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
const timing = async function* (request) {
  const start = Date.now();
  const response = yield request;
  response.headers.set("X-Response-Time", `${Date.now() - start}ms`);
  return response;
};

router.use(timing);
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

## Built-in Middleware

```typescript
import { cors, logger } from "@b9g/router/middleware";

// Request logging via LogTape (category: ["app", "router"])
router.use(logger());

// CORS
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
