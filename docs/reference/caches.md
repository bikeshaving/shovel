# Caches

Shovel provides the standard [Cache API](https://developer.mozilla.org/en-US/docs/Web/API/Cache) for storing Request/Response pairs. Caches are available globally via `self.caches` in your ServiceWorker code.

## Quick Start

```typescript
// Open a named cache
const cache = await self.caches.open("pages-v1");

// Store a response
await cache.put(request, response);

// Retrieve a cached response
const cached = await cache.match(request);
```

---

## Configuration

Configure caches in `shovel.json`:

```json
{
  "caches": {
    "pages": {
      "module": "@b9g/cache/memory"
    },
    "api": {
      "module": "@b9g/cache/memory",
      "maxEntries": 1000
    }
  }
}
```

### Catch-All Pattern

Use `"*"` to configure a default for any cache name:

```json
{
  "caches": {
    "*": {
      "module": "@b9g/cache/memory"
    }
  }
}
```

### Environment-Based Configuration

```json
{
  "caches": {
    "sessions": {
      "module": "$NODE_ENV === production ? @b9g/cache/redis : @b9g/cache/memory",
      "url": "$REDIS_URL || redis://localhost:6379"
    }
  }
}
```

### Configuration Fields

| Field | Type | Description |
|-------|------|-------------|
| `module` | `string` | Module path to import |
| `export` | `string` | Named export (default: `"default"`) |
| `maxEntries` | `number` | Maximum cache entries |
| `ttl` | `number` | Time-to-live in seconds |

Additional fields are passed to the cache factory function.

---

## CacheStorage API

The global `self.caches` object implements [CacheStorage](https://developer.mozilla.org/en-US/docs/Web/API/CacheStorage):

### self.caches.open(name)

Opens a named cache, creating it if it doesn't exist.

```typescript
const cache = await self.caches.open("my-cache");
```

### caches.match(request, options?)

Searches all caches for a matching response.

```typescript
const response = await caches.match(request);
if (response) {
  return response;
}
```

### caches.has(name)

Checks if a named cache exists.

```typescript
if (await caches.has("pages-v1")) {
  // Cache exists
}
```

### caches.delete(name)

Deletes a named cache.

```typescript
await caches.delete("old-cache");
```

### caches.keys()

Lists all cache names.

```typescript
const names = await caches.keys();
// ["pages-v1", "api-v2"]
```

---

## Cache API

Each cache implements the [Cache](https://developer.mozilla.org/en-US/docs/Web/API/Cache) interface:

### cache.put(request, response)

Stores a request/response pair.

```typescript
const cache = await self.caches.open("pages");
await cache.put(request, response.clone());
```

**Important:** Clone the response if you need to use it elsewhere, as Response bodies can only be read once.

### cache.match(request, options?)

Retrieves a cached response.

```typescript
const response = await cache.match(request);
if (response) {
  return response;
}
// Cache miss - fetch from network
return fetch(request);
```

#### Options

| Option | Type | Description |
|--------|------|-------------|
| `ignoreSearch` | `boolean` | Ignore URL query string |
| `ignoreMethod` | `boolean` | Ignore request method |
| `ignoreVary` | `boolean` | Ignore Vary header |

### cache.matchAll(request?, options?)

Retrieves all matching responses.

```typescript
const responses = await cache.matchAll("/api/");
```

### cache.add(request)

Fetches a URL and caches the response.

```typescript
await cache.add("/styles.css");
```

### cache.addAll(requests)

Fetches multiple URLs and caches all responses.

```typescript
await cache.addAll([
  "/",
  "/styles.css",
  "/app.js",
]);
```

### cache.delete(request, options?)

Removes a cached entry.

```typescript
await cache.delete("/old-page");
```

### cache.keys(request?, options?)

Lists cached requests.

```typescript
const requests = await cache.keys();
for (const request of requests) {
  console.log(request.url);
}
```

---

## Common Patterns

### Cache-First Strategy

Serve from cache, falling back to network:

```typescript
addEventListener("fetch", (event) => {
  event.respondWith(
    (async () => {
      const cache = await self.caches.open("pages");
      const cached = await cache.match(event.request);
      if (cached) {
        return cached;
      }
      const response = await fetch(event.request);
      await cache.put(event.request, response.clone());
      return response;
    })()
  );
});
```

### Network-First Strategy

Try network first, fall back to cache:

```typescript
addEventListener("fetch", (event) => {
  event.respondWith(
    (async () => {
      const cache = await self.caches.open("pages");
      try {
        const response = await fetch(event.request);
        await cache.put(event.request, response.clone());
        return response;
      } catch {
        return cache.match(event.request);
      }
    })()
  );
});
```

### Stale-While-Revalidate

Serve from cache immediately, update in background:

```typescript
addEventListener("fetch", (event) => {
  event.respondWith(
    (async () => {
      const cache = await self.caches.open("pages");
      const cached = await cache.match(event.request);

      const networkPromise = fetch(event.request).then((response) => {
        cache.put(event.request, response.clone());
        return response;
      });

      return cached || networkPromise;
    })()
  );
});
```

### Cache Versioning

Use versioned cache names to invalidate old caches:

```typescript
const CACHE_VERSION = "v2";

addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name !== `pages-${CACHE_VERSION}`)
          .map((name) => caches.delete(name))
      );
    })()
  );
});
```

---

## Available Implementations

### Memory Cache

In-memory storage. Data is lost on restart.

```json
{
  "caches": {
    "sessions": {
      "module": "@b9g/cache/memory",
      "maxEntries": 1000
    }
  }
}
```

### Redis Cache

Persistent distributed cache (requires Redis server).

```json
{
  "caches": {
    "sessions": {
      "module": "@b9g/cache/redis",
      "url": "$REDIS_URL || redis://localhost:6379"
    }
  }
}
```

### Cloudflare Cache

Native Cloudflare Workers cache (Cloudflare platform only).

```json
{
  "caches": {
    "*": {
      "binding": "CACHE"
    }
  }
}
```

---

## TypeScript

Shovel generates type definitions for your configured caches. After running `shovel build`, cache names are type-checked:

```typescript
// OK - configured cache
const pages = await self.caches.open("pages");

// Type error - unconfigured cache
const unknown = await self.caches.open("not-configured");
```

---

## See Also

- [shovel.json](./shovel-json.md) - Full configuration reference
- [Directories](./directories.md) - File system storage
- [Databases](./databases.md) - SQL database storage
