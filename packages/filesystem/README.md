# @b9g/filesystem

Universal filesystem abstraction with multiple backend implementations for different runtimes and storage systems.

## Features

- **Universal API**: Same interface across Node.js, Bun, browsers, and edge platforms
- **Multiple Backends**: Memory, Node.js fs, Bun, S3, R2, and more
- **Registry Pattern**: Register filesystem implementations by name
- **Async/Await**: Promise-based API throughout
- **Directory Handles**: File System Access API compatible

## Installation

```bash
npm install @b9g/filesystem
```

## Quick Start

```javascript
import { FilesystemRegistry, MemoryFilesystem } from '@b9g/filesystem';

// Create registry
const registry = new FilesystemRegistry();

// Register backends
registry.register('memory', () => new MemoryFilesystem());
registry.register('temp', () => new NodeFilesystem('/tmp'));

// Get filesystem
const fs = await registry.get('memory');

// Create directory
const dir = await fs.getDirectoryHandle('projects', { create: true });

// Create file
const file = await dir.getFileHandle('readme.txt', { create: true });

// Write content
const writable = await file.createWritable();
await writable.write('Hello World!');
await writable.close();

// Read content
const fileData = await file.getFile();
const text = await fileData.text();
console.log(text); // 'Hello World!'
```

## Filesystem Implementations

### MemoryFilesystem

In-memory filesystem for testing and temporary storage:

```javascript
import { MemoryFilesystem } from '@b9g/filesystem';

const fs = new MemoryFilesystem();
```

### NodeFilesystem

Node.js filesystem backend:

```javascript
import { NodeFilesystem } from '@b9g/filesystem';

const fs = new NodeFilesystem('/app/data');
```

### BunS3Filesystem  

Bun with S3-compatible storage:

```javascript
import { BunS3Filesystem } from '@b9g/filesystem';

const fs = new BunS3Filesystem({
  bucket: 'my-bucket',
  region: 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});
```

## Registry Usage

```javascript
import { 
  FilesystemRegistry,
  MemoryFilesystem,
  NodeFilesystem
} from '@b9g/filesystem';

const registry = new FilesystemRegistry();

// Register implementations
registry.register('memory', () => new MemoryFilesystem());
registry.register('local', () => new NodeFilesystem('./data'));
registry.register('temp', () => new NodeFilesystem('/tmp'));

// Use by name
const memFs = await registry.get('memory');
const localFs = await registry.get('local');
```

## File System Access API

Compatible with the File System Access API:

```javascript
// Get directory handle
const dirHandle = await fs.getDirectoryHandle('uploads', { create: true });

// List directory contents
for await (const [name, handle] of dirHandle.entries()) {
  if (handle.kind === 'file') {
    console.log(`File: ${name}`);
  } else {
    console.log(`Directory: ${name}`);
  }
}

// Get file handle
const fileHandle = await dirHandle.getFileHandle('data.json', { create: true });

// Check if exists
try {
  await dirHandle.getFileHandle('missing.txt');
} catch (error) {
  console.log('File does not exist');
}

// Remove file
await dirHandle.removeEntry('old-file.txt');

// Remove directory
await dirHandle.removeEntry('old-dir', { recursive: true });
```

## File Operations

### Writing Files

```javascript
// Get file handle
const file = await dir.getFileHandle('config.json', { create: true });

// Create writable stream
const writable = await file.createWritable();

// Write data
await writable.write(JSON.stringify({ setting: 'value' }));
await writable.close();

// Or write all at once
await writable.write(new Blob(['Hello World']));
await writable.close();
```

### Reading Files

```javascript
// Get file handle
const file = await dir.getFileHandle('config.json');

// Get file object
const fileData = await file.getFile();

// Read as text
const text = await fileData.text();

// Read as JSON
const json = JSON.parse(text);

// Read as ArrayBuffer
const buffer = await fileData.arrayBuffer();

// Read as stream
const stream = fileData.stream();
```

## Shovel Configuration

When used with Shovel, directories are configured in `shovel.json`. The built-in names `server`, `public`, and `tmp` have platform defaults. Custom directory names require an explicit `module`:

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

The `path` field is resolved relative to the project root. Paths outside the project (e.g. `"../docs"`) are supported — the root path itself is unrestricted, while directory traversal within opened directories is blocked at the filesystem level.

Access configured directories via the global `self.directories`:

```typescript
const uploads = await self.directories.open("uploads");
```

## Integration Examples

### Cache Storage

```javascript
import { FilesystemRegistry, NodeFilesystem } from '@b9g/filesystem';

const registry = new FilesystemRegistry();
registry.register('cache', () => new NodeFilesystem('./cache'));

// Use with cache
const fs = await registry.get('cache');
const cacheDir = await fs.getDirectoryHandle('pages', { create: true });

// Store cached response
const file = await cacheDir.getFileHandle('index.html', { create: true });
const writable = await file.createWritable();
await writable.write('<html>...</html>');
await writable.close();
```

### Asset Pipeline

```javascript
// Static assets filesystem
registry.register('assets', () => new NodeFilesystem('./dist/assets'));

const assets = await registry.get('assets');
const staticDir = await assets.getDirectoryHandle('static', { create: true });

// Copy build assets
for (const asset of buildAssets) {
  const file = await staticDir.getFileHandle(asset.name, { create: true });
  const writable = await file.createWritable();
  await writable.write(asset.content);
  await writable.close();
}
```

### Upload Handling

```javascript
router.post('/upload', async (request) => {
  const formData = await request.formData();
  const file = formData.get('file');
  
  if (file) {
    const uploads = await registry.get('uploads');
    const uploadsDir = await uploads.getDirectoryHandle('files', { create: true });
    
    const fileHandle = await uploadsDir.getFileHandle(file.name, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(await file.arrayBuffer());
    await writable.close();
    
    return Response.json({ success: true, filename: file.name });
  }
  
  return BadRequest('No file provided');
});
```

## Exports

### Classes

- `ShovelFileHandle` - FileSystemFileHandle implementation
- `ShovelDirectoryHandle` - FileSystemDirectoryHandle implementation
- `ShovelHandle` - Base handle class
- `CustomDirectoryStorage` - Directory storage with custom backend factories

### Types

- `Directory` - Alias for FileSystemDirectoryHandle
- `DirectoryStorage` - Interface for directory storage (`open(name): Promise<FileSystemDirectoryHandle>`)
- `DirectoryFactory` - Factory function type for creating directory backends
- `FileSystemConfig` - Configuration for filesystem backends
- `FileSystemPermissionDescriptor` - Permission descriptor type
- `FileSystemBackend` - Backend interface for filesystem implementations

## API Reference

### DirectoryStorage

```typescript
interface DirectoryStorage {
  open(name: string): Promise<FileSystemDirectoryHandle>;
}

class CustomDirectoryStorage implements DirectoryStorage {
  register(name: string, factory: DirectoryFactory): void;
  open(name: string): Promise<FileSystemDirectoryHandle>;
}
```

### FileSystemHandle Interface

```typescript
interface FileSystemDirectoryHandle {
  kind: 'directory';
  name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  entries(): AsyncIterableIterator<[string, FileSystemDirectoryHandle | FileSystemFileHandle]>;
  keys(): AsyncIterableIterator<string>;
  values(): AsyncIterableIterator<FileSystemDirectoryHandle | FileSystemFileHandle>;
}

interface FileSystemFileHandle {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<FileSystemWritableFileStream>;
}
```

## Backend-Specific Options

### S3 Configuration

```javascript
import { BunS3Filesystem } from '@b9g/filesystem';

const s3fs = new BunS3Filesystem({
  bucket: 'my-bucket',
  region: 'us-west-2',
  endpoint: 'https://s3.us-west-2.amazonaws.com',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  pathStyle: false,
  prefix: 'app-data/'
});
```

### Memory Options

```javascript
import { MemoryFilesystem } from '@b9g/filesystem';

const memfs = new MemoryFilesystem({
  maxSize: 100 * 1024 * 1024, // 100MB limit
  caseSensitive: true
});
```

## Error Handling

```javascript
try {
  const file = await dir.getFileHandle('missing.txt');
} catch (error) {
  if (error.name === 'NotFoundError') {
    console.log('File not found');
  } else {
    console.error('Unexpected error:', error);
  }
}

// Check before accessing
const exists = await dir.getFileHandle('data.txt')
  .then(() => true)
  .catch(() => false);
```

## License

MIT