# @b9g/filesystem-s3

AWS S3 implementation of the File System Access API. Provides standards-compliant file system operations backed by Amazon S3 object storage.

## Features

- File System Access API implementation for S3
- FileSystemDirectoryHandle and FileSystemFileHandle interfaces
- Streaming read/write via WritableStream
- Compatible with @b9g/filesystem abstractions
- Uses AWS SDK v3 for S3 operations

## Installation

```bash
npm install @b9g/filesystem-s3 @b9g/filesystem @aws-sdk/client-s3
```

## Usage

```javascript
import { S3Client } from '@aws-sdk/client-s3';
import {
  S3FileSystemDirectoryHandle,
  S3FileSystemFileHandle,
  S3FileSystemAdapter
} from '@b9g/filesystem-s3';

const s3Client = new S3Client({
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

// Create directory handle
const rootDir = new S3FileSystemDirectoryHandle(s3Client, 'my-bucket-name', '');

// Get file handle
const fileHandle = await rootDir.getFileHandle('data/config.json');
const file = await fileHandle.getFile();
const config = JSON.parse(await file.text());

// Write file
const writable = await fileHandle.createWritable();
await writable.write(JSON.stringify({ updated: true }));
await writable.close();
```

## API

### Module Exports

```javascript
// Named exports
import {
  S3FileSystemWritableFileStream,
  S3FileSystemFileHandle,
  S3FileSystemDirectoryHandle,
  S3FileSystemAdapter
} from '@b9g/filesystem-s3';
```

### `S3FileSystemDirectoryHandle`

Implements `FileSystemDirectoryHandle` for S3.

**Constructor:** `new S3FileSystemDirectoryHandle(s3Client: S3Client, bucket: string, prefix: string)`

**Methods:**
- `getFileHandle(name, options)`: Get a file handle
- `getDirectoryHandle(name, options)`: Get a subdirectory handle
- `removeEntry(name, options)`: Remove a file or directory
- `entries()`: Async iterator over directory entries
- `keys()`: Async iterator over entry names
- `values()`: Async iterator over entry handles

### `S3FileSystemFileHandle`

Implements `FileSystemFileHandle` for S3.

**Constructor:** `new S3FileSystemFileHandle(s3Client: S3Client, bucket: string, key: string)`

**Methods:**
- `getFile()`: Get the file as a File object
- `createWritable()`: Create a writable stream for the file

### `S3FileSystemAdapter`

Backend adapter for `@b9g/filesystem` registry.

**Constructor:** `new S3FileSystemAdapter(s3Client: S3Client, bucket: string, config?: FileSystemConfig)`

## License

MIT
