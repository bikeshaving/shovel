# @b9g/platform-cloudflare

Cloudflare Workers platform adapter for Shovel. Runs ServiceWorker applications on Cloudflare's edge network with KV storage and Durable Objects support.

## Features

- Cloudflare Workers integration
- KV storage for caching
- R2 bucket support for assets
- Durable Objects for stateful apps
- Standards-compliant ServiceWorker API

## Installation

```bash
npm install @b9g/platform-cloudflare
```

## Usage

```javascript
import CloudflarePlatform from '@b9g/platform-cloudflare';

const platform = new CloudflarePlatform({
  cache: { type: 'kv', binding: 'CACHE_KV' },
  filesystem: { type: 'r2', binding: 'ASSETS_R2' }
});

export default {
  async fetch(request, env, ctx) {
    return await platform.handleRequest(request);
  }
};
```

## Requirements

Shovel requires Node.js compatibility for AsyncLocalStorage (used by `self.cookieStore`). Add to your `wrangler.toml`:

```toml
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]
```

## API

### `new CloudflarePlatform(options?)`

Creates a new Cloudflare platform instance.

**Options:**
- `cache`: Cache configuration (KV binding)
- `filesystem`: Filesystem configuration (R2 binding)
- `env`: Cloudflare environment bindings

### Bindings

Configure bindings in `wrangler.toml`:

```toml
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]

[[kv_namespaces]]
binding = "CACHE_KV"
id = "your-kv-namespace-id"

[[r2_buckets]]
binding = "ASSETS_R2"
bucket_name = "your-bucket-name"
```

## Cache Backends

- `kv`: Cloudflare KV storage
- `cache-api`: Cloudflare Cache API (default)

## Filesystem Backends

- `r2`: Cloudflare R2 bucket storage

## License

MIT
