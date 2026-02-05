# AsyncContext

Shovel provides `AsyncContext` for propagating values through asynchronous operations. This implements the [TC39 AsyncContext proposal](https://github.com/tc39/proposal-async-context), enabling request-scoped data without passing context through every function.

## Quick Start

```typescript
import { AsyncContext } from "@b9g/async-context";

const requestId = new AsyncContext.Variable<string>();

self.addEventListener("fetch", (event) => {
  const id = crypto.randomUUID();

  requestId.run(id, () => {
    event.respondWith(handleRequest(event.request));
  });
});

async function handleRequest(request: Request) {
  // Access the request ID anywhere in the call stack
  console.log("Request:", requestId.get());

  const data = await fetchData();
  return Response.json(data);
}

async function fetchData() {
  // Still accessible here
  console.log("Fetching for:", requestId.get());
  return { id: requestId.get() };
}
```

---

## AsyncContext.Variable

A `Variable` stores a value that propagates through async operations.

### Constructor

```typescript
const variable = new AsyncContext.Variable<T>(options?: {
  defaultValue?: T;
  name?: string;
});
```

| Option | Type | Description |
|--------|------|-------------|
| `defaultValue` | `T` | Value returned when not in a `run()` context |
| `name` | `string` | Debug name for the variable |

### variable.run(value, fn, ...args)

Executes a function with the variable set to a value.

```typescript
const user = new AsyncContext.Variable<User>();

const result = user.run({ id: 1, name: "Alice" }, () => {
  // user.get() returns { id: 1, name: "Alice" }
  return doSomething();
});
```

The value is available to all synchronous and asynchronous code within `fn`.

### variable.get()

Gets the current value.

```typescript
const currentUser = user.get();

if (currentUser) {
  console.log(currentUser.name);
}
```

Returns `undefined` (or the default value) if not in a `run()` context.

---

## AsyncContext.Snapshot

A `Snapshot` captures all current variable values and can restore them later.

### Constructor

```typescript
const snapshot = new AsyncContext.Snapshot();
```

Captures all `Variable` values at the moment of creation.

### snapshot.run(fn, ...args)

Executes a function with the captured values restored.

```typescript
const requestId = new AsyncContext.Variable<string>();

let savedSnapshot: AsyncContext.Snapshot;

requestId.run("req-123", () => {
  // Capture current state
  savedSnapshot = new AsyncContext.Snapshot();
});

// Later, restore the captured state
savedSnapshot.run(() => {
  console.log(requestId.get()); // "req-123"
});
```

### AsyncContext.Snapshot.wrap(fn)

Creates a wrapped function that runs with the current context.

```typescript
const requestId = new AsyncContext.Variable<string>();

requestId.run("req-123", () => {
  const wrapped = AsyncContext.Snapshot.wrap(() => {
    console.log(requestId.get());
  });

  // Can be called later, outside the run() context
  setTimeout(wrapped, 1000); // Logs "req-123"
});
```

---

## Nested Contexts

Variables can be nested. Inner `run()` calls shadow outer values:

```typescript
const level = new AsyncContext.Variable<number>();

level.run(1, () => {
  console.log(level.get()); // 1

  level.run(2, () => {
    console.log(level.get()); // 2

    level.run(3, () => {
      console.log(level.get()); // 3
    });

    console.log(level.get()); // 2
  });

  console.log(level.get()); // 1
});
```

---

## Common Patterns

### Request Context

```typescript
interface RequestContext {
  requestId: string;
  userId?: string;
  startTime: number;
}

const requestContext = new AsyncContext.Variable<RequestContext>();

self.addEventListener("fetch", (event) => {
  const context: RequestContext = {
    requestId: crypto.randomUUID(),
    startTime: Date.now(),
  };

  requestContext.run(context, () => {
    event.respondWith(handleRequest(event.request));
  });
});

function getRequestId(): string {
  return requestContext.get()?.requestId ?? "unknown";
}

function getRequestDuration(): number {
  const ctx = requestContext.get();
  return ctx ? Date.now() - ctx.startTime : 0;
}
```

### Logging Context

```typescript
const logContext = new AsyncContext.Variable<Record<string, unknown>>();

function log(message: string, data?: Record<string, unknown>) {
  const context = logContext.get() ?? {};
  console.log(JSON.stringify({
    ...context,
    ...data,
    message,
    timestamp: new Date().toISOString(),
  }));
}

self.addEventListener("fetch", (event) => {
  logContext.run({ requestId: crypto.randomUUID() }, () => {
    log("Request started", { url: event.request.url });
    event.respondWith(handleRequest(event.request));
  });
});

async function handleRequest(request: Request) {
  log("Processing request"); // Includes requestId automatically
  // ...
}
```

### Database Transaction Context

```typescript
const txContext = new AsyncContext.Variable<Transaction>();

async function withTransaction<T>(fn: () => Promise<T>): Promise<T> {
  const db = databases.get("main");
  await db.exec`BEGIN`;

  try {
    const result = await txContext.run({ db }, fn);
    await db.exec`COMMIT`;
    return result;
  } catch (error) {
    await db.exec`ROLLBACK`;
    throw error;
  }
}

async function query(sql: TemplateStringsArray, ...values: unknown[]) {
  const tx = txContext.get();
  const db = tx?.db ?? databases.get("main");
  return db.all(sql, ...values);
}
```

### User Authentication

```typescript
interface AuthContext {
  user: User | null;
  permissions: string[];
}

const authContext = new AsyncContext.Variable<AuthContext>({
  defaultValue: { user: null, permissions: [] },
});

async function requireAuth() {
  const ctx = authContext.get();
  if (!ctx?.user) {
    throw new Error("Unauthorized");
  }
  return ctx.user;
}

function hasPermission(permission: string): boolean {
  const ctx = authContext.get();
  return ctx?.permissions.includes(permission) ?? false;
}

// Middleware sets auth context
const authMiddleware = async (request: Request, context: RouteContext) => {
  const user = await validateToken(request);
  const permissions = user ? await getPermissions(user.id) : [];

  return authContext.run({ user, permissions }, () => null);
};
```

### Callback Preservation

Use `Snapshot.wrap()` to preserve context across callbacks:

```typescript
const requestId = new AsyncContext.Variable<string>();

requestId.run("req-123", () => {
  // Without wrap, context would be lost
  setTimeout(AsyncContext.Snapshot.wrap(() => {
    console.log(requestId.get()); // "req-123"
  }), 100);

  // Event listeners
  emitter.on("data", AsyncContext.Snapshot.wrap((data) => {
    console.log(requestId.get()); // "req-123"
  }));
});
```

---

## How It Works

`AsyncContext` uses Node.js `AsyncLocalStorage` under the hood, which tracks context across async boundaries:

- `await` expressions
- `Promise.then()` callbacks
- `setTimeout` / `setInterval`
- `EventEmitter` callbacks
- `queueMicrotask`

Context is automatically propagated without explicit passing.

---

## Shovel Built-in Contexts

Shovel uses AsyncContext internally for:

| Global | Description |
|--------|-------------|
| `cookieStore` | Request-scoped cookie access |

This ensures `self.cookieStore` returns the correct cookies for each concurrent request.

---

## Best Practices

### Use Descriptive Names

```typescript
// Good
const requestContext = new AsyncContext.Variable<RequestContext>({
  name: "requestContext",
});

// Avoid
const ctx = new AsyncContext.Variable();
```

### Provide Default Values

```typescript
const config = new AsyncContext.Variable<Config>({
  defaultValue: defaultConfig,
});
```

### Type Your Variables

```typescript
// Good - explicit type
const user = new AsyncContext.Variable<User | null>();

// Avoid - inferred as unknown
const user = new AsyncContext.Variable();
```

### Keep Context Objects Immutable

```typescript
// Good - create new object
requestContext.run({ ...context, userId }, fn);

// Avoid - mutating shared object
context.userId = userId;
requestContext.run(context, fn);
```

---

## See Also

- [Cookies](./cookies.md) - Request-scoped cookie access
- [ServiceWorker](./serviceworker.md) - Request handling
- [Middleware](./middleware.md) - Request processing
