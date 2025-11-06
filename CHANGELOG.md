# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0-beta] - 2025-11-05

### Added

#### 🚀 Directly Executable Production Builds
- **Self-contained deployment**: `shovel build` now creates directly executable production builds that don't require `shovel serve`
- **2-file output**: Production builds generate only `app.js` (executable) and `package.json` (dependencies)
- **Platform bootstrapping**: Automatic platform detection and ServiceWorker environment setup
- **Zero-config deployment**: Run `chmod +x app.js && ./app.js` after `npm install` in the dist directory

#### 🌐 Complete ServiceWorker API Implementation
- **Full ServiceWorker globals**: Implemented `self`, `addEventListener`, `removeEventListener`, `dispatchEvent`
- **ServiceWorker lifecycle**: Proper `install` and `activate` event handling
- **ServiceWorker APIs**: Implemented `self.skipWaiting()` and `self.clients` with environment-aware behavior
- **Web standards compliance**: All APIs follow web platform standards, not runtime-specific implementations

#### 🏗️ New Bucket Architecture
- **`self.buckets` API**: Replaced `self.dirs` with standardized bucket interface for filesystem access
- **Factory pattern**: Dynamic adapter loading for different storage backends (memory, local, S3, R2)
- **Unified interface**: All storage adapters implement the same `Bucket` interface
- **`getDirectoryHandle(name)` API**: Standardized directory access following File System Access API patterns

#### 📦 Asset Import Improvements
- **`assetBase` import attribute**: New syntax for asset imports with base path resolution
- **Automatic asset processing**: Assets are automatically copied and processed during build
- **Import transformation**: `import './style.css' with { assetBase: true }` generates proper asset URLs
- **Manifest generation**: Asset manifests track all processed assets with metadata

#### 🧪 Enhanced Cache System
- **Redis cache adapter**: Full Redis support with connection pooling and error handling
- **Multi-threaded coordination**: PostMessage-based cache coordination for worker environments
- **Platform-agnostic types**: Separated web standard types from platform-specific implementations
- **Factory pattern**: Dynamic cache adapter loading matching filesystem patterns

#### 🔧 Type System Improvements
- **Separated type imports**: Platform-specific types only in platform packages, web standard types in shared packages
- **TypeScript configuration**: Fixed Headers iteration and other compatibility issues with proper lib configuration
- **Comprehensive type checking**: All packages now pass strict TypeScript compilation
- **Web standard prioritization**: Chose webworker types over runtime-specific types for compatibility

#### ⚡ Performance & Production Features
- **TechEmpower Framework Benchmarks**: Official implementation and testing completed
- **Production scaling**: Multi-worker support with proper resource coordination
- **Docker deployment**: Complete containerization support with optimized builds
- **Cloudflare Workers**: Enhanced support with proper ES module bundling

### Changed

#### 💥 Breaking Changes
- **BREAKING**: Replaced `self.dirs` with `self.buckets` API
- **BREAKING**: Changed `getBucket()` to `getDirectoryHandle(name: string)` for standardization
- **BREAKING**: Asset imports now require explicit `assetBase` attribute for base path resolution
- **BREAKING**: Updated all filesystem adapters to implement new `Bucket` interface

#### 🏗️ Build System Overhaul
- **Simplified output**: Moved from complex templating to clean esbuild banner approach
- **Self-contained bundling**: Framework dependencies bundled, app dependencies preserved
- **Platform detection**: Automatic runtime detection and appropriate adapter loading
- **Production runtime**: Uses proven development patterns for production consistency

#### 📁 Architecture Improvements
- **Clean separation**: Platform-specific code isolated from shared/core packages
- **Consistent interfaces**: All adapters follow same patterns (cache, filesystem, platform)
- **Dynamic loading**: Runtime adapter detection and loading
- **Environment awareness**: Proper detection of worker vs main thread contexts

### Fixed

- **TypeScript compilation**: Resolved Headers.entries() iteration issues with DOM.Iterable configuration
- **Cache exports**: Fixed missing factory functions in multi-threaded cache coordination
- **Platform contamination**: Removed Node.js-specific imports from platform-agnostic packages
- **Build loops**: Fixed infinite loading where worker.js was trying to load itself
- **Worker globals**: Proper ServiceWorker environment setup in all execution contexts
- **Dependency resolution**: Fixed workspace dependency resolution and external bundling

### Technical Details

#### ServiceWorker Implementation
The ServiceWorker implementation provides full web platform compatibility:

```typescript
// Environment-aware skipWaiting implementation
const skipWaiting = async (): Promise<void> => {
  if (options.isDevelopment && options.hotReload) {
    console.info('[ServiceWorker] skipWaiting() - triggering hot reload');
    await options.hotReload();
  } else if (!options.isDevelopment) {
    console.info('[ServiceWorker] skipWaiting() - production graceful restart not implemented');
  }
};
```

#### Build System Architecture
The new build system uses esbuild banners for clean, self-contained executables:

```javascript
// Production bootstrap injected via esbuild banner
buildConfig.banner = {
  js: `#!/usr/bin/env node
import { ServiceWorkerRuntime, createServiceWorkerGlobals, createBucketStorage } from '@b9g/platform';

if (import.meta.url === \`file://\${process.argv[1]}\`) {
  const runtime = new ServiceWorkerRuntime();
  const buckets = createBucketStorage(process.cwd());
  
  createServiceWorkerGlobals(runtime, { buckets });
  // ... HTTP server setup using proven patterns
}
// User's ServiceWorker code follows...`
};
```

#### Type Architecture
Clean separation ensures web standard compatibility:

```typescript
// Platform-agnostic cache using web standards
interface WorkerLike {
  postMessage(value: any): void;
  on(event: string, listener: (data: any) => void): void;
}

// Web standard encoding instead of Node.js Buffer
body: btoa(String.fromCharCode(...new Uint8Array(body))),
totalSize += new TextEncoder().encode(value).length;
```

### Migration Guide

#### From `self.dirs` to `self.buckets`
```typescript
// Before
const distDir = await self.dirs.getBucket();

// After  
const distBucket = await self.buckets.getDirectoryHandle('dist');
```

#### Asset Imports
```typescript
// Before
import './style.css' with { url: true };

// After
import './style.css' with { assetBase: true };
```

#### Deployment
```bash
# Before
shovel build
shovel serve dist/

# After
shovel build
cd dist && npm install
chmod +x app.js && ./app.js
```

### Performance

- **TechEmpower Benchmarks**: Competitive performance in official framework benchmarks
- **Production scaling**: Multi-worker coordination with proper resource management
- **Build optimization**: Faster builds with simplified bundling strategy
- **Runtime efficiency**: Direct execution without CLI overhead

### Developer Experience

- **Zero-config deployment**: No configuration required for basic deployment
- **Proven patterns**: Production builds use same patterns as development
- **Better error messages**: Improved error handling and diagnostics
- **Type safety**: Comprehensive TypeScript support across all packages

---

## [0.1.10] - Previous Release

### Added
- Initial CLI implementation
- Basic platform abstraction
- Development server functionality
- Asset processing pipeline

### Fixed
- Various development workflow issues
- Build system stability
- Type definitions

---

For detailed technical documentation, see the [README.md](README.md) and individual package documentation.