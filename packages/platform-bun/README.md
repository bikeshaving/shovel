# @b9g/platform-bun

Bun platform adapter for Shovel. Runs ServiceWorker applications on [Bun](https://bun.sh) with native HTTP server, WebSocket support, and OS-level load balancing via `reusePort`.

## Features

- Native `Bun.serve()` HTTP + WebSocket server
- Built-in TypeScript/JSX support (no transpilation step)
- Worker threads with `reusePort` for zero-overhead load balancing
- Hot module reloading for development
- ServiceWorker lifecycle support (install, activate, fetch events)
- File System Access API via `@b9g/filesystem`

## Installation

```bash
bun add @b9g/platform-bun
```

## Usage

### ServiceWorker Application

```typescript
import BunPlatform from "@b9g/platform-bun";

const platform = new BunPlatform({port: 3000, workers: 4});
await platform.serviceWorker.register("./dist/server/worker.js");
await platform.serviceWorker.ready;
await platform.listen();
```

### Standalone Server

```typescript
import BunPlatform from "@b9g/platform-bun";

const platform = new BunPlatform();
const server = platform.createServer(async (request) => {
  return new Response("Hello from Bun");
});
await server.listen();
```

## Exports

- **`BunPlatform`** (default) -- Main platform class
- **`BunServiceWorkerContainer`** -- ServiceWorker container managing worker lifecycle
- **`BunPlatformOptions`** -- Constructor options type
- **`DefaultCache`** -- Re-exported `MemoryCache` for config references

## API

### `new BunPlatform(options?)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `port` | `number` | `7777` | Server port |
| `host` | `string` | `"localhost"` | Server host |
| `cwd` | `string` | `process.cwd()` | Working directory |
| `workers` | `number` | `1` | Number of worker threads |
| `config` | `ShovelConfig` | -- | Shovel config (caches, directories) |

### `platform.createServer(handler, options?)`

Creates a Bun HTTP server with WebSocket upgrade support.

- **`handler`**: `(request: Request) => Promise<Response | HandleResult>`
- **`options.port`**: Override port
- **`options.host`**: Override host
- **`options.reusePort`**: Enable OS-level load balancing (used in multi-worker production)

Returns a `Server` with `listen()`, `close()`, `url`, `address()`, and `ready`.

### `platform.serviceWorker`

`BunServiceWorkerContainer` implementing the standard `ServiceWorkerContainer` interface:

- **`register(scriptURL, options?)`** -- Register a ServiceWorker, spawns worker threads
- **`ready`** -- Promise resolving when registration is active
- **`getRegistration(scope?)`** / **`getRegistrations()`** -- Query registrations

### `platform.getEntryPoints(userEntryPath, mode)`

Returns generated entry point code for bundling. Used by the build system.

- **Development**: `{worker}` -- Single worker with message loop
- **Production**: `{supervisor, worker}` -- Supervisor spawns workers with `reusePort`

### `platform.getESBuildConfig()`

Returns Bun-specific esbuild configuration: `platform: "node"`, externals for `node:*`, `bun`, `bun:*`, and Node.js builtins.

## Worker Architecture

### Development

Single worker managed by the `shovel develop` CLI. The develop command owns the HTTP server; the worker handles requests via message loop.

### Production

Each worker creates its own `Bun.serve()` with `reusePort`, letting the OS kernel load-balance connections. No message passing overhead between supervisor and workers.

```
Supervisor (index.js)
  ├── Worker 1 (worker.js) ── Bun.serve(:3000, reusePort)
  ├── Worker 2 (worker.js) ── Bun.serve(:3000, reusePort)
  └── Worker N (worker.js) ── Bun.serve(:3000, reusePort)
```

The supervisor handles graceful shutdown (SIGINT/SIGTERM) and BroadcastChannel relay between workers.

## How It Differs from @b9g/platform-node

| | Bun | Node.js |
|---|---|---|
| **HTTP** | `Bun.serve()` | `node:http` + `ws` |
| **WebSocket** | Built-in | Requires `ws` package |
| **Load balancing** | OS-level via `reusePort` | Round-robin message passing |
| **TypeScript** | Native support | VM module transpilation |
| **Multi-worker** | Each worker binds own port | Supervisor distributes requests |

## License

MIT
