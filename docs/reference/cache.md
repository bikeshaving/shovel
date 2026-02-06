# Caches

Shovel implements the standard [Cache API](https://developer.mozilla.org/en-US/docs/Web/API/Cache) for storing Request/Response pairs.

---

## CacheStorage

Global `self.caches` implements [CacheStorage](https://developer.mozilla.org/en-US/docs/Web/API/CacheStorage).

### open(name: string): Promise\<Cache\>

Opens a named cache, creating it if it doesn't exist.

```typescript
const cache = await self.caches.open("pages");
```

### match(request: Request | string, options?: CacheQueryOptions): Promise\<Response | undefined\>

Searches all caches for a matching response.

```typescript
const response = await self.caches.match(request);
```

### has(name: string): Promise\<boolean\>

Returns whether a named cache exists.

```typescript
const exists = await self.caches.has("pages");
```

### delete(name: string): Promise\<boolean\>

Deletes a named cache. Returns `true` if the cache existed.

```typescript
await self.caches.delete("old-cache");
```

### keys(): Promise\<string[]\>

Returns all cache names.

```typescript
const names = await self.caches.keys();
```

---

## Cache

Each cache implements the [Cache](https://developer.mozilla.org/en-US/docs/Web/API/Cache) interface.

### put(request: Request | string, response: Response): Promise\<void\>

Stores a request/response pair.

```typescript
await cache.put(request, response.clone());
```

### match(request: Request | string, options?: CacheQueryOptions): Promise\<Response | undefined\>

Retrieves a cached response.

```typescript
const response = await cache.match(request);
```

### matchAll(request?: Request | string, options?: CacheQueryOptions): Promise\<Response[]\>

Retrieves all matching responses.

```typescript
const responses = await cache.matchAll("/api/");
```

### add(request: Request | string): Promise\<void\>

Fetches a URL and caches the response.

```typescript
await cache.add("/styles.css");
```

### addAll(requests: (Request | string)[]): Promise\<void\>

Fetches multiple URLs and caches all responses.

```typescript
await cache.addAll(["/", "/styles.css", "/app.js"]);
```

### delete(request: Request | string, options?: CacheQueryOptions): Promise\<boolean\>

Removes a cached entry. Returns `true` if the entry existed.

```typescript
await cache.delete("/old-page");
```

### keys(request?: Request | string, options?: CacheQueryOptions): Promise\<Request[]\>

Lists cached requests.

```typescript
const requests = await cache.keys();
```

---

## CacheQueryOptions

| Option | Type | Description |
|--------|------|-------------|
| `ignoreSearch` | `boolean` | Ignore URL query string |
| `ignoreMethod` | `boolean` | Ignore request method |
| `ignoreVary` | `boolean` | Ignore Vary header |

---

## Configuration

Configure caches in `shovel.json`:

```json
{
  "caches": {
    "pages": {
      "module": "@b9g/cache/memory"
    }
  }
}
```

Use `"*"` for a catch-all default:

```json
{
  "caches": {
    "*": { "module": "@b9g/cache/memory" }
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

---

## Implementations

| Module | Description |
|--------|-------------|
| `@b9g/cache/memory` | In-memory storage (lost on restart) |
| `@b9g/cache-redis` | Redis-backed persistent cache |

---

## See Also

- [shovel.json](./shovel-json.md) - Configuration reference
- [FileSystem](./filesystem.md) - File storage
- [ZenDB](./zen.md) - SQL database storage
