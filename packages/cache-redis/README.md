# @b9g/cache-redis

Redis cache adapter for Shovel's universal cache system.

## Features

- **HTTP-aware caching**: Stores complete HTTP responses with headers and status codes
- **TTL support**: Configurable time-to-live for cache entries
- **Size limits**: Configurable maximum entry size to prevent memory issues
- **Connection pooling**: Uses the official Redis client with connection management
- **Error resilience**: Graceful handling of Redis connection issues

## Installation

```bash
bun install @b9g/cache-redis
```

## Usage

### Basic Usage

```typescript
import {CustomCacheStorage} from "@b9g/cache";
import {createRedisFactory} from "@b9g/cache-redis";

// Create cache storage with Redis backend
const cacheStorage = new CustomCacheStorage(createRedisFactory({
  redis: {
    url: "redis://localhost:6379"
  },
  defaultTTL: 3600, // 1 hour
  prefix: "myapp"
}));

// Use the cache
const cache = await cacheStorage.open("pages");
await cache.put(request, response);
const cached = await cache.match(request);
```

### With Platform Integration

```typescript
import {CustomCacheStorage} from "@b9g/cache";
import {createRedisFactory} from "@b9g/cache-redis";

// In your platform configuration
const platform = createBunPlatform({
  cache: {
    factory: createRedisFactory({
      redis: {
        url: process.env.REDIS_URL || "redis://localhost:6379",
        password: process.env.REDIS_PASSWORD
      },
      defaultTTL: 3600,
      maxEntrySize: 5 * 1024 * 1024 // 5MB max per entry
    })
  }
});
```

## Configuration Options

### RedisCacheOptions

- `redis?: RedisClientOptions` - Redis connection configuration
- `prefix?: string` - Key prefix for Redis keys (default: "cache")
- `defaultTTL?: number` - Default TTL in seconds (0 = no expiration)
- `maxEntrySize?: number` - Maximum cache entry size in bytes (default: 10MB)

### Redis Connection Options

The `redis` option accepts all standard Redis client options:

```typescript
{
  redis: {
    url: "redis://localhost:6379",
    password: "your-password",
    database: 0,
    connectTimeout: 10000,
    lazyConnect: true
  }
}
```

## Environment Variables

Common Redis configuration via environment variables:

- `REDIS_URL` - Complete Redis connection URL
- `REDIS_HOST` - Redis hostname
- `REDIS_PORT` - Redis port
- `REDIS_PASSWORD` - Redis password
- `REDIS_DB` - Redis database number

## Performance Considerations

### Entry Size Limits

Large responses are automatically rejected to prevent memory issues:

```typescript
const cache = new RedisCache("large-files", {
  maxEntrySize: 1024 * 1024 // 1MB limit
});
```

### TTL Configuration

Configure TTL based on your caching strategy:

```typescript
// Short-lived API responses
const apiCache = new RedisCache("api", {
  defaultTTL: 300 // 5 minutes
});

// Long-lived static assets
const staticCache = new RedisCache("static", {
  defaultTTL: 86400 // 24 hours
});

// Permanent cache (manual invalidation)
const permanentCache = new RedisCache("permanent", {
  defaultTTL: 0 // No expiration
});
```

### Connection Pooling

The Redis client automatically manages connection pooling. For high-traffic applications, consider tuning connection settings:

```typescript
{
  redis: {
    socket: {
      connectTimeout: 10000,
      keepAlive: true,
      noDelay: true
    },
    isolationPoolOptions: {
      min: 2,
      max: 10
    }
  }
}
```

## Error Handling

The Redis cache gracefully handles connection issues:

- Failed connections return `undefined` for cache misses
- Connection errors are logged but don't crash the application
- Automatic reconnection when Redis becomes available

## Cache Statistics

Get insights into cache performance:

```typescript
const cache = new RedisCache("my-cache");
const stats = await cache.getStats();

console.log({
  connected: stats.connected,
  keyCount: stats.keyCount,
  totalSize: stats.totalSize,
  prefix: stats.prefix
});
```

## Cleanup

Properly dispose of cache instances:

```typescript
// Dispose single cache
await cache.dispose();

// Dispose entire cache storage
await cacheStorage.dispose();
```

## Shovel Integration

This cache adapter is designed to work seamlessly with Shovel's cache-first architecture:

- **Platform agnostic**: Works with any Shovel platform (Bun, Node.js, Cloudflare)
- **HTTP-aware**: Preserves response headers and status codes
- **ServiceWorker compatible**: Implements the standard Cache API interface

For more information about Shovel's caching system, see the [@b9g/cache](../cache) documentation.