# @logtape/logtape

Structured logging via [LogTape](https://logtape.org/).

---

## LoggerStorage

Global `self.loggers` provides access to loggers.

### get(categories: string[]): Logger

Gets a logger for the given category path.

```typescript
const logger = self.loggers.get(["app"]);
const dbLogger = self.loggers.get(["app", "database"]);
```

---

## Logger

### debug(message: string, data?: Record\<string, unknown\>): void

Logs a debug message.

```typescript
logger.debug("Processing request", { url: request.url });
```

### info(message: string, data?: Record\<string, unknown\>): void

Logs an informational message.

```typescript
logger.info("Server started", { port: 7777 });
```

### warning(message: string, data?: Record\<string, unknown\>): void

Logs a warning message.

```typescript
logger.warning("Cache miss rate high", { rate: 0.8 });
```

### error(message: string, data?: Record\<string, unknown\>): void

Logs an error message.

```typescript
logger.error("Database connection failed", { error: err.message });
```

### Template Literal Syntax

```typescript
logger.info`User ${userId} performed ${action}`;
```

---

## Configuration

Configure in `shovel.json`:

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

### Sink Fields

| Field | Type | Description |
|-------|------|-------------|
| `module` | `string` | Module path |
| `export` | `string` | Named export |
| Additional fields passed to sink constructor |

### Logger Fields

| Field | Type | Description |
|-------|------|-------------|
| `category` | `string \| string[]` | Logger category path |
| `level` | `string` | Minimum log level |
| `sinks` | `string[]` | Sink names to output to |
| `parentSinks` | `"override"` | Don't inherit parent sinks |

### Log Levels

| Level | Description |
|-------|-------------|
| `debug` | Detailed debugging |
| `info` | General information |
| `warning` | Warning conditions |
| `error` | Error conditions |

---

## Sinks

| Module | Export | Description |
|--------|--------|-------------|
| `@logtape/logtape` | `getConsoleSink` | Console output |
| `@logtape/file` | `getFileSink` | File output |
| `@logtape/file` | `getRotatingFileSink` | Rotating file |
| `@logtape/otel` | `getOpenTelemetrySink` | OpenTelemetry |

### File Sink

```json
{
  "logging": {
    "sinks": {
      "file": {
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

---

## Category Hierarchy

Categories form a hierarchy. Child loggers inherit parent configuration.

```json
{
  "logging": {
    "loggers": [
      { "category": "app", "level": "info", "sinks": ["console"] },
      { "category": ["app", "database"], "level": "debug", "sinks": ["file"] }
    ]
  }
}
```

| Logger | Level | Sinks |
|--------|-------|-------|
| `["app"]` | info | console |
| `["app", "api"]` | info | console (inherited) |
| `["app", "database"]` | debug | console, file |

Use `parentSinks: "override"` to prevent inheritance.

---

## Shovel Internal Loggers

| Category | Description |
|----------|-------------|
| `shovel` | General Shovel logs |
| `shovel.platform` | Runtime logs |
| `shovel.build` | Build process |

---

## See Also

- [shovel.json](./shovel-json.md) - Configuration reference
- [LogTape Documentation](https://logtape.org/) - Full LogTape API

