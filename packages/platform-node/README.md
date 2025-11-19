# @b9g/platform-node

Node.js platform adapter for Shovel. Runs ServiceWorker applications on Node.js with HTTP server integration, hot reloading, and filesystem-based caching.

## Features

- Node.js HTTP server integration
- Hot module reloading for development
- Worker thread support for concurrency
- Filesystem and memory cache backends
- File System Access API implementation via NodeBucket

## Installation

```bash
npm install @b9g/platform-node
```

## Usage

```javascript
import NodePlatform from '@b9g/platform-node';

const platform = new NodePlatform({
  cache: { type: 'memory' },
  filesystem: { type: 'local', directory: './dist' }
});

const server = platform.createServer(async (request) => {
  return new Response('Hello from Node.js');
}, { port: 3000, host: 'localhost' });

await server.listen();
```

## API

### `new NodePlatform(options?)`

Creates a new Node.js platform instance.

**Options:**
- `cache`: Cache configuration (memory, filesystem)
- `filesystem`: Filesystem configuration (local directory)
- `hotReload`: Enable hot reloading (default: true in development)
- `port`: Default port (default: 3000)
- `host`: Default host (default: localhost)
- `cwd`: Working directory for file resolution

### `platform.createServer(handler, options)`

Creates an HTTP server with the given request handler.

**Options:**
- `port`: Port to listen on
- `host`: Host to bind to

Returns a Server instance with `listen()` and `close()` methods.

## Cache Backends

- `memory`: In-memory caching using MemoryCache
- `filesystem`: Filesystem-based caching using NodeBucket

## License

MIT
