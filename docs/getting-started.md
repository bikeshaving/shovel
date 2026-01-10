# Getting Started

Shovel is a server-side JavaScript framework that uses the ServiceWorker API. Your code runs in a familiar environment with standard web APIs.

## Installation

```bash
# Create a new project
mkdir my-app && cd my-app
npm init -y

# Install Shovel
npm install shovel
```

## Quick Start

Create `src/server.ts`:

```typescript
self.addEventListener("fetch", (event) => {
  event.respondWith(new Response("Hello, World!"));
});
```

Run the development server:

```bash
npx shovel develop src/server.ts
```

Open http://localhost:3000 to see your app.

---

## Project Structure

A typical Shovel project:

```
my-app/
├── src/
│   └── server.ts      # ServiceWorker entry point
├── public/            # Static files (optional)
├── shovel.json        # Configuration (optional)
└── package.json
```

---

## Configuration

Create `shovel.json` for custom settings:

```json
{
  "port": 3000,
  "host": "localhost"
}
```

Shovel works with zero configuration. All settings are optional.

See [shovel.json](./shovel-json.md) for the full configuration reference.

---

## Handling Requests

Use the `fetch` event to handle incoming requests:

```typescript
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (url.pathname === "/") {
    event.respondWith(new Response("Home"));
  } else if (url.pathname === "/api/health") {
    event.respondWith(Response.json({ ok: true }));
  } else {
    event.respondWith(new Response("Not Found", { status: 404 }));
  }
});
```

### Using a Router

For more complex routing, use `@b9g/router`:

```typescript
import { Router } from "@b9g/router";

const router = new Router();

router.route("/").get(() => new Response("Home"));

router.route("/api/users").get(async () => {
  const users = await getUsers();
  return Response.json(users);
});

router.route("/api/users/:id").get((request, context) => {
  return Response.json({ id: context.params.id });
});

self.addEventListener("fetch", (event) => {
  event.respondWith(router.handle(event.request));
});
```

See [Routing](./routing.md) for more details.

---

## Lifecycle Events

### Install

Runs once when the worker starts:

```typescript
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      console.log("Installing...");
      // Pre-cache assets, initialize state
    })()
  );
});
```

### Activate

Runs after install completes:

```typescript
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Run database migrations
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

See [ServiceWorker](./serviceworker.md) for the full lifecycle reference.

---

## Using Databases

Configure a database in `shovel.json`:

```json
{
  "databases": {
    "main": {
      "module": "@b9g/zen/bun",
      "url": "sqlite://./data.db"
    }
  }
}
```

Use it in your code:

```typescript
self.addEventListener("activate", (event) => {
  event.waitUntil(
    databases.open("main", 1, (e) => {
      e.waitUntil(
        e.db.exec`
          CREATE TABLE IF NOT EXISTS posts (
            id INTEGER PRIMARY KEY,
            title TEXT NOT NULL,
            body TEXT NOT NULL
          )
        `
      );
    })
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (url.pathname === "/api/posts") {
    event.respondWith(
      (async () => {
        const db = databases.get("main");
        const posts = await db.all`SELECT * FROM posts`;
        return Response.json(posts);
      })()
    );
  }
});
```

See [Databases](./databases.md) for more details.

---

## Static Files

Place static files in a `public/` directory:

```
my-app/
├── public/
│   ├── styles.css
│   ├── app.js
│   └── images/
│       └── logo.png
├── src/
│   └── server.ts
```

Serve them using the directories API:

```typescript
self.addEventListener("fetch", (event) => {
  event.respondWith(
    (async () => {
      const url = new URL(event.request.url);

      // Try to serve static file
      try {
        const publicDir = await directories.open("public");
        const path = url.pathname.slice(1) || "index.html";
        const file = await publicDir.getFileHandle(path);
        const blob = await file.getFile();
        return new Response(blob, {
          headers: { "Content-Type": blob.type },
        });
      } catch {
        return new Response("Not Found", { status: 404 });
      }
    })()
  );
});
```

See [Directories](./directories.md) for more details.

---

## Caching

Use the Cache API for response caching:

```typescript
self.addEventListener("fetch", (event) => {
  event.respondWith(
    (async () => {
      const cache = await caches.open("api");

      // Check cache first
      const cached = await cache.match(event.request);
      if (cached) {
        return cached;
      }

      // Fetch and cache
      const response = await handleRequest(event.request);
      if (response.ok) {
        await cache.put(event.request, response.clone());
      }

      return response;
    })()
  );
});
```

See [Caches](./caches.md) for more details.

---

## Building for Production

Build your application:

```bash
npx shovel build src/server.ts
```

This creates a `dist/` directory:

```
dist/
├── server/
│   ├── worker.js      # Your bundled app
│   ├── server.js      # Server entry
│   └── package.json
└── public/            # Static assets
```

Run the production build:

```bash
cd dist/server
node server.js
# or
bun server.js
```

See [CLI](./cli.md) for all commands.

---

## Environment Variables

Use environment variables in `shovel.json`:

```json
{
  "port": "$PORT || 3000",
  "databases": {
    "main": {
      "module": "@b9g/zen/postgres",
      "url": "$DATABASE_URL"
    }
  }
}
```

If an expression evaluates to undefined without a fallback, Shovel throws an error:

```json
{
  "databases": {
    "main": {
      "url": "$DATABASE_URL"
    }
  }
}
```

```
Error: Config expression "$DATABASE_URL" evaluated to undefined.
Add a fallback: $DATABASE_URL || defaultValue
```

---

## Next Steps

- [CLI](./cli.md) - Command reference
- [Routing](./routing.md) - URL routing and handlers
- [Middleware](./middleware.md) - Request/response processing
- [ServiceWorker](./serviceworker.md) - Lifecycle events
- [shovel.json](./shovel-json.md) - Configuration reference
- [Deployment](./deployment.md) - Production deployment
