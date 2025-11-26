# @b9g/filesystem-r2

Cloudflare R2 implementation of the File System Access API. Provides standards-compliant file system operations backed by Cloudflare R2 object storage.

## Features

- File System Access API implementation for R2
- FileSystemDirectoryHandle and FileSystemFileHandle interfaces
- Streaming read/write via WritableStream
- Compatible with @b9g/filesystem abstractions
- Works in Cloudflare Workers environment

## Installation

```bash
npm install @b9g/filesystem-r2 @b9g/filesystem
```

## Usage

```javascript
import {
  R2FileSystemDirectoryHandle,
  R2FileSystemFileHandle,
  R2FileSystemAdapter
} from '@b9g/filesystem-r2';

// In Cloudflare Workers
export default {
  async fetch(request, env, ctx) {
    // Create directory handle from R2 binding
    const rootDir = new R2FileSystemDirectoryHandle(env.MY_BUCKET, '');

    // Get file handle
    const fileHandle = await rootDir.getFileHandle('data/config.json');
    const file = await fileHandle.getFile();
    const config = JSON.parse(await file.text());

    // Write file
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify({ updated: true }));
    await writable.close();

    return new Response('OK');
  }
};
```

## Exports

### Classes

- `R2FileSystemDirectoryHandle` - FileSystemDirectoryHandle for R2
- `R2FileSystemFileHandle` - FileSystemFileHandle for R2
- `R2FileSystemWritableFileStream` - WritableStream for R2
- `R2FileSystemAdapter` - Backend adapter for @b9g/filesystem

## API

### `R2FileSystemDirectoryHandle`

Implements `FileSystemDirectoryHandle` for R2.

**Constructor:** `new R2FileSystemDirectoryHandle(r2Bucket: R2Bucket, prefix: string)`

**Methods:**
- `getFileHandle(name, options)`: Get a file handle
- `getDirectoryHandle(name, options)`: Get a subdirectory handle
- `removeEntry(name, options)`: Remove a file or directory
- `entries()`: Async iterator over directory entries
- `keys()`: Async iterator over entry names
- `values()`: Async iterator over entry handles

### `R2FileSystemFileHandle`

Implements `FileSystemFileHandle` for R2.

**Methods:**
- `getFile()`: Get the file as a File object
- `createWritable()`: Create a writable stream for the file

### `R2FileSystemAdapter`

Backend adapter for `@b9g/filesystem` registry.

**Constructor:** `new R2FileSystemAdapter(r2Bucket: R2Bucket, config?: FileSystemConfig)`

### Wrangler Configuration

```toml
[[r2_buckets]]
binding = "MY_BUCKET"
bucket_name = "my-bucket-name"
```

## License

MIT
