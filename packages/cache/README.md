# @b9g/cache

**Universal Cache API for ServiceWorker applications. Provides standard CacheStorage and Cache interfaces across all JavaScript runtimes.**

## Features

- **ServiceWorker Cache API**: Standard `Cache` and `CacheStorage` interfaces from ServiceWorker spec
- **Multiple Backends**: Memory cache with LRU eviction, PostMessage coordination for workers
- **Universal**: Same API works in browsers, Node.js, Bun, and edge platforms
- **Request/Response Caching**: Full HTTP semantics with Request/Response objects
- **Factory Pattern**: Flexible cache creation with factory functions

## Installation

```bash
npm install @b9g/cache
```

## Quick Start

### Using with Shovel (Recommended)

Configure cache providers in via the `shovel` key in package.json or `shovel.json`:

```json
{
  "caches": {
    "pages": {"provider": "memory"},
    "api": {"provider": "memory", "maxEntries": 5000}
  }
}
```

Shovel provides `self.caches` as a global following the ServiceWorker CacheStorage API. Access it directly in your handlers and middleware:

```typescript
import {Router} from '@b9g/router';

const router = new Router();

// Cache middleware using generator API
router.use(async function* (request, _context) {
  if (request.method !== 'GET' || !self.caches) {
    return yield request; // Skip caching
  }

  // Open cache
  const cache = await self.caches.open('pages-v1');

  // Check cache
  const cached = await cache.match(request);
  if (cached) {
    return cached; // Cache hit
  }

  // Cache miss - get response from handler
  const response = yield request;

  // Store in cache
  if (response.ok) {
    await cache.put(request, response.clone());
  }

  return response;
});

router.route('/posts/:id')
  .get(async (request, context) => {
    const post = await getPost(context.params.id);
    return Response.json(post, {
      headers: {'Cache-Control': 'max-age=300'},
    });
  });
```

### Standalone Usage

```javascript
import {CustomCacheStorage} from '@b9g/cache';
import {MemoryCache} from '@b9g/cache/memory';

// Create cache storage with factory
const caches = new CustomCacheStorage((name) => {
  return new MemoryCache(name, {maxEntries: 1000});
});

// Open and use caches
const apiCache = await caches.open('api');

// Store response
const request = new Request('https://api.example.com/posts/1');
const response = new Response(JSON.stringify({id: 1, title: 'Hello'}), {
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'max-age=300',
  }
});
await apiCache.put(request, response);

// Retrieve response
const cached = await apiCache.match(request);
console.log(await cached.json()); // {id: 1, title: 'Hello'}
```

## Cache Providers

Shovel supports multiple cache providers that can be configured in `shovel.json`:

### Built-in Providers

- **`memory`** - In-memory cache with LRU eviction (default)
- **`redis`** - Redis-backed cache (requires `@b9g/cache-redis`)
- **`cloudflare`** - Uses Cloudflare Workers native Cache API (only works with the Cloudflare platform)

You can also use custom providers by specifying a module path:

```json
{
  "caches": {
    "pages": {"provider": "memory"},
    "sessions": {"provider": "redis", "url": "REDIS_URL"},
    "custom": {"provider": "./my-cache-provider.js"}
  }
}
```

Pattern matching is supported for cache names:

```json
{
  "caches": {
    "api-*": {"provider": "memory", "maxEntries": 5000},
    "page-*": {"provider": "memory", "maxEntries": 100}
  }
}
```

## Cache Implementations

### MemoryCache

In-memory cache with LRU eviction and HTTP Cache-Control header support:

```javascript
import {MemoryCache} from '@b9g/cache/memory';

const cache = new MemoryCache(name, {
  maxEntries: 1000,  // Maximum number of entries (LRU eviction)
});

// Cache respects Cache-Control headers
await cache.put(request, new Response(data, {
  headers: {'Cache-Control': 'max-age=300'},
}));

// After 300 seconds, match() returns undefined
```

### PostMessageCache

Worker-side cache that coordinates with main thread via PostMessage:

```javascript
import {PostMessageCache} from '@b9g/cache/postmessage';

// In worker thread - forwards operations to main thread
const cache = new PostMessageCache({
  name: 'shared',
  timeout: 30000, // Optional, defaults to 30000ms
});

// Operations are synchronized with main thread's MemoryCache
await cache.put(request, response);
```

## CustomCacheStorage

Create cache storage with a factory function:

```javascript
import {CustomCacheStorage} from '@b9g/cache';
import {MemoryCache} from '@b9g/cache/memory';

const caches = new CustomCacheStorage((name) => {
  // Different caches can have different configurations
  if (name === 'api') {
    return new MemoryCache(name, {maxEntries: 5000});
  }
  if (name === 'pages') {
    return new MemoryCache(name, {maxEntries: 100});
  }
  return new MemoryCache();
});
```

## Exports

### Main (`@b9g/cache`)

- `Cache` - Abstract base class implementing `globalThis.Cache`
- `CustomCacheStorage` - CacheStorage implementation with factory pattern
- `generateCacheKey(request, options?)` - Generate cache key from Request
- `toRequest(request)` - Convert RequestInfo or URL to Request
- `CacheQueryOptions` - Type for cache query options

### Memory (`@b9g/cache/memory`)

- `MemoryCache` - In-memory cache with LRU and Cache-Control support
- `MemoryCacheOptions` - Configuration type

### PostMessage (`@b9g/cache/postmessage`)

- `PostMessageCache` - Worker-side cache with main thread coordination
- `PostMessageCacheOptions` - Configuration type
- `handleCacheResponse(message)` - Message handler for worker coordination

## API Reference

### Standard Cache Methods

All cache implementations provide the standard Cache API:

```javascript
// Check for cached response
const response = await cache.match(request, options?);

// Get all matching responses
const responses = await cache.matchAll(request?, options?);

// Store request/response pair
await cache.put(request, response);

// Fetch and store
await cache.add(request);
await cache.addAll(requests);

// Remove cached entry
const deleted = await cache.delete(request, options?);

// List cached requests
const requests = await cache.keys(request?, options?);
```

### CacheStorage Methods

```javascript
// Open named cache (creates if doesn't exist)
const cache = await caches.open(name);

// Check if cache exists
const exists = await caches.has(name);

// Delete named cache
const deleted = await caches.delete(name);

// List cache names
const names = await caches.keys();

// Match across all caches
const response = await caches.match(request, options?);

// Cleanup (disposes all caches)
await caches.dispose();
```

## Cache Options

### Query Options

```javascript
const response = await cache.match(request, {
  ignoreSearch: true,     // Ignore query parameters in URL
  ignoreMethod: false,    // Consider HTTP method
  ignoreVary: false,      // Honor Vary header (default behavior)
});
```

**Vary Header Support:**

The cache respects the HTTP `Vary` header by default:

```javascript
// Cache a response that varies on Accept-Encoding
await cache.put(
  new Request('https://api.example.com/data', {
    headers: {'Accept-Encoding': 'gzip'},
  }),
  new Response(gzippedData, {
    headers: {'Vary': 'Accept-Encoding'},
  })
);

// Same URL with same Accept-Encoding: matches
await cache.match(new Request('https://api.example.com/data', {
  headers: {'Accept-Encoding': 'gzip'},
})); // ✓ Returns cached response

// Same URL with different Accept-Encoding: no match
await cache.match(new Request('https://api.example.com/data', {
  headers: {'Accept-Encoding': 'br'},
})); // ✗ Returns undefined

// Use ignoreVary to bypass Vary header checking
await cache.match(new Request('https://api.example.com/data', {
  headers: {'Accept-Encoding': 'br'},
}), {ignoreVary: true}); // ✓ Returns cached response
```

Special cases:
- `Vary: *` means the response varies on everything and will never match (unless `ignoreVary: true`)
- Multiple headers: `Vary: Accept-Encoding, User-Agent` requires all specified headers to match

### MemoryCache Options

```javascript
new MemoryCache(name, {
  maxEntries: 1000  // Maximum entries (LRU eviction when exceeded)
});
```

## Integration Examples

### With Router

```javascript
import {Router} from '@b9g/router';
import {CustomCacheStorage} from '@b9g/cache';
import {MemoryCache} from '@b9g/cache/memory';

const caches = new CustomCacheStorage((name) =>
  new MemoryCache(name, {maxEntries: 1000})
);

const router = new Router();

// Cache-aware middleware
router.use(async function* (request, _context) {
  if (request.method !== 'GET') {
    return yield request;
  }

  const cache = await caches.open('api');
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = yield request;

  if (response.ok) {
    await cache.put(request, response.clone());
  }

  return response;
});

router.route('/api/posts/:id')
  .get(postHandler);
```

### Multi-Worker Setup

```javascript
// Main thread
import {CustomCacheStorage} from '@b9g/cache';
import {MemoryCache} from '@b9g/cache/memory';

const caches = new CustomCacheStorage((name) =>
  new MemoryCache()
);

worker.on('message', (message) => {
  if (message.type?.startsWith('cache:')) {
    caches.handleMessage(worker, message);
  }
});

// Worker thread
import {PostMessageCache} from '@b9g/cache/postmessage';
import {handleCacheResponse} from '@b9g/cache/postmessage';

const cache = new PostMessageCache('shared');

self.addEventListener('message', (event) => {
  if (event.data.type === 'cache:response' || event.data.type === 'cache:error') {
    handleCacheResponse(event.data);
  }
});

// Operations coordinate with main thread
await cache.put(request, response);
```

### HTTP Caching Semantics

```javascript
import {MemoryCache} from '@b9g/cache/memory';

const cache = new MemoryCache();

// Respect Cache-Control headers
const response = new Response(data, {
  headers: {
    'Cache-Control': 'max-age=3600',  // Cache for 1 hour
    'Vary': 'Accept-Encoding',
  }
});

await cache.put(request, response);

// After 3600 seconds, entry expires automatically
const cached = await cache.match(request); // undefined after expiry
```

## License

MIT
