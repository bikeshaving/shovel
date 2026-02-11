# @b9g/filesystem-s3

AWS S3 implementation of the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API). Provides standards-compliant file system operations backed by Amazon S3 object storage.

## Features

- Full `FileSystemDirectoryHandle` and `FileSystemFileHandle` implementation
- Streaming writes via `WritableStream`
- Directory simulation using S3 key prefixes
- MIME type detection via the `mime` package
- Compatible with `@b9g/filesystem` registry for pluggable backends
- Requires `@aws-sdk/client-s3` v3 as a peer dependency

## Installation

```bash
npm install @b9g/filesystem-s3 @aws-sdk/client-s3
```

## Usage

### Direct Usage

```typescript
import {S3Client} from "@aws-sdk/client-s3";
import {S3FileSystemDirectoryHandle} from "@b9g/filesystem-s3";

const s3 = new S3Client({region: "us-east-1"});
const root = new S3FileSystemDirectoryHandle(s3, "my-bucket", "");

// Read a file
const fileHandle = await root.getFileHandle("config.json");
const file = await fileHandle.getFile();
const text = await file.text();

// Write a file
const writable = await fileHandle.createWritable();
await writable.write(JSON.stringify({updated: true}));
await writable.close();

// Create a directory
const dir = await root.getDirectoryHandle("uploads", {create: true});

// List entries
for await (const [name, handle] of root.entries()) {
  console.log(name, handle.kind); // "file" or "directory"
}

// Delete (recursive for directories)
await root.removeEntry("uploads", {recursive: true});
```

### With Shovel Filesystem Registry

```typescript
import {S3FileSystemAdapter} from "@b9g/filesystem-s3";

// In shovel.json directories config:
// { module: "@b9g/filesystem-s3", export: "S3FileSystemAdapter" }
```

The `S3FileSystemAdapter` integrates with Shovel's directory system. Each named directory gets an isolated prefix (`filesystems/{name}`) within the bucket.

## Exports

- **`S3FileSystemDirectoryHandle`** -- `FileSystemDirectoryHandle` backed by S3 key prefixes
- **`S3FileSystemFileHandle`** -- `FileSystemFileHandle` backed by S3 objects
- **`S3FileSystemWritableFileStream`** -- `WritableStream` that buffers chunks and uploads on close
- **`S3FileSystemAdapter`** -- Backend adapter for `@b9g/filesystem` registry

## API

### `new S3FileSystemDirectoryHandle(s3Client, bucket, prefix)`

| Parameter | Type | Description |
|-----------|------|-------------|
| `s3Client` | `S3Client` | AWS SDK v3 S3 client |
| `bucket` | `string` | S3 bucket name |
| `prefix` | `string` | Key prefix (e.g. `"uploads/"` or `""` for root) |

Standard `FileSystemDirectoryHandle` methods: `getFileHandle()`, `getDirectoryHandle()`, `removeEntry()`, `entries()`, `keys()`, `values()`, `isSameEntry()`.

### `new S3FileSystemFileHandle(s3Client, bucket, key)`

| Parameter | Type | Description |
|-----------|------|-------------|
| `s3Client` | `S3Client` | AWS SDK v3 S3 client |
| `bucket` | `string` | S3 bucket name |
| `key` | `string` | Full S3 object key |

Standard `FileSystemFileHandle` methods: `getFile()`, `createWritable()`, `isSameEntry()`.

### `new S3FileSystemAdapter(s3Client, bucket, config?)`

| Parameter | Type | Description |
|-----------|------|-------------|
| `s3Client` | `S3Client` | AWS SDK v3 S3 client |
| `bucket` | `string` | S3 bucket name |
| `config` | `FileSystemConfig?` | Optional filesystem config |

Methods: `getFileSystemRoot(name?)`, `getConfig()`, `dispose()`.

## Implementation Notes

- **Directories are simulated** -- S3 has no native directories. Subdirectories use key prefixes, and `getDirectoryHandle({create: true})` creates a `.shovel_directory_marker` object.
- **Writes are buffered** -- `createWritable()` accumulates all chunks in memory and uploads in a single `PutObjectCommand` on `close()`.
- **Permissions always granted** -- S3 access is controlled by AWS credentials, so `queryPermission()` / `requestPermission()` always return `"granted"`.
- **`resolve()` not implemented** -- Returns `null` (not meaningful for flat S3 key spaces).

## License

MIT
