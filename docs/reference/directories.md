# Directories

Shovel provides the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API) for file storage. Directories are available globally via `directories` in your ServiceWorker code.

## Quick Start

```typescript
// Open a named directory
const uploads = await directories.open("uploads");

// Get a file handle
const file = await uploads.getFileHandle("photo.jpg");

// Read file contents
const blob = await file.getFile();
const text = await blob.text();

// Write a new file
const newFile = await uploads.getFileHandle("data.json", { create: true });
const writable = await newFile.createWritable();
await writable.write(JSON.stringify({ hello: "world" }));
await writable.close();
```

---

## Configuration

Configure directories in `shovel.json`:

```json
{
  "directories": {
    "uploads": {
      "module": "@b9g/filesystem/node-fs",
      "export": "NodeFSDirectory",
      "path": "./uploads"
    },
    "temp": {
      "module": "@b9g/filesystem/memory"
    }
  }
}
```

### Built-in Directories

Shovel provides default directories for build output:

| Name | Path | Description |
|------|------|-------------|
| `server` | `[outdir]/server` | Server-side bundled code |
| `public` | `[outdir]/public` | Static assets |
| `tmp` | `[tmpdir]` | Temporary files |

### Path Placeholders

| Placeholder | Description | Resolved |
|-------------|-------------|----------|
| `[outdir]` | Build output directory | Build time |
| `[tmpdir]` | System temp directory | Runtime |
| `[git]` | Git commit SHA | Build time |

### Environment-Based Configuration

```json
{
  "directories": {
    "uploads": {
      "module": "$NODE_ENV === production ? @b9g/filesystem-s3 : @b9g/filesystem/node-fs",
      "path": "$UPLOAD_PATH || ./uploads",
      "bucket": "$S3_BUCKET"
    }
  }
}
```

### Configuration Fields

| Field | Type | Description |
|-------|------|-------------|
| `module` | `string` | Module path to import |
| `export` | `string` | Named export (default: `"default"`) |
| `path` | `string` | Filesystem path |
| `binding` | `string` | Platform binding name (Cloudflare) |
| `bucket` | `string` | S3 bucket name |
| `region` | `string` | AWS region |
| `endpoint` | `string` | S3-compatible endpoint URL |

---

## DirectoryStorage API

The global `directories` object provides:

### directories.open(name)

Opens a named directory.

```typescript
const uploads = await directories.open("uploads");
```

---

## FileSystemDirectoryHandle API

Each directory implements [FileSystemDirectoryHandle](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemDirectoryHandle):

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `kind` | `"directory"` | Always `"directory"` |
| `name` | `string` | Directory name |

### getFileHandle(name, options?)

Gets a file handle within the directory.

```typescript
// Get existing file
const file = await dir.getFileHandle("config.json");

// Create file if it doesn't exist
const file = await dir.getFileHandle("new.txt", { create: true });
```

### getDirectoryHandle(name, options?)

Gets a subdirectory handle.

```typescript
// Get existing subdirectory
const subdir = await dir.getDirectoryHandle("images");

// Create subdirectory if it doesn't exist
const subdir = await dir.getDirectoryHandle("cache", { create: true });
```

### removeEntry(name, options?)

Removes a file or directory.

```typescript
// Remove file
await dir.removeEntry("old.txt");

// Remove directory recursively
await dir.removeEntry("old-folder", { recursive: true });
```

### entries()

Iterates over directory contents.

```typescript
for await (const [name, handle] of dir.entries()) {
  if (handle.kind === "file") {
    console.log(`File: ${name}`);
  } else {
    console.log(`Directory: ${name}`);
  }
}
```

### keys()

Iterates over entry names.

```typescript
for await (const name of dir.keys()) {
  console.log(name);
}
```

### values()

Iterates over entry handles.

```typescript
for await (const handle of dir.values()) {
  console.log(handle.name, handle.kind);
}
```

### resolve(possibleDescendant)

Returns the path from this directory to a descendant.

```typescript
const subdir = await dir.getDirectoryHandle("a/b/c");
const path = await dir.resolve(subdir);
// ["a", "b", "c"]
```

### isSameEntry(other)

Checks if two handles reference the same entry.

```typescript
const file1 = await dir.getFileHandle("data.json");
const file2 = await dir.getFileHandle("data.json");
console.log(await file1.isSameEntry(file2)); // true
```

---

## FileSystemFileHandle API

File handles implement [FileSystemFileHandle](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle):

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `kind` | `"file"` | Always `"file"` |
| `name` | `string` | File name |

### getFile()

Returns the file as a [File](https://developer.mozilla.org/en-US/docs/Web/API/File) object.

```typescript
const fileHandle = await dir.getFileHandle("data.json");
const file = await fileHandle.getFile();

console.log(file.name);        // "data.json"
console.log(file.size);        // 1234
console.log(file.type);        // "application/json"
console.log(file.lastModified); // 1699999999999

const text = await file.text();
const json = JSON.parse(text);
```

### createWritable(options?)

Creates a writable stream for writing to the file.

```typescript
const fileHandle = await dir.getFileHandle("output.txt", { create: true });
const writable = await fileHandle.createWritable();

// Write string
await writable.write("Hello, ");

// Write more
await writable.write("World!");

// Must close to commit changes
await writable.close();
```

#### WritableFileStream Methods

| Method | Description |
|--------|-------------|
| `write(data)` | Write string, ArrayBuffer, or Blob |
| `seek(position)` | Move write position |
| `truncate(size)` | Resize file |
| `close()` | Commit changes and close |

### createSyncAccessHandle()

Creates a synchronous access handle (workers only).

```typescript
const handle = await fileHandle.createSyncAccessHandle();

// Read into buffer
const buffer = new ArrayBuffer(1024);
const bytesRead = handle.read(buffer, { at: 0 });

// Write buffer
handle.write(new Uint8Array([1, 2, 3]), { at: 0 });

// Flush and close
handle.flush();
handle.close();
```

---

## Common Patterns

### Serving Static Files

```typescript
addEventListener("fetch", (event) => {
  event.respondWith(
    (async () => {
      const url = new URL(event.request.url);
      const publicDir = await directories.open("public");

      try {
        const fileHandle = await publicDir.getFileHandle(url.pathname.slice(1));
        const file = await fileHandle.getFile();
        return new Response(file, {
          headers: { "Content-Type": file.type },
        });
      } catch {
        return new Response("Not Found", { status: 404 });
      }
    })()
  );
});
```

### File Uploads

```typescript
addEventListener("fetch", (event) => {
  if (event.request.method === "POST" && url.pathname === "/upload") {
    event.respondWith(
      (async () => {
        const formData = await event.request.formData();
        const file = formData.get("file") as File;

        const uploads = await directories.open("uploads");
        const handle = await uploads.getFileHandle(file.name, { create: true });
        const writable = await handle.createWritable();
        await writable.write(await file.arrayBuffer());
        await writable.close();

        return new Response("Uploaded", { status: 201 });
      })()
    );
  }
});
```

### JSON Configuration Files

```typescript
async function loadConfig() {
  const configDir = await directories.open("server");
  const handle = await configDir.getFileHandle("config.json");
  const file = await handle.getFile();
  return JSON.parse(await file.text());
}

async function saveConfig(config: object) {
  const configDir = await directories.open("server");
  const handle = await configDir.getFileHandle("config.json", { create: true });
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(config, null, 2));
  await writable.close();
}
```

### Recursive Directory Listing

```typescript
async function* listFiles(
  dir: FileSystemDirectoryHandle,
  path = ""
): AsyncGenerator<string> {
  for await (const [name, handle] of dir.entries()) {
    const fullPath = path ? `${path}/${name}` : name;
    if (handle.kind === "file") {
      yield fullPath;
    } else {
      yield* listFiles(handle, fullPath);
    }
  }
}

// Usage
const uploads = await directories.open("uploads");
for await (const file of listFiles(uploads)) {
  console.log(file);
}
```

---

## Available Implementations

### Node.js FileSystem

Uses native Node.js `fs` module.

```json
{
  "directories": {
    "data": {
      "module": "@b9g/filesystem/node-fs",
      "export": "NodeFSDirectory",
      "path": "./data"
    }
  }
}
```

### Bun FileSystem

Uses native Bun file APIs.

```json
{
  "directories": {
    "data": {
      "module": "@b9g/filesystem/bun",
      "path": "./data"
    }
  }
}
```

### Memory FileSystem

In-memory storage. Data is lost on restart.

```json
{
  "directories": {
    "temp": {
      "module": "@b9g/filesystem/memory"
    }
  }
}
```

### S3 FileSystem

Amazon S3 or S3-compatible storage.

```json
{
  "directories": {
    "uploads": {
      "module": "@b9g/filesystem-s3",
      "bucket": "$S3_BUCKET",
      "region": "$AWS_REGION || us-east-1",
      "endpoint": "$S3_ENDPOINT"
    }
  }
}
```

### Cloudflare R2

Cloudflare R2 object storage.

```json
{
  "directories": {
    "uploads": {
      "binding": "UPLOADS_BUCKET"
    }
  }
}
```

### Cloudflare Assets

Read-only static assets (Cloudflare Workers Sites).

```json
{
  "directories": {
    "static": {
      "binding": "ASSETS"
    }
  }
}
```

---

## TypeScript

Shovel generates type definitions for your configured directories. After running `shovel build`, directory names are type-checked:

```typescript
// OK - configured directory
const uploads = await directories.open("uploads");

// Type error - unconfigured directory
const unknown = await directories.open("not-configured");
```

---

## See Also

- [shovel.json](./shovel-json.md) - Full configuration reference
- [Caches](./caches.md) - Request/Response caching
- [Databases](./databases.md) - SQL database storage
