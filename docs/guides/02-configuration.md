---
title: Configuration
description: Configure your Shovel application with shovel.json.
---

Shovel uses a `shovel.json` file in your project root for configuration.

## Basic Configuration

```json
{
  "directories": {
    "public": {
      "module": "@b9g/filesystem/node-fs",
      "path": "./dist/public"
    }
  },
  "caches": {
    "main": {
      "module": "@b9g/cache/memory"
    }
  }
}
```

## Directories

Directories provide access to the filesystem using the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API):

```json
{
  "directories": {
    "uploads": {
      "module": "@b9g/filesystem/node-fs",
      "path": "./uploads"
    }
  }
}
```

Access in your code:

```typescript
self.addEventListener("fetch", async (event) => {
  const uploads = await self.directories.open("uploads");
  // Use File System Access API
});
```

Custom directories require `module` (and optionally `export`). The built-in names `server`, `public`, and `tmp` have platform defaults and don't need these fields.

The `path` field is resolved relative to the project root. You can point to directories outside your project:

```json
{
  "directories": {
    "shared": {
      "module": "@b9g/filesystem/node-fs",
      "path": "../shared-data"
    }
  }
}
```

See the [Filesystem Reference](../reference/filesystem.md) for all configuration fields and available implementations.

## Caches

Caches provide the standard Cache API for response caching:

```json
{
  "caches": {
    "responses": {
      "module": "@b9g/cache/memory"
    }
  }
}
```

Access in your code:

```typescript
const cache = await self.caches.open("responses");
await cache.put(request, response);
```

## Environment Variables

Environment variables are automatically available via `import.meta.env`:

```typescript
const apiKey = import.meta.env.API_KEY;
```

Set variables in your environment or `.env` file.

## Build Configuration

You can also configure esbuild options in `shovel.json`:

```json
{
  "build": {
    "target": "es2022",
    "minify": true,
    "sourcemap": true
  }
}
```
