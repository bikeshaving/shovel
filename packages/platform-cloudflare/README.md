# @b9g/platform-cloudflare

Cloudflare Workers platform adapter for Shovel. Runs ServiceWorker applications on Cloudflare's edge network with R2 storage and static assets support.

## Installation

```bash
npm install @b9g/platform-cloudflare
```

## Module Structure

```
@b9g/platform-cloudflare
├── /cache    # CloudflareNativeCache (Cloudflare Cache API wrapper)
├── /r2       # CloudflareR2Directory (R2 bucket filesystem)
├── /assets   # CloudflareAssetsDirectory (static assets filesystem)
└── /runtime  # Worker bootstrap (initializeRuntime, createFetchHandler)
```

## Configuration

Configure in `shovel.json`:

```json
{
  "platform": "cloudflare",
  "caches": {
    "default": {
      "module": "@b9g/platform-cloudflare/cache"
    }
  },
  "directories": {
    "public": {
      "module": "@b9g/platform-cloudflare/assets"
    },
    "uploads": {
      "module": "@b9g/platform-cloudflare/r2",
      "binding": "UPLOADS_R2"
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
- `createOptionsFromEnv(env)` - Create options from Cloudflare env
- `generateWranglerConfig(options)` - Generate wrangler.toml

### Cache (`@b9g/platform-cloudflare/cache`)

- `CloudflareNativeCache` - Wrapper around Cloudflare's Cache API

### R2 (`@b9g/platform-cloudflare/r2`)

- `CloudflareR2Directory` - FileSystemDirectoryHandle for R2 buckets
- `R2FileSystemDirectoryHandle` - Base R2 directory implementation
- `R2FileSystemFileHandle` - Base R2 file implementation

### Assets (`@b9g/platform-cloudflare/assets`)

- `CloudflareAssetsDirectory` - FileSystemDirectoryHandle for static assets
- `CFAssetsDirectoryHandle` - Base assets directory implementation
- `CFAssetsFileHandle` - Base assets file implementation

### Runtime (`@b9g/platform-cloudflare/runtime`)

- `initializeRuntime(config)` - Initialize worker runtime
- `createFetchHandler(registration)` - Create ES module fetch handler
- `CloudflareFetchEvent` - Extended FetchEvent with env bindings

## Bindings

Configure bindings in `wrangler.toml`:

```toml
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]

[[r2_buckets]]
binding = "UPLOADS_R2"
bucket_name = "my-uploads-bucket"
```

## License

MIT
