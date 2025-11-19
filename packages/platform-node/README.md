# @b9g/platform-node

Node.js platform adapter for Shovel. Runs ServiceWorker applications on Node.js with HTTP server integration, hot reloading, and worker thread concurrency.

## Features

- Node.js HTTP server with Web API Request/Response conversion
- Hot module reloading for development via VM module system
- Worker thread pool for concurrent request handling
- Memory and filesystem cache backends
- File System Access API implementation via NodeBucket
- ServiceWorker lifecycle support (install, activate, fetch events)

## Installation

```bash
npm install @b9g/platform-node @b9g/platform @b9g/cache @b9g/filesystem
```

## Usage

### Basic Server

```javascript
import NodePlatform from '@b9g/platform-node';

const platform = new NodePlatform({
  caches: { type: 'memory' },
  filesystem: { type: 'local', directory: './dist' }
});

const server = platform.createServer(async (request) => {
  return new Response('Hello from Node.js');
}, { port: 3000, host: 'localhost' });

await server.listen();
console.log('Server running at http://localhost:3000');
```

### ServiceWorker App

```javascript
import NodePlatform from '@b9g/platform-node';

const platform = new NodePlatform({
  hotReload: true,
  cwd: process.cwd()
});

// Load ServiceWorker entrypoint
const instance = await platform.loadServiceWorker('./src/server.js', {
  workerCount: 4 // Number of worker threads
});

// ServiceWorker is now handling requests
```

## API

### Module Exports

```javascript
// Default export
import NodePlatform from '@b9g/platform-node';

// Named exports
import { NodePlatform } from '@b9g/platform-node';

// Re-exported types from @b9g/platform
import type {
  Platform,
  CacheConfig,
  StaticConfig,
  Handler,
  Server,
  ServerOptions
} from '@b9g/platform-node';
```

### `new NodePlatform(options?)`

Creates a new Node.js platform instance.

**Options:**
- `caches`: Cache configuration object (see @b9g/platform)
- `filesystem`: Filesystem configuration object
- `hotReload`: Enable hot reloading (default: true in DEV mode)
- `port`: Default port for servers (default: 3000)
- `host`: Default host for servers (default: localhost)
- `cwd`: Working directory for file resolution (default: process.cwd())

### `platform.createServer(handler, options): Server`

Creates an HTTP server with automatic Request/Response conversion.

**Parameters:**
- `handler`: `(request: Request) => Promise<Response>` - Request handler function
- `options`: Server options (port, host)

**Returns:** Server instance with:
- `listen()`: Start the server
- `close()`: Stop the server
- `url`: Server URL (after listen)
- `ready`: Promise that resolves when server is ready

### `platform.loadServiceWorker(entrypoint, options): Promise<ServiceWorkerInstance>`

Loads and runs a ServiceWorker entrypoint.

**Parameters:**
- `entrypoint`: Path to ServiceWorker entry file
- `options`: ServiceWorker options (workerCount, caches, etc.)

**Returns:** ServiceWorkerInstance with:
- `handleRequest(request)`: Handle a request through the ServiceWorker
- `ready`: Promise that resolves when ServiceWorker is ready

## Cache Backends

Configured via `caches` option:

- `memory`: In-memory caching (MemoryCache)
- `filesystem`: File-based caching (NodeBucket)

## Worker Thread Architecture

The Node.js platform uses worker threads for true concurrency:

- Each worker runs the ServiceWorker code in isolation
- Round-robin load balancing across workers
- Shared cache storage coordinated via PostMessage
- Automatic request timeout (30s default)

## License

MIT
