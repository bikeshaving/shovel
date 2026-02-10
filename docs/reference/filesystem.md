# @b9g/filesystem

[File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API) implementation for servers.

---

## DirectoryStorage

Global `self.directories` provides access to configured directories.

### open(name: string): Promise\<FileSystemDirectoryHandle\>

Opens a named directory.

```typescript
const uploads = await self.directories.open("uploads");
```

---

## FileSystemDirectoryHandle

Implements [FileSystemDirectoryHandle](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemDirectoryHandle).

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `kind` | `"directory"` | Always `"directory"` |
| `name` | `string` | Directory name |

### getFileHandle(name: string, options?: { create?: boolean }): Promise\<FileSystemFileHandle\>

Gets a file handle within the directory.

```typescript
const file = await dir.getFileHandle("config.json");
const file = await dir.getFileHandle("new.txt", { create: true });
```

### getDirectoryHandle(name: string, options?: { create?: boolean }): Promise\<FileSystemDirectoryHandle\>

Gets a subdirectory handle.

```typescript
const subdir = await dir.getDirectoryHandle("images");
const subdir = await dir.getDirectoryHandle("cache", { create: true });
```

### removeEntry(name: string, options?: { recursive?: boolean }): Promise\<void\>

Removes a file or directory.

```typescript
await dir.removeEntry("old.txt");
await dir.removeEntry("old-folder", { recursive: true });
```

### entries(): AsyncIterableIterator\<[string, FileSystemHandle]\>

Iterates over directory contents.

```typescript
for await (const [name, handle] of dir.entries()) {
  console.log(name, handle.kind);
}
```

### keys(): AsyncIterableIterator\<string\>

Iterates over entry names.

```typescript
for await (const name of dir.keys()) {
  console.log(name);
}
```

### values(): AsyncIterableIterator\<FileSystemHandle\>

Iterates over entry handles.

```typescript
for await (const handle of dir.values()) {
  console.log(handle.name);
}
```

### resolve(possibleDescendant: FileSystemHandle): Promise\<string[] | null\>

Returns the path from this directory to a descendant.

```typescript
const path = await dir.resolve(subdir);
// ["a", "b", "c"]
```

### isSameEntry(other: FileSystemHandle): Promise\<boolean\>

Checks if two handles reference the same entry.

```typescript
await file1.isSameEntry(file2); // true
```

---

## FileSystemFileHandle

Implements [FileSystemFileHandle](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle).

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `kind` | `"file"` | Always `"file"` |
| `name` | `string` | File name |

### getFile(): Promise\<File\>

Returns the file as a [File](https://developer.mozilla.org/en-US/docs/Web/API/File) object.

```typescript
const file = await fileHandle.getFile();
const text = await file.text();
```

### createWritable(options?: { keepExistingData?: boolean }): Promise\<FileSystemWritableFileStream\>

Creates a writable stream for writing to the file.

```typescript
const writable = await fileHandle.createWritable();
await writable.write("Hello, World!");
await writable.close();
```

### createSyncAccessHandle(): Promise\<FileSystemSyncAccessHandle\>

Creates a synchronous access handle (workers only).

```typescript
const handle = await fileHandle.createSyncAccessHandle();
const bytesRead = handle.read(buffer, { at: 0 });
handle.close();
```

---

## FileSystemWritableFileStream

### write(data: string | BufferSource | Blob | WriteParams): Promise\<void\>

Writes data to the file.

### seek(position: number): Promise\<void\>

Moves the write position.

### truncate(size: number): Promise\<void\>

Resizes the file.

### close(): Promise\<void\>

Commits changes and closes the stream.

---

## Configuration

Configure in `shovel.json`:

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

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `module` | `string` | Module path |
| `export` | `string` | Named export (default: `"default"`) |
| `path` | `string` | Filesystem path (relative to project root, or absolute) |
| `binding` | `string` | Platform binding (Cloudflare) |
| `bucket` | `string` | S3 bucket name |
| `region` | `string` | AWS region |
| `endpoint` | `string` | S3-compatible endpoint |

### Built-in Directories

The names `server`, `public`, and `tmp` are provided by the platform and do not require `module` or `export`:

| Name | Path | Description |
|------|------|-------------|
| `server` | `[outdir]/server` | Server-side bundled code |
| `public` | `[outdir]/public` | Static assets |
| `tmp` | `[tmpdir]` | Temporary files |

### Custom Directories

Any other directory name requires an explicit `module` and optionally `export`. The `path` field is resolved relative to the project root. Paths outside the project are supported:

```json
{
  "directories": {
    "uploads": {
      "module": "@b9g/filesystem/node-fs",
      "path": "./uploads"
    },
    "docs": {
      "module": "@b9g/filesystem/node-fs",
      "path": "../docs"
    }
  }
}
```

Once configured, access directories using the standard API:

```typescript
const docs = await self.directories.open("docs");
for await (const [name, handle] of docs.entries()) {
  console.log(name, handle.kind);
}
```

Directory traversal within opened directories is blocked at the filesystem level — only the configured root path itself can point outside the project.

---

## Implementations

| Module | Description |
|--------|-------------|
| `@b9g/filesystem/node-fs` | Node.js native fs |
| `@b9g/filesystem/bun` | Bun native file APIs |
| `@b9g/filesystem/memory` | In-memory (lost on restart) |
| `@b9g/filesystem-s3` | Amazon S3 / S3-compatible |

---

## See Also

- [shovel.json](./shovel-json.md) - Configuration reference
- [Cache](./cache.md) - Request/Response caching
- [ZenDB](./zen.md) - SQL database storage

