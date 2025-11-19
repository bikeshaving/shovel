# @b9g/filesystem-r2

Cloudflare R2 implementation of the File System Access API. Provides standards-compliant file system operations backed by Cloudflare R2 object storage.

## Features

- File System Access API implementation for R2
- DirectoryHandle and FileHandle interfaces
- Streaming read/write support
- Compatible with @b9g/filesystem abstractions

## Installation

```bash
npm install @b9g/filesystem-r2
```

## Usage

```javascript
import { R2Bucket } from '@b9g/filesystem-r2';

// In Cloudflare Workers
export default {
  async fetch(request, env, ctx) {
    const bucket = new R2Bucket(env.MY_BUCKET);

    // Get file handle
    const fileHandle = await bucket.getFileHandle('data/config.json');
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

## API

### `new R2Bucket(binding)`

Creates a new R2 bucket adapter from a Cloudflare R2 binding.

### Methods

Implements the File System Access API:

- `getFileHandle(path, options)`: Get a file handle
- `getDirectoryHandle(path, options)`: Get a directory handle
- `removeEntry(name, options)`: Remove a file or directory
- `entries()`: Async iterator over directory entries

### Wrangler Configuration

```toml
[[r2_buckets]]
binding = "MY_BUCKET"
bucket_name = "my-bucket-name"
```

## License

MIT
