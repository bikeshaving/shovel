# shovel.json

Configuration file reference. All fields are optional.

---

## Config Expressions

String values support environment variables and expressions.

```json
{
  "port": "$PORT || 7777",
  "platform": "$NODE_ENV === production ? cloudflare : bun"
}
```

**Note:** Operators require spaces: `$VAR || default` not `$VAR||default`.

| Operator | Example |
|----------|---------|
| `\|\|` | `"$PORT \|\| 7777"` |
| `??` | `"$PORT ?? 7777"` |
| `===`, `!==` | `"$ENV === production"` |
| `? :` | `"$DEV ? memory : redis"` |

### Path Placeholders

| Placeholder | Description |
|-------------|-------------|
| `[outdir]` | Build output directory |
| `[tmpdir]` | System temp directory |
| `[git]` | Git commit SHA |

---

## platform

- **Type:** `string`
- **Default:** Auto-detected

| Value | Description |
|-------|-------------|
| `"node"` | Node.js |
| `"bun"` | Bun |
| `"cloudflare"` | Cloudflare Workers |

---

## port

- **Type:** `number | string`
- **Default:** `7777`

---

## host

- **Type:** `string`
- **Default:** `"localhost"`

---

## workers

- **Type:** `number | string`
- **Default:** `1`

---

## logging

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
      { "category": "app", "level": "info", "sinks": ["console"] }
    ]
  }
}
```

### Sink Modules

| Module | Export | Description |
|--------|--------|-------------|
| `@logtape/logtape` | `getConsoleSink` | Console |
| `@logtape/file` | `getFileSink` | File |
| `@logtape/file` | `getRotatingFileSink` | Rotating file |
| `@logtape/otel` | `getOpenTelemetrySink` | OpenTelemetry |

### Logger Fields

| Field | Type |
|-------|------|
| `category` | `string \| string[]` |
| `level` | `"debug" \| "info" \| "warning" \| "error"` |
| `sinks` | `string[]` |
| `parentSinks` | `"override"` |

---

## build

```json
{
  "build": {
    "target": "es2022",
    "minify": true,
    "sourcemap": "external"
  }
}
```

| Field | Type | Default |
|-------|------|---------|
| `target` | `string \| string[]` | `"es2022"` |
| `minify` | `boolean` | `false` |
| `sourcemap` | `boolean \| "inline" \| "external"` | `false` |
| `treeShaking` | `boolean` | `true` |
| `define` | `Record<string, string>` | - |
| `alias` | `Record<string, string>` | - |
| `external` | `string[]` | - |
| `plugins` | `BuildPluginConfig[]` | - |

---

## caches

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

| Field | Type | Description |
|-------|------|-------------|
| `module` | `string` | Module path |
| `export` | `string` | Named export |
| `maxEntries` | `number` | Max entries |
| `TTL` | `number` | TTL in seconds |

Use `"*"` as catch-all.

---

## directories

```json
{
  "directories": {
    "uploads": {
      "module": "@b9g/filesystem/node-fs",
      "path": "./uploads"
    }
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `module` | `string` | Module path |
| `export` | `string` | Named export |
| `path` | `string` | Filesystem path |
| `binding` | `string` | Platform binding |
| `bucket` | `string` | S3 bucket |
| `region` | `string` | AWS region |
| `endpoint` | `string` | S3 endpoint |

---

## databases

```json
{
  "databases": {
    "main": {
      "module": "@b9g/zen/bun",
      "url": "sqlite://./data.db"
    }
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `module` | `string` | Module path |
| `export` | `string` | Named export |
| `url` | `string` | Connection URL |

### URL Formats

| Database | Format |
|----------|--------|
| SQLite | `sqlite://./path.db` |
| PostgreSQL | `postgres://user:pass@host:5432/db` |

---

## Module/Export Pattern

```json
{
  "module": "package-name",
  "export": "namedExport",
  "...options": "passed to factory"
}
```

---

## TypeScript

Shovel generates `shovel.d.ts` for type-safe resource access:

```typescript
const cache = await self.caches.open("sessions");  // Type-checked
```

