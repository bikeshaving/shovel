# @b9g/platform

Universal platform abstraction for ServiceWorker-style applications with automatic platform detection and worker thread architecture.

## Features

- **ServiceWorker Pattern**: Load applications as ServiceWorker entrypoints
- **Multi-Platform**: Node.js, Bun, Cloudflare Workers support
- **Auto-Detection**: Automatic runtime detection with explicit override
- **Worker Architecture**: Multi-worker concurrency with coordinated caching
- **Hot Reloading**: VM module isolation for clean development reloads

## Installation

```bash
npm install @b9g/platform
```

## Platform Packages

Install platform-specific implementations:

```bash
# For Node.js
npm install @b9g/platform-node

# For Bun
npm install @b9g/platform-bun  

# For Cloudflare Workers
npm install @b9g/platform-cloudflare
```

## Quick Start

```javascript
import { createPlatform } from '@b9g/platform';

// Auto-detect platform
const platform = await createPlatform('auto');

// Load ServiceWorker app
const serviceWorker = await platform.loadServiceWorker('./app.js', {
  workerCount: 2,
  hotReload: true
});

// Create server
const server = platform.createServer(serviceWorker.handleRequest, {
  port: 3000,
  host: 'localhost'
});

await server.listen();
```

## ServiceWorker Pattern

Write your app as a ServiceWorker entrypoint:

```javascript
// app.js - ServiceWorker-style entrypoint
import { Router } from '@b9g/router';

const router = new Router();
router.get('/', () => new Response('Hello World!'));

// ServiceWorker lifecycle events
addEventListener('install', event => {
  console.log('App installing...');
});

addEventListener('activate', event => {
  console.log('App activated!');
});

// Handle fetch events
addEventListener('fetch', event => {
  event.respondWith(router.handler(event.request));
});
```

## Platform Detection

```javascript
import { 
  detectPlatform, 
  createPlatform,
  displayPlatformInfo 
} from '@b9g/platform';

// Detect current runtime
const detected = detectPlatform();
console.log(detected); // { runtime: 'bun', platforms: ['bun', 'node'] }

// Create platform instance
const platform = await createPlatform('bun', {
  // Platform-specific options
});

// Display platform information
displayPlatformInfo(detected);
```

## Worker Architecture

```javascript
const platform = await createPlatform('node');

const serviceWorker = await platform.loadServiceWorker('./app.js', {
  workerCount: 4,           // Number of worker threads
  hotReload: true,          // Enable hot reloading
  caches: {
    pages: { type: 'memory', maxEntries: 1000 },
    api: { type: 'memory', ttl: 300 }
  }
});

// Workers coordinate through PostMessage
// Each worker loads your ServiceWorker app
// Cache operations are coordinated across workers
```

## Platform-Specific Features

### Node.js Platform

```javascript
import NodePlatform from '@b9g/platform-node';

const platform = new NodePlatform({
  // Node.js specific options
});
```

### Bun Platform

```javascript
import BunPlatform from '@b9g/platform-bun';

const platform = new BunPlatform({
  // Bun specific options  
});
```

### Cloudflare Workers Platform

```javascript
import CloudflarePlatform from '@b9g/platform-cloudflare';

const platform = new CloudflarePlatform({
  // Cloudflare specific options
});
```

## API Reference

### Platform Interface

```typescript
interface Platform {
  loadServiceWorker(entrypoint: string, options: ServiceWorkerOptions): Promise<ServiceWorkerInstance>;
  createServer(handler: Handler, options: ServerOptions): Server;
  dispose(): Promise<void>;
}
```

### ServiceWorker Options

```typescript
interface ServiceWorkerOptions {
  workerCount?: number;
  hotReload?: boolean;
  caches?: CacheConfig;
}
```

### Platform Detection

```typescript
function detectPlatform(): PlatformDetection;
function createPlatform(platformName: string, options?: any): Promise<Platform>;
function displayPlatformInfo(detection: PlatformDetection): void;
```

## Development vs Production

### Development (2 workers default)
- Encourages concurrency thinking from the start
- Hot reloading with VM module isolation
- Verbose logging and error reporting

### Production (CPU count workers)
- Maximum throughput with worker-per-core
- Optimized cache coordination
- Minimal logging overhead

## Integration with CLI

The platform abstraction powers the Shovel CLI:

```bash
# Auto-detect and run
shovel develop app.js

# Explicit platform targeting
shovel develop app.js --platform=bun --workers=4

# Platform-specific builds
shovel build app.js --platform=cloudflare
```

## License

MIT