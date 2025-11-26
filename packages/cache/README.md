# @b9g/cache

**Universal Cache API for ServiceWorker applications. Provides standard CacheStorage and Cache interfaces across all JavaScript runtimes.**

## Features

- **ServiceWorker Cache API**: Standard `caches` global and Cache interface from ServiceWorker spec
- **Multiple Backends**: Memory, filesystem, Redis, KV store implementations  
- **Universal**: Same API works in browsers, Node.js, Bun, and edge platforms
- **Request/Response Caching**: Full HTTP semantics with Request/Response objects
- **Registry Pattern**: Named cache management with factory registration

## Installation

```bash
npm install @b9g/cache
```

## Quick Start

```javascript
import { CacheStorage, MemoryCache } from '@b9g/cache';

// Create cache storage
const caches = new CacheStorage();

// Register cache implementations
caches.register('api', () => new MemoryCache('api'));
caches.register('pages', () => new MemoryCache('pages'));

// Open and use caches
const apiCache = await caches.open('api');

// Store response
const request = new Request('https://api.example.com/posts/1');
const response = new Response(JSON.stringify({ id: 1, title: 'Hello' }));
await apiCache.put(request, response);

// Retrieve response
const cached = await apiCache.match(request);
console.log(await cached.json()); // { id: 1, title: 'Hello' }
```

## Cache Implementations

### MemoryCache

In-memory cache with TTL and size limits:

```javascript
import { MemoryCache } from '@b9g/cache';

const cache = new MemoryCache('my-cache', {
  maxEntries: 1000,        // Maximum number of entries
  ttl: 300,               // Time to live in seconds
  maxSize: 50 * 1024 * 1024 // Maximum total size in bytes
});
```

### FilesystemCache

File-based cache for SSG and persistent storage:

```javascript
import { FilesystemCache } from '@b9g/cache';

const cache = new FilesystemCache('pages', {
  directory: './dist/cache',
  compression: true,
  indexing: true
});
```

## CacheStorage Registry

```javascript
import { CacheStorage, MemoryCache, FilesystemCache } from '@b9g/cache';

const caches = new CacheStorage();

// Register different implementations
caches.register('api', () => 
  new MemoryCache('api', { ttl: 300 })
);

caches.register('pages', () =>
  new FilesystemCache('pages', { directory: './dist/pages' })
);

caches.register('assets', () =>
  new MemoryCache('assets', { maxEntries: 10000 })
);

// Use with router
import { Router } from '@b9g/router';
const router = new Router({ caches });
```

## Exports

### Classes

- `Cache` - Abstract base class for cache implementations
- `CustomCacheStorage` - CacheStorage implementation with factory registration

### Functions

- `generateCacheKey(request, options?)` - Generate a cache key from a Request

### Types

- `CacheQueryOptions` - Options for cache query operations (ignoreSearch, ignoreMethod, ignoreVary)
- `CacheFactory` - Factory function type `(name: string) => Cache | Promise<Cache>`

## API Reference

### Standard Cache Methods

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
// Register cache factory
caches.register(name, factory);

// Open named cache
const cache = await caches.open(name);

// Check if cache exists
const exists = await caches.has(name);

// Delete named cache
const deleted = await caches.delete(name);

// List cache names
const names = await caches.keys();
```

## Cache Options

### Query Options

```javascript
const response = await cache.match(request, {
  ignoreSearch: true,     // Ignore query parameters
  ignoreMethod: false,    // Consider HTTP method
  ignoreVary: false,      // Honor Vary header
  cacheName: 'specific'   // Target specific cache
});
```

### Storage Options

```javascript
// Memory cache options
new MemoryCache('name', {
  maxEntries: 1000,
  ttl: 300,
  maxSize: 50 * 1024 * 1024
});

// Filesystem cache options
new FilesystemCache('name', {
  directory: './cache',
  compression: true,
  indexing: true,
  fsync: false
});
```

## Integration Examples

### With Router

```javascript
import { Router } from '@b9g/router';
import { CacheStorage, MemoryCache } from '@b9g/cache';

const caches = new CacheStorage();
caches.register('api', () => new MemoryCache('api'));

const router = new Router({ caches });

// Cache-aware middleware
router.use(async function* (request, context) {
  if (request.method === 'GET' && context.cache) {
    const cached = await context.cache.match(request);
    if (cached) return cached;
  }
  
  const response = yield request;
  
  if (request.method === 'GET' && context.cache && response.ok) {
    await context.cache.put(request, response.clone());
  }
  
  return response;
});

router.route('/api/posts/:id', { cache: { name: 'api' } })
  .get(postHandler);
```

### Static Site Generation

```javascript
import { FilesystemCache } from '@b9g/cache';

const cache = new FilesystemCache('pages', {
  directory: './dist'
});

// Pre-populate cache at build time
const paths = ['/about', '/contact', '/blog/post-1'];

for (const path of paths) {
  const request = new Request(`https://example.com${path}`);
  await cache.add(request); // Fetches through your router
}

// At runtime, serve from cache
const response = await cache.match(request);
```

### Service Worker

```javascript
// In service worker context
import { CacheStorage } from '@b9g/cache';

// Use native browser caches when available
const caches = new CacheStorage();

self.addEventListener('fetch', async event => {
  const cache = await caches.open('runtime');
  
  event.respondWith(
    cache.match(event.request).then(response => {
      if (response) return response;
      
      return fetch(event.request).then(response => {
        if (response.ok) {
          cache.put(event.request, response.clone());
        }
        return response;
      });
    })
  );
});
```

## Cache Coordination

For multi-worker setups, caches coordinate through PostMessage:

```javascript
// Worker thread cache coordination
const cache = new MemoryCache('shared', {
  coordination: {
    type: 'postmessage',
    channel: 'cache-coordination'
  }
});

// Operations are coordinated across workers
await cache.put(request, response); // Synced to all workers
```

## License

MIT