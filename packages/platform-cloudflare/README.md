# @b9g/platform-cloudflare

Cloudflare Workers platform adapter for Shovel. Runs ServiceWorker applications on Cloudflare's edge network with R2 storage and static assets support.

## Installation

```bash
npm install @b9g/platform-cloudflare
```

## Module Structure

```
@b9g/platform-cloudflare
├── /caches      # CloudflareNativeCache (Cloudflare Cache API wrapper)
├── /directories # CloudflareR2Directory, CloudflareAssetsDirectory
├── /variables   # envStorage (per-request Cloudflare env access)
└── /runtime     # Worker bootstrap (initializeRuntime, createFetchHandler)
```

## Configuration

Configure in `shovel.json`:

```json
{
  "platform": "cloudflare",
  "caches": {
    "default": {
      "module": "@b9g/platform-cloudflare/caches"
    }
  },
  "directories": {
    "public": {
      "module": "@b9g/platform-cloudflare/directories",
      "export": "CloudflareAssetsDirectory"
    },
    "uploads": {
      "module": "@b9g/platform-cloudflare/directories",
      "binding": "uploads_r2"
    }
  }
}
```

## Requirements

Shovel requires Node.js compatibility for AsyncLocalStorage. Add to your `wrangler.toml`:

```toml
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]
```

## Exports

### Main Package (`@b9g/platform-cloudflare`)

- `CloudflarePlatform` - Platform adapter (default export)

### Caches (`@b9g/platform-cloudflare/caches`)

- `CloudflareNativeCache` - Wrapper around Cloudflare's Cache API (default export)

### Directories (`@b9g/platform-cloudflare/directories`)

- `CloudflareR2Directory` - FileSystemDirectoryHandle for R2 buckets (default export)
- `CloudflareAssetsDirectory` - FileSystemDirectoryHandle for static assets
- `R2FileSystemDirectoryHandle` - Base R2 directory implementation
- `R2FileSystemFileHandle` - Base R2 file implementation
- `CFAssetsDirectoryHandle` - Base assets directory implementation
- `CFAssetsFileHandle` - Base assets file implementation

### Runtime (`@b9g/platform-cloudflare/runtime`)

- `initializeRuntime(config)` - Initialize worker runtime
- `createFetchHandler(registration)` - Create ES module fetch handler
- `CloudflareFetchEvent` - Extended FetchEvent with env bindings

### Variables (`@b9g/platform-cloudflare/variables`)

- `envStorage` - AsyncContext for per-request Cloudflare env access
- `getEnv()` - Get current request's env bindings

## Bindings

Configure bindings in `wrangler.toml`. Use lowercase binding names to avoid env expression parsing issues:

```toml
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]

# R2 bucket for uploads directory
[[r2_buckets]]
binding = "uploads_r2"
bucket_name = "my-uploads-bucket"

# Static assets (always uses ASSETS binding)
[assets]
directory = "./public"
```

## Directory Types

| Type | Use Case | Read/Write | Binding |
|------|----------|------------|---------|
| R2 | User uploads, dynamic storage | Both | User-defined |
| Assets | Static files deployed with worker | Read-only | Always `ASSETS` |

## License

MIT
