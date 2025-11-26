# @b9g/platform

**ServiceWorker-first universal deployment platform. Write ServiceWorker apps once, deploy anywhere (Node/Bun/Cloudflare). Registry-based multi-app orchestration.**

## Features

- **ServiceWorkerContainer Registry**: Manage multiple ServiceWorker apps by scope
- **Complete ServiceWorker API**: Full MDN spec implementation for any JavaScript runtime
- **Multi-App Orchestration**: Deploy multiple ServiceWorkers with scope-based routing
- **Universal Platform Support**: Node.js, Bun, Cloudflare Workers with identical APIs
- **Standards Compliance**: Full ServiceWorker specification compliance

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

// Create ServiceWorker registry
const container = await platform.createServiceWorkerContainer();

// Register multiple ServiceWorker apps by scope
await container.register('/api-worker.js', { scope: '/api/' });
await container.register('/admin-worker.js', { scope: '/admin/' });
await container.register('/app-worker.js', { scope: '/' });

// Install and activate all ServiceWorkers
await container.installAll();

// Create server that routes to appropriate ServiceWorker
const server = platform.createServer(container.handleRequest.bind(container), {
  port: 3000,
  host: 'localhost'
});

await server.listen();
```

## ServiceWorker Registry Pattern

Deploy multiple ServiceWorker applications with scope-based routing:

```javascript
// api-worker.js - API ServiceWorker
import { Router } from '@b9g/router';

const router = new Router();
router.get('/users', () => Response.json({ users: [] }));
router.get('/posts', () => Response.json({ posts: [] }));

addEventListener('install', event => {
  console.log('API service installing...');
});

addEventListener('activate', event => {
  console.log('API service activated!');
});

addEventListener('fetch', event => {
  event.respondWith(router.handler(event.request));
});
```

```javascript
// app-worker.js - Main app ServiceWorker
import { Router } from '@b9g/router';

const router = new Router();
router.get('/', () => new Response('Hello World!'));
router.get('/about', () => new Response('About page'));

addEventListener('install', event => {
  console.log('App installing...');
});

addEventListener('activate', event => {
  console.log('App activated!');
});

addEventListener('fetch', event => {
  event.respondWith(router.handler(event.request));
});
```

**Registry automatically routes requests:**
- `/api/users` → `api-worker.js` 
- `/api/posts` → `api-worker.js`
- `/` → `app-worker.js`
- `/about` → `app-worker.js`

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

const serviceWorker = await platform.loadServiceWorker('./server.js', {
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

## Exports

### Classes

- `BasePlatform` - Abstract base class for platform implementations
- `platformRegistry` - Default platform registry singleton

### Functions

- `createPlatform(name, options?)` - Create a platform instance by name
- `getPlatform(name?)` - Get a registered platform synchronously
- `getPlatformAsync(name?)` - Get a registered platform asynchronously
- `detectRuntime()` - Detect current JavaScript runtime ('bun' | 'deno' | 'node')
- `detectDeploymentPlatform()` - Detect deployment platform (Cloudflare, Vercel, etc.)
- `detectDevelopmentPlatform()` - Detect development platform
- `resolvePlatform(options)` - Resolve platform from options

### Types

- `Platform` - Platform interface
- `PlatformConfig` - Platform configuration options
- `ServerOptions` - Server configuration options
- `Handler` - Request handler function type
- `Server` - Server interface
- `ServiceWorkerOptions` - ServiceWorker loading options
- `ServiceWorkerInstance` - Loaded ServiceWorker instance

### Re-exports from @b9g/filesystem

- `BucketStorage`, `Bucket`, `BucketFactory`, `CustomBucketStorage`

### Re-exports from @b9g/cache

- `Cache`, `CacheFactory`, `CacheQueryOptions`, `CustomCacheStorage`

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
shovel develop server.js

# Explicit platform targeting
shovel develop server.js --platform=bun --workers=4

# Platform-specific builds
shovel build server.js --platform=cloudflare
```

## License

MIT