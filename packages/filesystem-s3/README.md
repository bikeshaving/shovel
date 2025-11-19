# @b9g/filesystem-s3

AWS S3 implementation of the File System Access API. Provides standards-compliant file system operations backed by Amazon S3 object storage.

## Features

- File System Access API implementation for S3
- DirectoryHandle and FileHandle interfaces
- Streaming read/write support
- Compatible with @b9g/filesystem abstractions

## Installation

```bash
npm install @b9g/filesystem-s3 @aws-sdk/client-s3
```

## Usage

```javascript
import { S3Client } from '@aws-sdk/client-s3';
import { S3Bucket } from '@b9g/filesystem-s3';

const s3Client = new S3Client({
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

const bucket = new S3Bucket(s3Client, 'my-bucket-name');

// Get file handle
const fileHandle = await bucket.getFileHandle('data/config.json');
const file = await fileHandle.getFile();
const config = JSON.parse(await file.text());

// Write file
const writable = await fileHandle.createWritable();
await writable.write(JSON.stringify({ updated: true }));
await writable.close();
```

## API

### `new S3Bucket(s3Client, bucketName, options?)`

Creates a new S3 bucket adapter.

**Parameters:**
- `s3Client`: AWS S3Client instance
- `bucketName`: S3 bucket name
- `options`: Optional configuration (prefix, etc.)

### Methods

Implements the File System Access API:

- `getFileHandle(path, options)`: Get a file handle
- `getDirectoryHandle(path, options)`: Get a directory handle
- `removeEntry(name, options)`: Remove a file or directory
- `entries()`: Async iterator over directory entries

## License

MIT
