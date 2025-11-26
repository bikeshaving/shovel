# @b9g/platform-bun

Bun platform adapter for Shovel. Runs ServiceWorker applications on Bun with native HTTP server integration and fast hot reloading.

## Features

- Bun HTTP server integration
- Fast hot module reloading
- Worker thread support for concurrency
- Memory and filesystem cache backends
- File System Access API implementation via BunBucket

## Installation

```bash
bun install @b9g/platform-bun
```

## Usage

```javascript
import BunPlatform from '@b9g/platform-bun';

const platform = new BunPlatform({
  cache: { type: 'memory' },
  filesystem: { type: 'local', directory: './dist' }
});

const server = platform.createServer(async (request) => {
  return new Response('Hello from Bun');
}, { port: 3000, host: 'localhost' });

await server.listen();
```

## Exports

### Classes

- `BunPlatform` - Bun platform implementation (extends BasePlatform)

### Types

- `BunPlatformOptions` - Configuration options for BunPlatform

### Re-exports from @b9g/platform

- `Platform`, `CacheConfig`, `StaticConfig`, `Handler`, `Server`, `ServerOptions`

### Default Export

- `BunPlatform` - The platform class

## API

### `new BunPlatform(options?)`

Creates a new Bun platform instance.

**Options:**
- `cache`: Cache configuration (memory, filesystem)
- `filesystem`: Filesystem configuration (local directory)
- `port`: Default port (default: 3000)
- `host`: Default host (default: localhost)
- `cwd`: Working directory for file resolution

### `platform.createServer(handler, options)`

Creates a Bun HTTP server with the given request handler.

**Options:**
- `port`: Port to listen on
- `host`: Host to bind to

Returns a Server instance with `listen()` and `close()` methods.

## Cache Backends

- `memory`: In-memory caching using MemoryCache
- `filesystem`: Filesystem-based caching using BunBucket

## License

MIT
