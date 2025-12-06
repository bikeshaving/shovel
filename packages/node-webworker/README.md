# @b9g/node-webworker

Minimal Web Worker shim for Node.js until native support arrives.

## Why This Package Exists

Node.js lacks native Web Worker support, despite being a web standard since 2009. This package provides a minimal, reliable shim using Node.js `worker_threads` until native support is added.

**Canonical Issue:** https://github.com/nodejs/node/issues/43583
**Please 👍 and comment** on the issue to show demand for native Web Worker support!

## Installation

```bash
npm install @b9g/node-webworker
```

## Usage

```typescript
import {Worker} from '@b9g/node-webworker';

// Create a worker (same API as Web Workers)
const worker = new Worker('./worker.js', { type: 'module' });

// Listen for messages
worker.addEventListener('message', (event) => {
  console.log('Received:', event.data);
});

// Send a message
worker.postMessage({ hello: 'world' });

// Terminate when done
worker.terminate();
```

## Exports

### Classes

- `Worker` - Web Worker implementation using Node.js worker_threads
- `MessageEvent` - Event class for worker messages
- `ErrorEvent` - Event class for worker errors

### Default Export

- `Worker` - The Worker class

## Features

- **Standards-compliant API** - Drop-in replacement for Web Workers
- **ES Module support** - Works with modern JavaScript
- **Minimal overhead** - Thin wrapper around `worker_threads`
- **Error handling** - Proper event forwarding
- **Clean termination** - Resource cleanup

## Limitations

- **Node.js only** - Don't use this in browsers (they have native Web Workers)
- **Module workers only** - Classic workers with `importScripts()` not supported
- **Serialization differences** - Uses Node.js structured clone, not web's algorithm

## Deprecation Notice

⚠️ **This package will be deprecated** once Node.js implements native Web Workers.

We maintain this as a temporary workaround. Please help push for native support by engaging with [nodejs/node#43583](https://github.com/nodejs/node/issues/43583).

## License

MIT
