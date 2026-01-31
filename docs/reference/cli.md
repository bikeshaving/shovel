# CLI

Shovel provides a command-line interface for development, building, and running your application.

## Commands

| Command | Description |
|---------|-------------|
| `shovel develop` | Start development server with hot reload |
| `shovel build` | Build for production |

---

## shovel develop

Start the development server with file watching and hot reload.

```bash
shovel develop <entrypoint> [options]
```

### Arguments

| Argument | Description |
|----------|-------------|
| `entrypoint` | Path to your ServiceWorker entry file |

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `-p, --port <port>` | Server port | `3000` |
| `-h, --host <host>` | Server host | `localhost` |
| `-w, --workers <count>` | Number of workers | `1` |
| `--platform <name>` | Target platform | Auto-detected |

### Examples

```bash
# Basic usage
shovel develop src/server.ts

# Custom port
shovel develop src/server.ts --port 8080

# Listen on all interfaces
shovel develop src/server.ts --host 0.0.0.0

# Multiple workers
shovel develop src/server.ts --workers 4

# Force platform
shovel develop src/server.ts --platform bun
```

### Features

- **Hot Reload**: Automatically rebuilds and reloads when files change
- **Fast Rebuilds**: Only rebuilds changed files
- **Error Overlay**: Shows build errors in the terminal
- **Graceful Shutdown**: SIGINT/SIGTERM properly closes connections

---

## shovel build

Build your application for production.

```bash
shovel build <entrypoint> [options]
```

### Arguments

| Argument | Description |
|----------|-------------|
| `entrypoint` | Path to your ServiceWorker entry file |

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--platform <name>` | Target platform | Auto-detected |
| `--lifecycle [stage]` | Run ServiceWorker lifecycle after build | - |

### Examples

```bash
# Basic build
shovel build src/server.ts

# Build for Bun
shovel build src/server.ts --platform bun

# Build for Cloudflare
shovel build src/server.ts --platform cloudflare

# Build and run lifecycle (install + activate)
shovel build src/server.ts --lifecycle

# Build and run install only
shovel build src/server.ts --lifecycle install
```

### Output Structure

For Node.js and Bun:

```
dist/
├── server/
│   ├── worker.js      # Bundled ServiceWorker
│   ├── server.js      # Server entry point
│   ├── config.js      # Runtime configuration
│   └── package.json   # Self-contained dependencies
└── public/            # Static assets
```

For Cloudflare:

```
dist/
├── server/
│   └── server.js      # Single bundled worker
└── public/            # Static assets
```

### Running the Build

```bash
# Node.js
cd dist/server && node server.js

# Bun
cd dist/server && bun server.js
```

### Build Configuration

Configure build options in `shovel.json`:

```json
{
  "build": {
    "target": "es2022",
    "minify": true,
    "sourcemap": "external",
    "define": {
      "__VERSION__": "\"1.0.0\""
    }
  }
}
```

See [shovel.json](./shovel-json.md#build) for all options.

### The `--lifecycle` Flag

The `--lifecycle` flag builds your app and then runs the ServiceWorker lifecycle events (install and activate) without starting the server. This is useful for:

- **Database migrations**: Run schema migrations during the activate event
- **Static site generation**: Pre-render pages to cache
- **Cache warming**: Pre-populate caches before deployment

#### Lifecycle Stages

| Stage | Events Run |
|-------|-----------|
| `install` | install only |
| `activate` (default) | install + activate |

#### Example: Static Site Generation

Pre-render pages during the activate event:

```typescript
self.addEventListener("activate", (event) => {
  event.waitUntil(generateStaticSite());
});

async function generateStaticSite() {
  const pages = ["/", "/about", "/blog"];
  const cache = await caches.open("static");

  for (const path of pages) {
    const html = await renderPage(path);
    const response = new Response(html, {
      headers: { "Content-Type": "text/html" },
    });
    await cache.put(new Request(path), response);
  }
}
```

Then build and run lifecycle:

```bash
shovel build src/server.ts --lifecycle
```

---

## Platform Detection

Shovel automatically detects the platform in this order:

1. CLI `--platform` option
2. `platform` field in `shovel.json`
3. Deployment platform detection (Cloudflare Workers environment)
4. Runtime detection (`bun` or `node`)

### Supported Platforms

| Platform | Description |
|----------|-------------|
| `node` | Node.js runtime |
| `bun` | Bun runtime |
| `cloudflare` | Cloudflare Workers |

---

## Environment Variables

CLI options can also be set via environment variables:

| Variable | CLI Option |
|----------|-----------|
| `PORT` | `--port` |
| `HOST` | `--host` |
| `WORKERS` | `--workers` |
| `PLATFORM` | `--platform` |

CLI options take precedence over environment variables.

```bash
# These are equivalent
PORT=8080 shovel develop src/server.ts
shovel develop src/server.ts --port 8080
```

---

## Exit Codes

| Code | Description |
|------|-------------|
| `0` | Success |
| `1` | Error (build failure, runtime error, etc.) |

---

## See Also

- [Getting Started](./guides/01-getting-started.md) - Quick start guide
- [shovel.json](./shovel-json.md) - Configuration reference
- [Deployment](./deployment.md) - Production deployment
