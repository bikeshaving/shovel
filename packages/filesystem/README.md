# @b9g/filesystem

[File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API) implementations for server-side runtimes. Provides `FileSystemDirectoryHandle` and `FileSystemFileHandle` backed by local disk, memory, or S3-compatible storage.

## Installation

```bash
npm install @b9g/filesystem
```

## Backends

Each backend is a separate entry point:

### Node.js / Bun local filesystem

```typescript
import {NodeFSDirectory} from "@b9g/filesystem/node-fs";

const dir = new NodeFSDirectory("data", {path: "./data"});
```

### In-memory

```typescript
import {MemoryDirectory} from "@b9g/filesystem/memory";

const dir = new MemoryDirectory();
```

### Bun S3

```typescript
import {S3Directory} from "@b9g/filesystem/bun-s3";

const dir = new S3Directory("uploads", {
  bucket: "my-bucket",
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});
```

## Usage

All backends implement the standard `FileSystemDirectoryHandle` interface:

```typescript
// Create a directory
const subdir = await dir.getDirectoryHandle("uploads", {create: true});

// Create and write a file
const file = await subdir.getFileHandle("readme.txt", {create: true});
const writable = await file.createWritable();
await writable.write("Hello World!");
await writable.close();

// Read a file
const fileData = await file.getFile();
const text = await fileData.text();

// List entries
for await (const [name, handle] of dir.entries()) {
  console.log(name, handle.kind); // "file" or "directory"
}

// Remove entries
await dir.removeEntry("old-file.txt");
await dir.removeEntry("old-dir", {recursive: true});
```

## Shovel Configuration

When used with Shovel, directories are configured in `shovel.json`:

```json
{
  "directories": {
    "uploads": {
      "module": "@b9g/filesystem/node-fs",
      "export": "NodeFSDirectory",
      "path": "./uploads"
    }
  }
}
```

The `path` field is resolved relative to the project root. Access configured directories via `self.directories`:

```typescript
const uploads = await self.directories.open("uploads");
```

## CustomDirectoryStorage

The main entry point exports `CustomDirectoryStorage`, a registry for named directories with lazy instantiation:

```typescript
import {CustomDirectoryStorage} from "@b9g/filesystem";
import {NodeFSDirectory} from "@b9g/filesystem/node-fs";

const directories = new CustomDirectoryStorage((name) => {
  return new NodeFSDirectory(name, {path: `./data/${name}`});
});

const uploads = await directories.open("uploads");
const tmp = await directories.open("tmp");
```

## Custom Backends

Implement the `FileSystemBackend` interface to create custom storage backends:

```typescript
import {type FileSystemBackend, ShovelDirectoryHandle} from "@b9g/filesystem";

class MyBackend implements FileSystemBackend {
  async stat(path: string) { /* ... */ }
  async readFile(path: string) { /* ... */ }
  async writeFile(path: string, data: Uint8Array) { /* ... */ }
  async listDir(path: string) { /* ... */ }
  async createDir?(path: string) { /* ... */ }
  async remove?(path: string, recursive?: boolean) { /* ... */ }
}

const dir = new ShovelDirectoryHandle(new MyBackend(), "/");
```

## Exports

### Main (`@b9g/filesystem`)

- `ShovelHandle` - Abstract base handle class
- `ShovelFileHandle` - `FileSystemFileHandle` implementation
- `ShovelDirectoryHandle` - `FileSystemDirectoryHandle` implementation
- `CustomDirectoryStorage` - Named directory registry

### Types

- `FileSystemBackend` - Backend interface for custom implementations
- `FileSystemConfig` - Configuration interface
- `FileSystemPermissionDescriptor` - Permission descriptor
- `DirectoryStorage` - Directory storage interface (`open`, `has`, `delete`, `keys`)
- `DirectoryFactory` - Factory function type `(name: string) => FileSystemDirectoryHandle`

### `@b9g/filesystem/node-fs`

- `NodeFSDirectory` - Local filesystem directory (Node.js/Bun)
- `NodeFSBackend` - Local filesystem backend

### `@b9g/filesystem/memory`

- `MemoryDirectory` - In-memory directory
- `MemoryFileSystemBackend` - In-memory backend

### `@b9g/filesystem/bun-s3`

- `S3Directory` - S3-compatible storage directory
- `S3FileSystemBackend` - S3 storage backend

## License

MIT
