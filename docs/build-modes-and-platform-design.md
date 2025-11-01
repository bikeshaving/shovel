# Build Modes & Platform Design

## Overview

Shovel supports three distinct build modes with clean separation of concerns:
- **Development**: Client-only builds with VM-based server execution
- **SSG**: Static site generation with HTML output 
- **Production**: Full server deployment artifacts

## Build Modes

### Development Mode
- **Purpose**: Fast iteration with hot reloading
- **Server**: VM-based execution (memory-only, no artifacts)
- **Output**: Client assets only

```
dist/
├── assets/
│   ├── index-abc123.js    # Hashed client bundle
│   ├── style-def456.css   # Hashed client CSS
│   └── favicon.ico
└── manifest.json
```

### SSG Mode
- **Purpose**: Static site generation
- **Server**: VM-based execution for route collection
- **Output**: Client assets + generated HTML

```
dist/
├── index.html             # Generated during activate
├── about.html             # Generated during activate
├── assets/
│   ├── index-abc123.js    # Client bundle
│   ├── style-def456.css   # Client CSS
│   └── favicon.ico
└── manifest.json
```

### Production Mode
- **Purpose**: Server deployment
- **Server**: Full build with deployment artifacts
- **Output**: Client assets + server artifacts + deployment metadata

```
dist/
├── assets/               # Client assets
│   ├── index-abc123.js   
│   ├── style-def456.css  
│   └── favicon.ico
├── server/               # Server artifacts for deployment
│   └── app.js           # Server entrypoint
├── package.json         # Production deployment metadata
└── manifest.json        # Asset manifest
```

## Platform Configuration

### CLI Flags with Blessed Aliases

```bash
# Cache adapters
shovel dev --cache memory    # @b9g/cache (PostMessage-based)
shovel dev --cache redis     # @b9g/cache-redis
shovel dev --cache kv        # @b9g/cache-kv (Cloudflare)

# Filesystem adapters  
shovel dev --filesystem memory  # @b9g/filesystem (in-memory)
shovel dev --filesystem fs      # @b9g/filesystem-node (local files)
shovel dev --filesystem s3      # @b9g/filesystem-s3
shovel dev --filesystem r2      # @b9g/filesystem-r2 (Cloudflare)

# Third-party adapters
shovel dev --cache @custom/cache
shovel dev --filesystem @acme/storage
```

### Filesystem Organization

#### Local Development (--filesystem fs)
```
project-root/
├── dist/              # Build artifacts (platform.distDir)
├── .buckets/          # Local filesystem buckets (gitignored)
│   ├── static-files/
│   ├── user-uploads/
│   └── app-data/
└── .gitignore
```

#### Cloud Production
- `platform.getFileSystemRoot('static-files')` → `s3://static-files` bucket
- `platform.getFileSystemRoot('user-uploads')` → `s3://user-uploads` bucket

## Platform API

### Install-time vs Runtime Access

```typescript
// Install handler (build/deployment)
const distFs = platform.distDir;  // ✅ Available - build artifacts
const staticFs = await platform.getFileSystemRoot('static-files');

// Copy built assets to deployment storage
for await (const [name, file] of distFs.entries()) {
  // Copy file to staticFs
}
```

```typescript
// Runtime request handler
const staticFs = await platform.getFileSystemRoot('static-files'); // ✅ Available
const distFs = platform.distDir; // ❌ Throws error - not available at runtime
```

### Platform Interface

```typescript
interface Platform {
  readonly name: string;
  readonly distDir: FileSystemDirectoryHandle; // Install-time only
  
  loadServiceWorker(entrypoint: string, options?: ServiceWorkerOptions): Promise<ServiceWorkerInstance>;
  createCaches(config?: CacheConfig): Promise<CacheStorage>;
  createServer(handler: Handler, options?: ServerOptions): Server;
  getFileSystemRoot(bucketName: string): Promise<FileSystemDirectoryHandle>;
}
```

## Asset Pipeline Integration

### Client Assets
- All client assets go to `/assets/` with content hashing
- Manifest maps logical names to hashed filenames
- Standard bundling with optimization

### SSG Integration
- HTML generated directly to `dist/` root during activate phase
- Enables `http-server dist/` for simple static serving
- No special directories - flat structure for simplicity

### Static Files Serving Priority
1. SSG-generated HTML (`dist/*.html`)
2. Client assets (`dist/assets/`)
3. Fallback to application for dynamic routes

## VM Execution (Development)

### Benefits
- No server artifacts pollution in `dist/`
- Fast development iteration
- Enables SSG without filesystem complexity
- Memory-only execution

### Implementation
```typescript
// Bundle ServiceWorker to memory string
const serviceWorkerCode = await bundle('./src/app.js', { target: 'node' });

// Execute in VM context
const vm = new VM();
vm.run(serviceWorkerCode);

// Run SSG during activate
await vm.call('activate');
```

## Production Deployment

### Self-contained Package
The production `dist/` becomes a complete Node.js deployment package:

```json
{
  "name": "my-app-production",
  "type": "module", 
  "main": "server/app.js",
  "engines": {
    "node": ">=18"
  },
  "dependencies": {
    "@b9g/platform-node": "^1.0.0"
  }
}
```

### Deployment Process
1. `shovel build --cache redis --filesystem s3`
2. Copy `dist/` to server
3. `npm install && node server/app.js`

## Implementation Plan

### 1. Platform Interface Updates
- [x] Rename `platform.dist` to `platform.distDir`
- [x] Add blessed aliases for filesystem adapters
- [x] Implement dynamic adapter loading

### 2. Build Mode Implementation
- [ ] VM-based development execution
- [ ] SSG HTML generation to dist root
- [ ] Production package.json generation

### 3. Filesystem Organization
- [ ] Add `fs` blessed alias (`@b9g/filesystem-node`)
- [ ] Implement `.buckets/` directory for local storage
- [ ] Update install handlers for deployment copying

### 4. Asset Pipeline Integration
- [ ] Ensure assets go to `/assets/` with hashing
- [ ] Update static files middleware for new structure
- [ ] Test `http-server dist/` compatibility

This design provides clean separation between development, SSG, and production workflows while maintaining a consistent platform abstraction across all deployment targets.