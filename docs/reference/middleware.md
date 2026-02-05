# @b9g/router/middleware

Middleware for the [@b9g/router](./router.md) package.

---

## Middleware Types

### FunctionMiddleware

```typescript
type FunctionMiddleware = (
  request: Request,
  context: RouteContext
) => Response | null | void | Promise<Response | null | void>;
```

Return `Response` to short-circuit, `null` or `void` to continue.

### GeneratorMiddleware

```typescript
type GeneratorMiddleware = (
  request: Request,
  context: RouteContext
) => AsyncGenerator<Request, Response, Response>;
```

Use `yield` to pass control to the next handler.

```typescript
const timing = async function* (request) {
  const start = Date.now();
  const response = yield request;
  response.headers.set("X-Response-Time", `${Date.now() - start}ms`);
  return response;
};
```

---

## Router.use()

### use(middleware: Middleware): void

Registers global middleware.

```typescript
router.use(loggingMiddleware);
```

### use(path: string, middleware: Middleware): void

Registers path-scoped middleware.

```typescript
router.use("/api", authMiddleware);
```

---

## Route.use()

### use(middleware: Middleware): Route

Registers route-scoped middleware.

```typescript
router.route("/api/users/:id")
  .use(authMiddleware)
  .get(getUser);
```

---

## Execution Order

LIFO (Last In, First Out) for generator middleware:

```
Request → Global (before) → Path (before) → Route (before)
                            ↓
                         Handler
                            ↓
Response ← Global (after) ← Path (after) ← Route (after)
```

---

## Built-in Middleware

### cors(options?: CorsOptions)

```typescript
import { cors } from "@b9g/router/middleware";

router.use(cors({
  origin: "https://example.com",
  credentials: true,
}));
```

#### CorsOptions

| Option | Type | Default |
|--------|------|---------|
| `origin` | `string \| string[] \| (origin: string) => boolean` | `"*"` |
| `methods` | `string[]` | `["GET", "POST", ...]` |
| `allowedHeaders` | `string[]` | `[]` |
| `exposedHeaders` | `string[]` | `[]` |
| `credentials` | `boolean` | `false` |
| `maxAge` | `number` | `0` |

### trailingSlash(mode: "strip" | "add")

```typescript
import { trailingSlash } from "@b9g/router/middleware";

router.use(trailingSlash("strip")); // /path/ → /path
router.use(trailingSlash("add"));   // /path → /path/
```

---

## Context Augmentation

```typescript
declare module "@b9g/router" {
  interface RouteContext {
    user?: User;
  }
}

router.use(async (request, context) => {
  context.user = await getUser(request);
  return null;
});
```

---

## See Also

- [Router](./router.md) - Route definition
- [ServiceWorker](./serviceworker.md) - Event handling

