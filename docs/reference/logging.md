# Logging

Shovel provides structured logging via [LogTape](https://logtape.org/). Loggers are available globally via `loggers` in your ServiceWorker code.

## Quick Start

```typescript
// Get a logger by category
const logger = loggers.get(["app", "api"]);

// Log at different levels
logger.debug("Processing request", { url: request.url });
logger.info("Request completed");
logger.warning("Rate limit approaching", { remaining: 10 });
logger.error("Request failed", { error: err.message });
```

---

## Configuration

Configure logging in `shovel.json`:

```json
{
  "logging": {
    "sinks": {
      "console": {
        "module": "@logtape/logtape",
        "export": "getConsoleSink"
      }
    },
    "loggers": [
      {
        "category": "app",
        "level": "info",
        "sinks": ["console"]
      }
    ]
  }
}
```

### Sinks

Sinks define where logs are written:

```json
{
  "logging": {
    "sinks": {
      "console": {
        "module": "@logtape/logtape",
        "export": "getConsoleSink"
      },
      "file": {
        "module": "@logtape/file",
        "export": "getFileSink",
        "path": "./logs/app.log"
      },
      "rotating": {
        "module": "@logtape/file",
        "export": "getRotatingFileSink",
        "path": "./logs/app.log",
        "maxSize": 10485760,
        "maxFiles": 5
      }
    }
  }
}
```

#### Available Sinks

| Module | Export | Description |
|--------|--------|-------------|
| `@logtape/logtape` | `getConsoleSink` | Console output |
| `@logtape/file` | `getFileSink` | File output |
| `@logtape/file` | `getRotatingFileSink` | Rotating file output |
| `@logtape/otel` | `getOpenTelemetrySink` | OpenTelemetry export |

### Loggers

Loggers route messages from categories to sinks:

```json
{
  "logging": {
    "loggers": [
      {
        "category": "app",
        "level": "info",
        "sinks": ["console"]
      },
      {
        "category": ["app", "database"],
        "level": "debug",
        "sinks": ["file"]
      }
    ]
  }
}
```

#### Logger Fields

| Field | Type | Description |
|-------|------|-------------|
| `category` | `string \| string[]` | Logger category or path |
| `level` | `string` | Minimum log level |
| `sinks` | `string[]` | Sink names to output to |
| `parentSinks` | `"override"` | Don't inherit parent sinks |

#### Log Levels

| Level | Description |
|-------|-------------|
| `debug` | Detailed debugging information |
| `info` | General informational messages |
| `warning` | Warning conditions |
| `error` | Error conditions |

---

## Logger API

### loggers.get(categories)

Gets a logger for the given category path.

```typescript
const logger = loggers.get(["app"]);
const dbLogger = loggers.get(["app", "database"]);
const apiLogger = loggers.get(["app", "api", "v2"]);
```

### logger.debug(message, data?)

Logs a debug message.

```typescript
logger.debug("Processing request", {
  url: request.url,
  method: request.method
});
```

### logger.info(message, data?)

Logs an informational message.

```typescript
logger.info("Server started", { port: 3000 });
```

### logger.warning(message, data?)

Logs a warning message.

```typescript
logger.warning("Cache miss rate high", { rate: 0.8 });
```

### logger.error(message, data?)

Logs an error message.

```typescript
logger.error("Database connection failed", {
  error: err.message,
  stack: err.stack
});
```

---

## Structured Data

Pass structured data as the second argument:

```typescript
logger.info("User action", {
  userId: 123,
  action: "login",
  ip: request.headers.get("x-forwarded-for"),
  userAgent: request.headers.get("user-agent"),
});
```

Output (with console sink):
```
2024-01-15T10:30:00.000Z [INFO] app: User action userId=123 action=login ip=1.2.3.4
```

---

## Template Literals

Use tagged template syntax for message formatting:

```typescript
const userId = 123;
const action = "login";

logger.info`User ${userId} performed ${action}`;
```

---

## Common Patterns

### Request Logging

```typescript
const logger = loggers.get(["app", "http"]);

addEventListener("fetch", (event) => {
  event.respondWith(
    (async () => {
      const start = Date.now();
      const { request } = event;

      logger.info("Request started", {
        method: request.method,
        url: request.url,
      });

      try {
        const response = await handleRequest(request);

        logger.info("Request completed", {
          method: request.method,
          url: request.url,
          status: response.status,
          duration: Date.now() - start,
        });

        return response;
      } catch (error) {
        logger.error("Request failed", {
          method: request.method,
          url: request.url,
          error: error.message,
          duration: Date.now() - start,
        });

        return new Response("Internal Error", { status: 500 });
      }
    })()
  );
});
```

### Database Query Logging

```typescript
const logger = loggers.get(["app", "database"]);

async function queryUsers(filter: string) {
  logger.debug("Executing query", { table: "users", filter });

  const start = Date.now();
  const results = await db.all`SELECT * FROM users WHERE name LIKE ${filter}`;

  logger.debug("Query completed", {
    table: "users",
    rows: results.length,
    duration: Date.now() - start,
  });

  return results;
}
```

### Error Logging with Context

```typescript
const logger = loggers.get(["app", "api"]);

async function handleApiRequest(request: Request) {
  const requestId = crypto.randomUUID();

  try {
    // ... handle request
  } catch (error) {
    logger.error("API error", {
      requestId,
      method: request.method,
      path: new URL(request.url).pathname,
      error: error.message,
      stack: error.stack,
    });

    return Response.json(
      { error: "Internal Error", requestId },
      { status: 500 }
    );
  }
}
```

### Conditional Debug Logging

```typescript
const logger = loggers.get(["app", "cache"]);

async function getCached(key: string) {
  const cached = await cache.match(key);

  if (cached) {
    logger.debug("Cache hit", { key });
    return cached;
  }

  logger.debug("Cache miss", { key });
  return null;
}
```

---

## Category Hierarchy

Categories form a hierarchy. Child loggers inherit parent configuration:

```json
{
  "logging": {
    "loggers": [
      {
        "category": "app",
        "level": "info",
        "sinks": ["console"]
      },
      {
        "category": ["app", "database"],
        "level": "debug",
        "sinks": ["file"]
      }
    ]
  }
}
```

With this configuration:

| Logger | Level | Sinks |
|--------|-------|-------|
| `["app"]` | info | console |
| `["app", "api"]` | info | console (inherited) |
| `["app", "database"]` | debug | console, file |
| `["app", "database", "queries"]` | debug | console, file (inherited) |

### Override Parent Sinks

Use `parentSinks: "override"` to prevent sink inheritance:

```json
{
  "logging": {
    "loggers": [
      {
        "category": "app",
        "sinks": ["console"]
      },
      {
        "category": ["app", "audit"],
        "sinks": ["file"],
        "parentSinks": "override"
      }
    ]
  }
}
```

Now `["app", "audit"]` only writes to `file`, not `console`.

---

## Production Configuration

### Environment-Based Levels

```json
{
  "logging": {
    "sinks": {
      "console": {
        "module": "@logtape/logtape",
        "export": "getConsoleSink"
      }
    },
    "loggers": [
      {
        "category": "app",
        "level": "$NODE_ENV === production ? warning : debug",
        "sinks": ["console"]
      }
    ]
  }
}
```

### File Logging with Rotation

```json
{
  "logging": {
    "sinks": {
      "app": {
        "module": "@logtape/file",
        "export": "getRotatingFileSink",
        "path": "./logs/app.log",
        "maxSize": 10485760,
        "maxFiles": 10
      },
      "error": {
        "module": "@logtape/file",
        "export": "getFileSink",
        "path": "./logs/error.log"
      }
    },
    "loggers": [
      {
        "category": "app",
        "level": "info",
        "sinks": ["app"]
      },
      {
        "category": "app",
        "level": "error",
        "sinks": ["error"]
      }
    ]
  }
}
```

### OpenTelemetry Export

```json
{
  "logging": {
    "sinks": {
      "otel": {
        "module": "@logtape/otel",
        "export": "getOpenTelemetrySink"
      }
    },
    "loggers": [
      {
        "category": "app",
        "level": "info",
        "sinks": ["otel"]
      }
    ]
  }
}
```

---

## Shovel Internal Logging

Shovel uses the `shovel` category for internal logs:

| Category | Description |
|----------|-------------|
| `shovel` | General Shovel logs |
| `shovel.platform` | Platform runtime logs |
| `shovel.build` | Build process logs |

To see Shovel debug logs:

```json
{
  "logging": {
    "loggers": [
      {
        "category": "shovel",
        "level": "debug",
        "sinks": ["console"]
      }
    ]
  }
}
```

---

## See Also

- [shovel.json](./shovel-json.md) - Full configuration reference
- [LogTape Documentation](https://logtape.org/) - Underlying logging library
- [Caches](./caches.md) - Request/Response caching
- [Directories](./directories.md) - File system storage
- [Databases](./databases.md) - SQL database storage
