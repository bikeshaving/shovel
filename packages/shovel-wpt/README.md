# @b9g/shovel-wpt

[Web Platform Tests](https://web-platform-tests.org/) runner for validating Shovel's implementations of standard web APIs. Tests are vendored from the official WPT repository and adapted to run under Bun's test framework.

This is a private package used for internal testing only.

## Test Suites

| Suite | What it tests | Runner |
|-------|---------------|--------|
| **Cache API** | `Cache.put()`, `match()`, `delete()`, `keys()`, `matchAll()` | `runCacheTests` |
| **File System** | `FileSystemDirectoryHandle`, `FileSystemFileHandle`, iteration, writable streams | `runFilesystemTests` |
| **ServiceWorker Runtime** | `ExtendableEvent.waitUntil()`, `FetchEvent.respondWith()`, install/activate lifecycle | `runRuntimeTests` |
| **Platform Contract** | Server creation, request handling, ServiceWorker globals (`caches`, `directories`, `cookieStore`) | `runPlatformTests` |

## Usage

Each runner takes a config with factories for the implementation under test:

```typescript
import {runCacheTests} from "@b9g/shovel-wpt/runners/cache";
import {MemoryCache} from "@b9g/cache/memory";

runCacheTests("MemoryCache", {
  createCache: (name) => new MemoryCache(name),
});
```

```typescript
import {runFilesystemTests} from "@b9g/shovel-wpt/runners/filesystem";
import {MemoryDirectory} from "@b9g/filesystem/memory";

runFilesystemTests("MemoryDirectory", {
  getDirectory: () => new MemoryDirectory("test-root"),
});
```

## Running Tests

```bash
# All tests
bun test packages/shovel-wpt

# Specific suite
bun test packages/shovel-wpt/test/cache.test.ts
bun test packages/shovel-wpt/test/filesystem.test.ts
bun test packages/shovel-wpt/test/runtime.test.ts
bun test packages/shovel-wpt/test/platform.test.ts
```

## Structure

```
packages/shovel-wpt/
├── src/
│   ├── harness/          # WPT test harness (bridges WPT → Bun test framework)
│   ├── runners/          # Test runners (cache, filesystem, runtime, platform)
│   └── wpt/              # Shims that set up globals for WPT tests
├── test/                 # Tests using the runners against real implementations
├── wpt/                  # Vendored WPT test files (FileAPI, CookieStore, IndexedDB)
└── package.json
```

## License

MIT
