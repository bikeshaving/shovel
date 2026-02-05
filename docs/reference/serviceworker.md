# ServiceWorker

[ServiceWorker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API) for request handling.

---

## Lifecycle

```
parsing → installing → installed → activating → activated
```

---

## Events

### fetch

Fires for incoming requests.

```typescript
self.addEventListener("fetch", (event) => {
  event.respondWith(new Response("Hello"));
});
```

### install

Fires once during worker registration.

```typescript
self.addEventListener("install", (event) => {
  event.waitUntil(initializeApp());
});
```

### activate

Fires after successful installation.

```typescript
self.addEventListener("activate", (event) => {
  event.waitUntil(runMigrations());
});
```

---

## FetchEvent

| Property | Type | Description |
|----------|------|-------------|
| `request` | `Request` | Incoming request |
| `clientId` | `string` | Client identifier |

### respondWith(response: Response | Promise\<Response\>): void

Sets the response.

```typescript
event.respondWith(new Response("OK"));
event.respondWith(fetchFromAPI(request));
```

### waitUntil(promise: Promise\<any\>): void

Extends event lifetime for background work.

```typescript
event.respondWith(new Response("OK"));
event.waitUntil(logRequest(request)); // Doesn't block response
```

---

## ExtendableEvent

Base interface for lifecycle events.

### waitUntil(promise: Promise\<any\>): void

Delays event completion until promise resolves.

```typescript
self.addEventListener("install", (event) => {
  event.waitUntil(cacheAssets());
  event.waitUntil(validateConfig()); // Multiple calls OK
});
```

---

## Globals

| Global | Type | Description |
|--------|------|-------------|
| `self` | `ServiceWorkerGlobalScope` | Global scope |
| `caches` | `CacheStorage` | [Cache API](./cache.md) |
| `databases` | `DatabaseStorage` | [ZenDB](./zen.md) |
| `directories` | `DirectoryStorage` | [FileSystem](./filesystem.md) |
| `loggers` | `LoggerStorage` | [Logging](./logging.md) |
| `cookieStore` | `CookieStore` | [Cookies](./cookies.md) |
| `crypto` | `Crypto` | Web Crypto API |
| `fetch` | `function` | Fetch API |

---

## fetch() During Lifecycle

Relative URLs route through your own fetch handler:

```typescript
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const response = await fetch("/404.html");
      const html = await response.text();
      // Write to static output
    })()
  );
});
```

---

## Differences from Browser

| Feature | Browser | Shovel |
|---------|---------|--------|
| Runs in | Browser | Server |
| Registration | JavaScript API | Automatic |
| Updates | navigator.serviceWorker | App restart |

### Supported

- Fetch event handling
- Install/activate lifecycle
- Cache API, CookieStore, Crypto

### Server-Only

- `databases` - SQL databases
- `directories` - File system
- `loggers` - Structured logging

---

## See Also

- [Router](./router.md) - Route definition
- [Middleware](./middleware.md) - Request processing

