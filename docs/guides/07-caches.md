---
title: Caching
description: Cache responses for better performance.
---

Shovel provides the standard Cache API for storing request/response pairs.

## Basic Usage

```typescript
const cache = await self.caches.open("pages");

// Store a response
await cache.put(request, response.clone());

// Retrieve from cache
const cached = await cache.match(request);
```

## Cache-First Strategy

Serve from cache, fall back to network:

```typescript
const cacheMiddleware = async function* (request) {
  const cache = await self.caches.open("pages");

  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }

  const response = yield request;

  if (response.ok) {
    await cache.put(request, response.clone());
  }

  return response;
};

router.use(cacheMiddleware);
```

## Configuration

Configure caches in `shovel.json`:

```json
{
  "caches": {
    "pages": {
      "module": "@b9g/cache/memory",
      "maxEntries": 1000
    }
  }
}
```

## Production with Redis

Use Redis for persistent caching:

```json
{
  "caches": {
    "sessions": {
      "module": "@b9g/cache-redis",
      "url": "$REDIS_URL"
    }
  }
}
```

## Stale-While-Revalidate

Serve stale content while updating in background:

```typescript
const cached = await cache.match(request);

const networkPromise = fetch(request).then((response) => {
  cache.put(request, response.clone());
  return response;
});

return cached || networkPromise;
```

## Next Steps

- See [Caches Reference](/api/cache) for all strategies
- Learn about [Databases](/api/zen) for persistent storage
