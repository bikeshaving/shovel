# ServiceWorker

Shovel applications use the ServiceWorker API for handling requests. Your code runs in a ServiceWorker-like environment with the same lifecycle events and global APIs.

## Quick Start

```typescript
// Handle incoming requests
self.addEventListener("fetch", (event) => {
  event.respondWith(new Response("Hello World"));
});

// Run setup tasks during install
self.addEventListener("install", (event) => {
  event.waitUntil(initializeApp());
});

// Run migrations during activation
self.addEventListener("activate", (event) => {
  event.waitUntil(runMigrations());
});
```

---

## Lifecycle

The ServiceWorker goes through these states:

```
parsing → installing → installed → activating → activated
```

### 1. Parsing

Your code is loaded and executed. Global setup runs here:

```typescript
// Runs during parsing
const router = new Router();
router.route("/").get(() => new Response("Home"));

// Register event handlers
self.addEventListener("fetch", ...);
self.addEventListener("install", ...);
self.addEventListener("activate", ...);
```

### 2. Installing

The `install` event fires. Use `waitUntil` for async setup:

```typescript
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      // Pre-cache static assets
      const cache = await caches.open("static-v1");
      await cache.addAll(["/app.js", "/styles.css"]);
    })()
  );
});
```

- Install completes when all `waitUntil` promises resolve
- Install fails if any promise rejects
- 30-second timeout for all promises

### 3. Activating

After install, the `activate` event fires:

```typescript
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Run database migrations
      await databases.open("main", 2, (e) => {
        e.waitUntil(runMigrations(e.db, e.oldVersion));
      });

      // Clean old caches
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== "static-v1")
          .map((key) => caches.delete(key))
      );
    })()
  );
});
```

- Activation completes when all `waitUntil` promises resolve
- Activation fails if any promise rejects
- 30-second timeout for all promises

### 4. Activated

The worker is ready to handle requests. `fetch` events now fire.

---

## Fetch Event

The `fetch` event fires for every incoming request:

```typescript
self.addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/api/health") {
    return Response.json({ ok: true });
  }

  return new Response("Not Found", { status: 404 });
}
```

### FetchEvent Properties

| Property | Type | Description |
|----------|------|-------------|
| `request` | `Request` | The incoming request |
| `clientId` | `string` | Unique client identifier |

### FetchEvent Methods

#### event.respondWith(response)

Sets the response for the request. Must be called synchronously during event dispatch.

```typescript
self.addEventListener("fetch", (event) => {
  // Synchronous - OK
  event.respondWith(new Response("Hello"));
});

self.addEventListener("fetch", (event) => {
  // Promise - OK
  event.respondWith(fetchFromAPI(event.request));
});
```

#### event.waitUntil(promise)

Extends the event lifetime for background work. The response is sent immediately, but the worker stays alive until the promise resolves.

```typescript
self.addEventListener("fetch", (event) => {
  event.respondWith(new Response("OK"));

  // Log request in background (doesn't block response)
  event.waitUntil(logRequest(event.request));
});
```

---

## Install Event

The `install` event fires once when the worker is first registered:

```typescript
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      console.log("Installing...");

      // Pre-cache critical assets
      const cache = await caches.open("app-v1");
      await cache.addAll([
        "/",
        "/app.js",
        "/styles.css",
        "/logo.png",
      ]);

      console.log("Install complete");
    })()
  );
});
```

### Common Install Tasks

- Pre-cache static assets
- Initialize global state
- Validate configuration

---

## Activate Event

The `activate` event fires after successful installation:

```typescript
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Open database with migrations
      await databases.open("main", 1, (e) => {
        e.waitUntil(
          e.db.exec`
            CREATE TABLE IF NOT EXISTS users (
              id INTEGER PRIMARY KEY,
              name TEXT NOT NULL
            )
          `
        );
      });
    })()
  );
});
```

### Common Activate Tasks

- Database migrations
- Cache cleanup
- State initialization
- Pre-rendering static pages

### Database Migrations

The activate event is the ideal place for database migrations:

```typescript
self.addEventListener("activate", (event) => {
  event.waitUntil(
    databases.open("main", 3, (e) => {
      e.waitUntil(
        (async () => {
          const db = e.db;

          if (e.oldVersion < 1) {
            await db.exec`
              CREATE TABLE users (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL
              )
            `;
          }

          if (e.oldVersion < 2) {
            await db.exec`
              ALTER TABLE users ADD COLUMN email TEXT
            `;
          }

          if (e.oldVersion < 3) {
            await db.exec`
              CREATE INDEX idx_users_email ON users(email)
            `;
          }
        })()
      );
    })
  );
});
```

---

## ExtendableEvent

All lifecycle events extend `ExtendableEvent`:

```typescript
interface ExtendableEvent extends Event {
  waitUntil(promise: Promise<any>): void;
}
```

### waitUntil Rules

1. Can be called synchronously during event dispatch
2. Can be called asynchronously if there are pending promises
3. Multiple calls are allowed
4. All promises must resolve for the event to complete

```typescript
self.addEventListener("activate", (event) => {
  // First waitUntil - synchronous
  event.waitUntil(taskOne());

  // Second waitUntil - also synchronous
  event.waitUntil(taskTwo());

  // Can chain more inside async code
  event.waitUntil(
    (async () => {
      await taskThree();
      // Third waitUntil - valid because prior promises still pending
      event.waitUntil(taskFour());
    })()
  );
});
```

---

## Globals

These globals are available in your ServiceWorker code:

| Global | Type | Description |
|--------|------|-------------|
| `self` | `ServiceWorkerGlobalScope` | The global scope |
| `caches` | `CacheStorage` | Cache API |
| `databases` | `DatabaseStorage` | SQL databases |
| `directories` | `DirectoryStorage` | File system |
| `loggers` | `LoggerStorage` | Structured logging |
| `cookieStore` | `CookieStore` | Cookie access |
| `crypto` | `Crypto` | Web Crypto API |
| `fetch` | `function` | Fetch API |

### Request-Scoped Globals

Some globals are request-scoped using AsyncContext:

```typescript
self.addEventListener("fetch", async (event) => {
  // cookieStore is scoped to this request
  const cookies = await cookieStore.getAll();

  event.respondWith(Response.json({ cookies }));
});
```

---

## Common Patterns

### Router Integration

```typescript
import { Router } from "@b9g/router";

const router = new Router();

router.route("/").get(() => new Response("Home"));
router.route("/api/users").get(getUsers);
router.route("/api/users/:id").get(getUser);

self.addEventListener("fetch", (event) => {
  event.respondWith(router.handle(event.request));
});
```

### Request Timeout

```typescript
self.addEventListener("fetch", (event) => {
  const responsePromise = handleRequest(event.request);

  const timeoutPromise = new Promise<Response>((_, reject) => {
    setTimeout(() => reject(new Error("Timeout")), 5000);
  });

  event.respondWith(
    Promise.race([responsePromise, timeoutPromise]).catch(() => {
      return new Response("Request Timeout", { status: 504 });
    })
  );
});
```

### Background Logging

```typescript
self.addEventListener("fetch", (event) => {
  const start = Date.now();

  event.respondWith(handleRequest(event.request));

  // Log after response is sent
  event.waitUntil(
    (async () => {
      const duration = Date.now() - start;
      const logger = loggers.get(["app", "http"]);
      logger.info("Request completed", {
        url: event.request.url,
        method: event.request.method,
        duration,
      });
    })()
  );
});
```

### Static Site Generation

```typescript
self.addEventListener("activate", (event) => {
  event.waitUntil(generateStaticSite());
});

async function generateStaticSite() {
  const pages = ["/", "/about", "/contact"];
  const cache = await caches.open("static");

  for (const path of pages) {
    const html = await renderPage(path);
    const response = new Response(html, {
      headers: { "Content-Type": "text/html" },
    });
    await cache.put(new Request(path), response);
  }
}

self.addEventListener("fetch", (event) => {
  event.respondWith(
    (async () => {
      const cache = await caches.open("static");
      const cached = await cache.match(event.request);
      if (cached) return cached;

      return new Response("Not Found", { status: 404 });
    })()
  );
});
```

### Error Boundary

```typescript
self.addEventListener("fetch", (event) => {
  event.respondWith(
    handleRequest(event.request).catch((error) => {
      const logger = loggers.get(["app"]);
      logger.error("Unhandled error", {
        error: error.message,
        stack: error.stack,
        url: event.request.url,
      });

      return Response.json(
        { error: "Internal Server Error" },
        { status: 500 }
      );
    })
  );
});
```

---

## Differences from Browser ServiceWorkers

Shovel's ServiceWorker environment differs from browser ServiceWorkers:

| Feature | Browser | Shovel |
|---------|---------|--------|
| Runs in | Browser | Server (Bun/Node.js) |
| Scope | Origin + path | Entire application |
| Registration | JavaScript API | Automatic |
| Updates | navigator.serviceWorker | App restart |
| Clients | Browser tabs | N/A |
| Push | Web Push API | N/A |
| Sync | Background Sync API | N/A |

### Supported APIs

- Fetch event handling
- Install/activate lifecycle
- Cache API
- CookieStore API
- Crypto API

### Server-Only APIs

- `databases` - SQL database access
- `directories` - File system access
- `loggers` - Structured logging

---

## See Also

- [Routing](./routing.md) - Route definition and handlers
- [Middleware](./middleware.md) - Request/response processing
- [Caches](./caches.md) - Response caching
- [Databases](./databases.md) - SQL database storage
- [Directories](./directories.md) - File system storage
- [Logging](./logging.md) - Structured logging
