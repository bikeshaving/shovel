# shovel.json

Shovel uses a `shovel.json` file in your project root to configure your ServiceWorker application. This file controls server settings, logging, caching, file storage, databases, and build options.

Alternatively, you can place the configuration in a `"shovel"` field in your `package.json`.

## Overview

A minimal `shovel.json`:

```json
{}
```

Shovel works with zero configuration. All fields are optional with sensible defaults.

A full example:

```json
{
  "platform": "bun",
  "port": 3000,
  "host": "localhost",
  "workers": 4,
  "logging": {
    "sinks": {
      "file": {
        "module": "@logtape/file",
        "export": "getFileSink",
        "path": "./logs/app.log"
      }
    },
    "loggers": [
      { "category": "app", "level": "info", "sinks": ["file"] }
    ]
  },
  "build": {
    "target": "es2022",
    "minify": true,
    "sourcemap": "external"
  },
  "caches": {
    "sessions": {
      "module": "@b9g/cache/memory",
      "export": "MemoryCache",
      "maxEntries": 1000
    }
  },
  "directories": {
    "uploads": {
      "module": "@b9g/filesystem/node-fs",
      "export": "NodeFSDirectory",
      "path": "./uploads"
    }
  },
  "databases": {
    "main": {
      "module": "@b9g/zen/bun",
      "url": "sqlite://./data.db"
    }
  }
}
```

---

## Config Expressions

String values in `shovel.json` support a lightweight expression syntax for environment variables and dynamic paths.

### Environment Variables

Use `$VAR` to reference environment variables:

```json
{
  "port": "$PORT || 3000",
  "host": "$HOST || localhost"
}
```

### Operators

**Important:** All infix operators require spaces on both sides. This allows values like `redis://localhost:6379`, `bun:sqlite`, and `node:fs` to be parsed as single values.

| Operator | Description | Example |
|----------|-------------|---------|
| `\|\|` | Fallback if falsy | `"$PORT \|\| 3000"` |
| `??` | Fallback if null/undefined | `"$PORT ?? 3000"` |
| `&&` | Logical AND | `"$ENABLED && true"` |
| `===`, `!==` | Strict equality | `"$NODE_ENV === production"` |
| `==`, `!=` | Loose equality | `"$DEBUG == true"` |
| `? :` | Ternary | `"$NODE_ENV === production ? redis : memory"` |
| `!` | Logical NOT (prefix) | `"!$DISABLED"` |

```json
// Correct - spaces around operators
{ "url": "$REDIS_URL || redis://localhost:6379" }
{ "driver": "$PLATFORM === bun ? bun:sqlite : better-sqlite3" }

// Incorrect - no spaces
{ "url": "$REDIS_URL||redis://localhost:6379" }  // parsed as single identifier
```

### Path Placeholders

| Placeholder | Description |
|-------------|-------------|
| `[outdir]` | Build output directory |
| `[tmpdir]` | System temp directory |
| `[git]` | Current git commit SHA |

Example:

```json
{
  "directories": {
    "cache": {
      "module": "@b9g/filesystem/node-fs",
      "path": "[tmpdir]/shovel-cache"
    }
  }
}
```

---

## platform

- **Type:** `string`
- **Default:** Auto-detected from runtime

The target platform for your application.

| Value | Description |
|-------|-------------|
| `"node"` | Node.js runtime |
| `"bun"` | Bun runtime |
| `"cloudflare"` | Cloudflare Workers |

```json
{
  "platform": "bun"
}
```

When not specified, Shovel detects the platform from the runtime environment.

---

## port

- **Type:** `number | string`
- **Default:** `3000` (or `$PORT` environment variable)

The port the server listens on.

```json
{
  "port": 8080
}
```

With environment variable fallback:

```json
{
  "port": "$PORT || 3000"
}
```

---

## host

- **Type:** `string`
- **Default:** `"localhost"` (or `$HOST` environment variable)

The host address to bind to.

```json
{
  "host": "0.0.0.0"
}
```

Use `"0.0.0.0"` to listen on all interfaces in production.

---

## workers

- **Type:** `number | string`
- **Default:** `1` (or `$WORKERS` environment variable)

Number of worker threads to spawn for handling requests.

```json
{
  "workers": 4
}
```

In production, set this to the number of CPU cores for optimal performance. Your ServiceWorker code always runs in worker threads, never the main thread.

---

## logging

- **Type:** `object`

Configure structured logging using [LogTape](https://logtape.org/).

### logging.sinks

- **Type:** `Record<string, SinkConfig>`

Named logging sinks (outputs). Each sink uses the [module/export pattern](#moduleexport-pattern).

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

Available sink modules:

| Module | Export | Description |
|--------|--------|-------------|
| `@logtape/logtape` | `getConsoleSink` | Console output |
| `@logtape/file` | `getFileSink` | File output |
| `@logtape/file` | `getRotatingFileSink` | Rotating file output |
| `@logtape/otel` | `getOpenTelemetrySink` | OpenTelemetry export |

Additional options beyond `module` and `export` are passed to the sink factory function.

### logging.loggers

- **Type:** `LoggerConfig[]`

Array of logger configurations that route log messages to sinks.

```json
{
  "logging": {
    "loggers": [
      {
        "category": "app",
        "level": "info",
        "sinks": ["console", "file"]
      },
      {
        "category": ["app", "db"],
        "level": "debug",
        "sinks": ["file"]
      }
    ]
  }
}
```

#### LoggerConfig fields

| Field | Type | Description |
|-------|------|-------------|
| `category` | `string \| string[]` | Logger category or category path |
| `level` | `"debug" \| "info" \| "warning" \| "error"` | Minimum log level |
| `sinks` | `string[]` | Names of sinks to output to |
| `parentSinks` | `"override"` | If set, don't inherit parent sinks |

---

## build

- **Type:** `object`

Configure ESBuild options for production builds.

```json
{
  "build": {
    "target": "es2022",
    "minify": true,
    "sourcemap": "external",
    "treeShaking": true,
    "define": {
      "__VERSION__": "\"1.0.0\""
    },
    "alias": {
      "@": "./src"
    },
    "external": ["native-module"],
    "plugins": [
      {
        "module": "esbuild-plugin-tailwindcss"
      }
    ]
  }
}
```

### build.target

- **Type:** `string | string[]`
- **Default:** `"es2022"`

JavaScript/TypeScript target environment.

```json
{ "target": "es2020" }
{ "target": ["es2020", "chrome100", "firefox100"] }
```

### build.minify

- **Type:** `boolean`
- **Default:** `false`

Enable minification for smaller bundle size.

### build.sourcemap

- **Type:** `boolean | "inline" | "external" | "linked"`
- **Default:** `false`

Source map generation mode.

| Value | Description |
|-------|-------------|
| `false` | No source maps |
| `true` | Inline source maps |
| `"inline"` | Inline source maps in JS files |
| `"external"` | Separate `.map` files |
| `"linked"` | Separate `.map` files with URL comment |

### build.treeShaking

- **Type:** `boolean`
- **Default:** `true`

Enable dead code elimination.

### build.define

- **Type:** `Record<string, string>`

Global constant definitions. Values must be valid JavaScript expressions as strings.

```json
{
  "define": {
    "__VERSION__": "\"1.0.0\"",
    "__DEV__": "false",
    "process.env.NODE_ENV": "\"production\""
  }
}
```

### build.alias

- **Type:** `Record<string, string>`

Path aliases for imports.

```json
{
  "alias": {
    "@": "./src",
    "@components": "./src/components"
  }
}
```

### build.external

- **Type:** `string[]`
- **Default:** Platform-specific (e.g., `["node:*"]` for Node.js)

Modules to exclude from bundling. Added to platform defaults.

```json
{
  "external": ["native-addon", "better-sqlite3"]
}
```

### build.plugins

- **Type:** `BuildPluginConfig[]`

ESBuild plugins using the [module/export pattern](#moduleexport-pattern).

```json
{
  "plugins": [
    {
      "module": "esbuild-plugin-tailwindcss"
    },
    {
      "module": "./plugins/my-plugin.js",
      "export": "myPlugin",
      "option1": "value"
    }
  ]
}
```

User plugins run before Shovel's built-in plugins.

---

## caches

- **Type:** `Record<string, CacheConfig>`

Named cache stores accessible via `self.caches.open(name)` in your ServiceWorker.

```json
{
  "caches": {
    "sessions": {
      "module": "@b9g/cache/memory",
      "export": "MemoryCache",
      "maxEntries": 1000,
      "TTL": 3600
    },
    "api": {
      "module": "@b9g/cache/redis",
      "url": "$REDIS_URL || redis://localhost:6379"
    }
  }
}
```

Use `"*"` as a catch-all pattern for any cache name:

```json
{
  "caches": {
    "*": {
      "module": "@b9g/cache/memory",
      "export": "MemoryCache"
    }
  }
}
```

### CacheConfig fields

| Field | Type | Description |
|-------|------|-------------|
| `module` | `string` | Module path to import |
| `export` | `string` | Named export (default: `"default"`) |
| `url` | `string` | Connection URL for remote caches |
| `maxEntries` | `number` | Maximum cache entries |
| `TTL` | `number` | Time-to-live in seconds |

---

## directories

- **Type:** `Record<string, DirectoryConfig>`

Named file storage directories accessible via `self.directories.open(name)` in your ServiceWorker.

```json
{
  "directories": {
    "uploads": {
      "module": "@b9g/filesystem/node-fs",
      "export": "NodeFSDirectory",
      "path": "./uploads"
    },
    "temp": {
      "module": "@b9g/filesystem/memory",
      "export": "MemoryDirectory"
    },
    "assets": {
      "binding": "ASSETS"
    }
  }
}
```

### DirectoryConfig fields

| Field | Type | Description |
|-------|------|-------------|
| `module` | `string` | Module path to import |
| `export` | `string` | Named export (default: `"default"`) |
| `path` | `string` | Filesystem path (for node-fs) |
| `binding` | `string` | Platform binding name (e.g., Cloudflare R2) |
| `bucket` | `string` | S3 bucket name |
| `region` | `string` | AWS region |
| `endpoint` | `string` | S3-compatible endpoint URL |

---

## databases

- **Type:** `Record<string, DatabaseConfig>`

Named database connections accessible via `databases.open(name)` in your ServiceWorker.

```json
{
  "databases": {
    "main": {
      "module": "@b9g/zen/bun",
      "url": "sqlite://./data.db"
    },
    "analytics": {
      "module": "@b9g/zen/postgres",
      "url": "$DATABASE_URL",
      "max": 10,
      "idleTimeout": 30
    }
  }
}
```

### DatabaseConfig fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `module` | `string` | Yes | Module path to import |
| `export` | `string` | No | Named export (default: `"default"`) |
| `url` | `string` | Yes | Database connection URL |

Additional fields are passed through to the database driver (e.g., `max`, `idleTimeout` for connection pooling).

### URL formats

| Database | URL Format |
|----------|------------|
| SQLite | `sqlite://./path/to/db.sqlite` |
| PostgreSQL | `postgres://user:pass@host:5432/dbname` |

---

## Module/Export Pattern

Many configuration sections use a consistent pattern for specifying providers:

```json
{
  "module": "package-name",
  "export": "namedExport",
  "...options": "passed to factory"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `module` | `string` | npm package name or relative path (`./local.js`) |
| `export` | `string` | Named export to use (default: `"default"`) |

Any additional fields are passed as options to the exported factory function.

### Examples

Using the default export:

```json
{
  "module": "@b9g/cache/memory"
}
```

Using a named export:

```json
{
  "module": "@logtape/file",
  "export": "getFileSink"
}
```

With options:

```json
{
  "module": "@logtape/file",
  "export": "getRotatingFileSink",
  "path": "./logs/app.log",
  "maxSize": 10485760,
  "maxFiles": 5
}
```

Local module:

```json
{
  "module": "./lib/my-cache.js",
  "export": "MyCache"
}
```

---

## TypeScript Support

Shovel generates a `shovel.d.ts` file during builds that provides type-safe access to your configured resources:

```typescript
// These are type-checked against your shovel.json
const cache = await self.caches.open("sessions");     // OK
const cache = await self.caches.open("nonexistent");  // Type error!

const db = self.databases.get("main");                // OK
const dir = await self.directories.open("uploads");   // OK
```

---

## Environment Variables

Shovel respects these environment variables as fallbacks:

| Variable | Config Field | Description |
|----------|--------------|-------------|
| `PORT` | `port` | Server port |
| `HOST` | `host` | Server host |
| `WORKERS` | `workers` | Worker count |
| `PLATFORM` | `platform` | Target platform |

Environment variables can be overridden by explicit config values.
