#!/usr/bin/env node
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};

// packages/platform/dist/src/adapter-registry.js
var init_adapter_registry = __esm({
  "packages/platform/dist/src/adapter-registry.js"() {
  }
});

// packages/platform/dist/src/base-platform.js
var init_base_platform = __esm({
  "packages/platform/dist/src/base-platform.js"() {
    init_adapter_registry();
  }
});

// packages/platform/dist/src/detection.js
function detectPlatforms() {
  const detections = [];
  if (typeof Bun !== "undefined") {
    detections.push({
      platform: "bun",
      confidence: 0.9,
      reasons: ["Bun global detected"]
    });
  }
  if (typeof EdgeRuntime !== "undefined") {
    detections.push({
      platform: "vercel",
      confidence: 0.9,
      reasons: ["Vercel EdgeRuntime detected"]
    });
  }
  if (typeof Deno !== "undefined") {
    detections.push({
      platform: "deno",
      confidence: 0.9,
      reasons: ["Deno global detected"]
    });
  }
  if (typeof caches !== "undefined" && typeof Response !== "undefined" && typeof crypto !== "undefined") {
    if (typeof addEventListener !== "undefined" && typeof fetch !== "undefined") {
      detections.push({
        platform: "cloudflare-workers",
        confidence: 0.8,
        reasons: ["Worker-like environment detected", "Web APIs available"]
      });
    }
  }
  if (typeof process !== "undefined" && process.versions && process.versions.node) {
    detections.push({
      platform: "node",
      confidence: 0.7,
      reasons: ["Node.js process detected"]
    });
  }
  if (detections.length === 0) {
    detections.push({
      platform: "unknown",
      confidence: 0,
      reasons: ["No platform detected"]
    });
  }
  return detections.sort((a, b) => b.confidence - a.confidence);
}
function getBestPlatformDetection() {
  const detections = detectPlatforms();
  return detections[0];
}
var init_detection = __esm({
  "packages/platform/dist/src/detection.js"() {
  }
});

// packages/platform/dist/src/types.js
var init_types = __esm({
  "packages/platform/dist/src/types.js"() {
    init_adapter_registry();
    init_base_platform();
    init_detection();
  }
});

// packages/platform/dist/src/service-worker.js
function createServiceWorkerGlobals(runtime2, options = {}) {
  if (options.caches) {
    runtime2.caches = options.caches;
  }
  if (options.buckets) {
    runtime2.buckets = options.buckets;
  }
  const skipWaiting = async () => {
    if (options.isDevelopment && options.hotReload) {
      console.info("[ServiceWorker] skipWaiting() - triggering hot reload");
      await options.hotReload();
    } else if (!options.isDevelopment) {
      console.info("[ServiceWorker] skipWaiting() - production graceful restart not implemented");
    }
  };
  const clients = {
    async claim() {
    },
    async get(id) {
      return void 0;
    },
    async matchAll(options2) {
      return [];
    },
    async openWindow(url) {
      return null;
    }
  };
  const globals = {
    self: runtime2,
    addEventListener: runtime2.addEventListener.bind(runtime2),
    removeEventListener: runtime2.removeEventListener.bind(runtime2),
    dispatchEvent: runtime2.dispatchEvent.bind(runtime2),
    // ServiceWorker-specific globals with proper implementations
    skipWaiting,
    clients,
    // Platform resources
    ...options.buckets && { buckets: options.buckets },
    ...options.caches && { caches: options.caches },
    // Standard globals
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    fetch,
    Request,
    Response,
    Headers,
    URL,
    URLSearchParams
  };
  Object.assign(globalThis, globals);
  return globals;
}
var ServiceWorkerRuntime;
var init_service_worker = __esm({
  "packages/platform/dist/src/service-worker.js"() {
    ServiceWorkerRuntime = class extends EventTarget {
      pendingPromises = /* @__PURE__ */ new Set();
      isInstalled = false;
      isActivated = false;
      constructor() {
        super();
      }
      /**
       * Create a fetch event and dispatch it
       */
      async handleRequest(request) {
        if (!this.isActivated) {
          throw new Error("ServiceWorker not activated");
        }
        return new Promise((resolve, reject) => {
          let responded = false;
          const promises = [];
          const event = Object.assign(new Event("fetch"), {
            request,
            respondWith: (response) => {
              if (responded) {
                throw new Error("respondWith() already called");
              }
              responded = true;
              Promise.resolve(response).then(resolve).catch(reject);
            },
            waitUntil: (promise) => {
              promises.push(promise);
              this.pendingPromises.add(promise);
              promise.finally(() => this.pendingPromises.delete(promise));
            }
          });
          this.dispatchEvent(event);
          if (!responded) {
            reject(new Error("No response provided for fetch event"));
          }
          Promise.allSettled(promises).catch(console.error);
        });
      }
      /**
       * Install the ServiceWorker
       */
      async install() {
        if (this.isInstalled)
          return;
        return new Promise((resolve, reject) => {
          const promises = [];
          let installCancelled = false;
          const event = Object.assign(new Event("install"), {
            waitUntil: (promise) => {
              promises.push(promise);
              this.pendingPromises.add(promise);
              promise.finally(() => this.pendingPromises.delete(promise));
            }
          });
          this.dispatchEvent(event);
          Promise.allSettled(promises).then(() => {
            if (!installCancelled) {
              this.isInstalled = true;
              resolve();
            }
          }).catch(reject);
        });
      }
      /**
       * Activate the ServiceWorker
       */
      async activate() {
        if (!this.isInstalled) {
          throw new Error("ServiceWorker must be installed before activation");
        }
        if (this.isActivated)
          return;
        return new Promise((resolve, reject) => {
          const promises = [];
          const event = Object.assign(new Event("activate"), {
            waitUntil: (promise) => {
              promises.push(promise);
              this.pendingPromises.add(promise);
              promise.finally(() => this.pendingPromises.delete(promise));
            }
          });
          this.dispatchEvent(event);
          Promise.allSettled(promises).then(() => {
            this.isActivated = true;
            resolve();
          }).catch(reject);
        });
      }
      /**
       * Collect static routes for pre-rendering
       */
      async collectStaticRoutes(outDir, baseUrl) {
        return new Promise((resolve, reject) => {
          let routes = [];
          const promises = [];
          const event = Object.assign(new Event("static"), {
            detail: { outDir, baseUrl },
            waitUntil: (promise) => {
              promises.push(
                promise.then((routeList) => {
                  routes = routes.concat(routeList);
                })
              );
              this.pendingPromises.add(promise);
              promise.finally(() => this.pendingPromises.delete(promise));
            }
          });
          this.dispatchEvent(event);
          if (promises.length === 0) {
            resolve([]);
          } else {
            Promise.allSettled(promises).then(() => resolve([...new Set(routes)])).catch(reject);
          }
        });
      }
      /**
       * Check if ready to handle requests
       */
      get ready() {
        return this.isInstalled && this.isActivated;
      }
      /**
       * Wait for all pending promises to resolve
       */
      async waitForPending() {
        if (this.pendingPromises.size > 0) {
          await Promise.allSettled([...this.pendingPromises]);
        }
      }
      /**
       * Reset the ServiceWorker state (for hot reloading)
       */
      reset() {
        this.isInstalled = false;
        this.isActivated = false;
        this.pendingPromises.clear();
        const listeners = this._listeners;
        if (listeners) {
          for (const type in listeners) {
            delete listeners[type];
          }
        }
      }
    };
  }
});

// packages/filesystem/dist/src/memory.js
var MemoryFileSystemWritableFileStream, MemoryFileSystemFileHandle, MemoryFileSystemDirectoryHandle, MemoryBucket;
var init_memory = __esm({
  "packages/filesystem/dist/src/memory.js"() {
    MemoryFileSystemWritableFileStream = class extends WritableStream {
      constructor(onClose) {
        super({
          write: (chunk) => {
            this.chunks.push(chunk);
            return Promise.resolve();
          },
          close: () => {
            const totalLength = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
            const content = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of this.chunks) {
              content.set(chunk, offset);
              offset += chunk.length;
            }
            this.onClose(content);
            return Promise.resolve();
          },
          abort: () => {
            this.chunks = [];
            return Promise.resolve();
          }
        });
        this.onClose = onClose;
      }
      chunks = [];
    };
    MemoryFileSystemFileHandle = class _MemoryFileSystemFileHandle {
      constructor(file, updateFile) {
        this.file = file;
        this.updateFile = updateFile;
        this.name = file.name;
      }
      kind = "file";
      name;
      async getFile() {
        return new File([this.file.content], this.file.name, {
          lastModified: this.file.lastModified,
          type: this.file.type
        });
      }
      async createWritable() {
        return new MemoryFileSystemWritableFileStream((content) => {
          this.updateFile(content);
        });
      }
      async createSyncAccessHandle() {
        throw new DOMException(
          "Synchronous access handles are not supported in memory filesystem",
          "InvalidStateError"
        );
      }
      async isSameEntry(other) {
        if (other.kind !== "file")
          return false;
        if (!(other instanceof _MemoryFileSystemFileHandle))
          return false;
        return this.file === other.file;
      }
      async queryPermission() {
        return "granted";
      }
      async requestPermission() {
        return "granted";
      }
    };
    MemoryFileSystemDirectoryHandle = class _MemoryFileSystemDirectoryHandle {
      constructor(directory) {
        this.directory = directory;
        this.name = directory.name;
      }
      kind = "directory";
      name;
      async getFileHandle(name, options) {
        const file = this.directory.files.get(name);
        if (!file && options?.create) {
          const newFile = {
            name,
            content: new Uint8Array(0),
            lastModified: Date.now(),
            type: "application/octet-stream"
          };
          this.directory.files.set(name, newFile);
          return new MemoryFileSystemFileHandle(newFile, (content, type) => {
            newFile.content = content;
            newFile.lastModified = Date.now();
            if (type)
              newFile.type = type;
          });
        } else if (!file) {
          throw new DOMException("File not found", "NotFoundError");
        }
        return new MemoryFileSystemFileHandle(file, (content, type) => {
          file.content = content;
          file.lastModified = Date.now();
          if (type)
            file.type = type;
        });
      }
      async getDirectoryHandle(name, options) {
        const dir = this.directory.directories.get(name);
        if (!dir && options?.create) {
          const newDir = {
            name,
            files: /* @__PURE__ */ new Map(),
            directories: /* @__PURE__ */ new Map()
          };
          this.directory.directories.set(name, newDir);
          return new _MemoryFileSystemDirectoryHandle(newDir);
        } else if (!dir) {
          throw new DOMException("Directory not found", "NotFoundError");
        }
        return new _MemoryFileSystemDirectoryHandle(dir);
      }
      async removeEntry(name, options) {
        if (this.directory.files.has(name)) {
          this.directory.files.delete(name);
          return;
        }
        const dir = this.directory.directories.get(name);
        if (dir) {
          if (dir.files.size > 0 || dir.directories.size > 0) {
            if (!options?.recursive) {
              throw new DOMException(
                "Directory is not empty",
                "InvalidModificationError"
              );
            }
          }
          this.directory.directories.delete(name);
          return;
        }
        throw new DOMException("Entry not found", "NotFoundError");
      }
      async resolve(possibleDescendant) {
        if (possibleDescendant instanceof MemoryFileSystemFileHandle) {
          if (this.directory.files.has(possibleDescendant.name)) {
            return [possibleDescendant.name];
          }
        }
        if (possibleDescendant instanceof _MemoryFileSystemDirectoryHandle) {
          if (this.directory.directories.has(possibleDescendant.name)) {
            return [possibleDescendant.name];
          }
        }
        return null;
      }
      async *entries() {
        for (const [name, file] of this.directory.files) {
          yield [
            name,
            new MemoryFileSystemFileHandle(file, (content, type) => {
              file.content = content;
              file.lastModified = Date.now();
              if (type)
                file.type = type;
            })
          ];
        }
        for (const [name, dir] of this.directory.directories) {
          yield [name, new _MemoryFileSystemDirectoryHandle(dir)];
        }
      }
      async *keys() {
        for (const name of this.directory.files.keys()) {
          yield name;
        }
        for (const name of this.directory.directories.keys()) {
          yield name;
        }
      }
      async *values() {
        for (const [, handle] of this.entries()) {
          yield handle;
        }
      }
      async isSameEntry(other) {
        if (other.kind !== "directory")
          return false;
        if (!(other instanceof _MemoryFileSystemDirectoryHandle))
          return false;
        return this.directory === other.directory;
      }
      async queryPermission() {
        return "granted";
      }
      async requestPermission() {
        return "granted";
      }
    };
    MemoryBucket = class {
      config;
      filesystems = /* @__PURE__ */ new Map();
      constructor(config = {}) {
        this.config = {
          name: "memory",
          ...config
        };
      }
      async getDirectoryHandle(name) {
        const dirName = name || "root";
        if (!this.filesystems.has(dirName)) {
          const root2 = {
            name: "root",
            files: /* @__PURE__ */ new Map(),
            directories: /* @__PURE__ */ new Map()
          };
          this.filesystems.set(dirName, root2);
        }
        const root = this.filesystems.get(dirName);
        return new MemoryFileSystemDirectoryHandle(root);
      }
      getConfig() {
        return { ...this.config };
      }
      async dispose() {
        this.filesystems.clear();
      }
    };
  }
});

// packages/filesystem/dist/src/node.js
import * as fs from "fs/promises";
import * as path from "path";
import { createWriteStream } from "fs";
var NodeFileSystemWritableFileStream, NodeFileSystemFileHandle, NodeFileSystemDirectoryHandle, LocalBucket;
var init_node = __esm({
  "packages/filesystem/dist/src/node.js"() {
    NodeFileSystemWritableFileStream = class extends WritableStream {
      constructor(filePath) {
        const writeStream = createWriteStream(filePath);
        super({
          write(chunk) {
            return new Promise((resolve, reject) => {
              writeStream.write(chunk, (error) => {
                if (error)
                  reject(error);
                else
                  resolve();
              });
            });
          },
          close() {
            return new Promise((resolve, reject) => {
              writeStream.end((error) => {
                if (error)
                  reject(error);
                else
                  resolve();
              });
            });
          },
          abort() {
            writeStream.destroy();
            return Promise.resolve();
          }
        });
        this.filePath = filePath;
      }
      // File System Access API compatibility methods
      async write(data) {
        const writer = this.getWriter();
        try {
          if (typeof data === "string") {
            await writer.write(new TextEncoder().encode(data));
          } else {
            await writer.write(data);
          }
        } finally {
          writer.releaseLock();
        }
      }
      async close() {
        const writer = this.getWriter();
        try {
          await writer.close();
        } finally {
          writer.releaseLock();
        }
      }
    };
    NodeFileSystemFileHandle = class _NodeFileSystemFileHandle {
      constructor(filePath) {
        this.filePath = filePath;
        this.name = path.basename(filePath);
      }
      kind = "file";
      name;
      async getFile() {
        try {
          const stats = await fs.stat(this.filePath);
          const buffer = await fs.readFile(this.filePath);
          return new File([buffer], this.name, {
            lastModified: stats.mtime.getTime(),
            // Attempt to determine MIME type from extension
            type: this.getMimeType(this.filePath)
          });
        } catch (error) {
          if (error.code === "ENOENT") {
            throw new DOMException("File not found", "NotFoundError");
          }
          throw error;
        }
      }
      async createWritable() {
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        return new NodeFileSystemWritableFileStream(this.filePath);
      }
      async createSyncAccessHandle() {
        throw new DOMException(
          "Synchronous access handles are only available in workers",
          "InvalidStateError"
        );
      }
      async isSameEntry(other) {
        if (other.kind !== "file")
          return false;
        if (!(other instanceof _NodeFileSystemFileHandle))
          return false;
        return this.filePath === other.filePath;
      }
      async queryPermission() {
        return "granted";
      }
      async requestPermission() {
        return "granted";
      }
      getMimeType(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes = {
          ".txt": "text/plain",
          ".html": "text/html",
          ".css": "text/css",
          ".js": "text/javascript",
          ".json": "application/json",
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".gif": "image/gif",
          ".svg": "image/svg+xml",
          ".pdf": "application/pdf",
          ".zip": "application/zip"
        };
        return mimeTypes[ext] || "application/octet-stream";
      }
    };
    NodeFileSystemDirectoryHandle = class _NodeFileSystemDirectoryHandle {
      constructor(dirPath) {
        this.dirPath = dirPath;
        this.name = path.basename(dirPath);
      }
      kind = "directory";
      name;
      async getFileHandle(name, options) {
        const filePath = path.join(this.dirPath, name);
        try {
          const stats = await fs.stat(filePath);
          if (!stats.isFile()) {
            throw new DOMException(
              "Path exists but is not a file",
              "TypeMismatchError"
            );
          }
        } catch (error) {
          if (error.code === "ENOENT") {
            if (options?.create) {
              await fs.mkdir(this.dirPath, { recursive: true });
              await fs.writeFile(filePath, "");
            } else {
              throw new DOMException("File not found", "NotFoundError");
            }
          } else {
            throw error;
          }
        }
        return new NodeFileSystemFileHandle(filePath);
      }
      async getDirectoryHandle(name, options) {
        const subDirPath = path.join(this.dirPath, name);
        try {
          const stats = await fs.stat(subDirPath);
          if (!stats.isDirectory()) {
            throw new DOMException(
              "Path exists but is not a directory",
              "TypeMismatchError"
            );
          }
        } catch (error) {
          if (error.code === "ENOENT") {
            if (options?.create) {
              await fs.mkdir(subDirPath, { recursive: true });
            } else {
              throw new DOMException("Directory not found", "NotFoundError");
            }
          } else {
            throw error;
          }
        }
        return new _NodeFileSystemDirectoryHandle(subDirPath);
      }
      async removeEntry(name, options) {
        const entryPath = path.join(this.dirPath, name);
        try {
          const stats = await fs.stat(entryPath);
          if (stats.isDirectory()) {
            await fs.rmdir(entryPath, { recursive: options?.recursive });
          } else {
            await fs.unlink(entryPath);
          }
        } catch (error) {
          if (error.code === "ENOENT") {
            throw new DOMException("Entry not found", "NotFoundError");
          }
          throw error;
        }
      }
      async resolve(_possibleDescendant) {
        return null;
      }
      async *entries() {
        try {
          const entries = await fs.readdir(this.dirPath, { withFileTypes: true });
          for (const entry of entries) {
            const entryPath = path.join(this.dirPath, entry.name);
            if (entry.isDirectory()) {
              yield [entry.name, new _NodeFileSystemDirectoryHandle(entryPath)];
            } else if (entry.isFile()) {
              yield [entry.name, new NodeFileSystemFileHandle(entryPath)];
            }
          }
        } catch (error) {
          if (error.code === "ENOENT") {
            throw new DOMException("Directory not found", "NotFoundError");
          }
          throw error;
        }
      }
      async *keys() {
        for await (const [name] of this.entries()) {
          yield name;
        }
      }
      async *values() {
        for await (const [, handle] of this.entries()) {
          yield handle;
        }
      }
      async isSameEntry(other) {
        if (other.kind !== "directory")
          return false;
        if (!(other instanceof _NodeFileSystemDirectoryHandle))
          return false;
        return this.dirPath === other.dirPath;
      }
      async queryPermission() {
        return "granted";
      }
      async requestPermission() {
        return "granted";
      }
    };
    LocalBucket = class {
      config;
      rootPath;
      constructor(config = {}) {
        this.config = {
          name: "node",
          ...config
        };
        this.rootPath = config.rootPath || path.join(process.cwd(), "dist");
      }
      async getDirectoryHandle(name) {
        const dirPath = name ? path.join(this.rootPath, name) : this.rootPath;
        try {
          await fs.mkdir(dirPath, { recursive: true });
        } catch (error) {
        }
        return new NodeFileSystemDirectoryHandle(dirPath);
      }
      getConfig() {
        return { ...this.config };
      }
    };
  }
});

// packages/filesystem/dist/src/bun-s3.js
var BunS3FileSystemWritableFileStream;
var init_bun_s3 = __esm({
  "packages/filesystem/dist/src/bun-s3.js"() {
    BunS3FileSystemWritableFileStream = class extends WritableStream {
      constructor(s3file) {
        super({
          start: async () => {
            this.writer = this.s3file.writer();
          },
          write: async (chunk) => {
            await this.writer.write(chunk);
          },
          close: async () => {
            await this.writer.end();
          },
          abort: async () => {
            await this.writer.abort?.();
          }
        });
        this.s3file = s3file;
      }
      writer;
    };
  }
});

// packages/filesystem/dist/src/directory-storage.js
var BucketStorage;
var init_directory_storage = __esm({
  "packages/filesystem/dist/src/directory-storage.js"() {
    BucketStorage = class {
      constructor(factory) {
        this.factory = factory;
      }
      instances = /* @__PURE__ */ new Map();
      /**
       * Opens a bucket with the given name
       * Returns existing instance if already opened, otherwise creates a new one
       */
      async open(name) {
        const existingInstance = this.instances.get(name);
        if (existingInstance) {
          return await existingInstance.getDirectoryHandle("");
        }
        const adapter = await this.factory(name);
        this.instances.set(name, adapter);
        return await adapter.getDirectoryHandle("");
      }
      /**
       * Returns true if a bucket with the given name exists (has been opened)
       */
      async has(name) {
        return this.instances.has(name);
      }
      /**
       * Deletes a bucket with the given name
       * Disposes of the instance if it exists
       */
      async delete(name) {
        const instance = this.instances.get(name);
        if (instance) {
          if (instance.dispose) {
            await instance.dispose();
          }
          this.instances.delete(name);
          return true;
        }
        return false;
      }
      /**
       * Returns a list of all opened bucket names
       */
      async keys() {
        return Array.from(this.instances.keys());
      }
      /**
       * Get statistics about the bucket storage
       */
      getStats() {
        return {
          openInstances: this.instances.size,
          bucketNames: Array.from(this.instances.keys())
        };
      }
      /**
       * Dispose of all open adapter instances
       * Useful for cleanup during shutdown
       */
      async dispose() {
        const disposePromises = [];
        for (const [_name, instance] of this.instances) {
          if (instance.dispose) {
            disposePromises.push(instance.dispose());
          }
        }
        await Promise.all(disposePromises);
        this.instances.clear();
      }
    };
  }
});

// packages/filesystem/dist/src/registry.js
var Registry, FileSystemRegistry;
var init_registry = __esm({
  "packages/filesystem/dist/src/registry.js"() {
    init_memory();
    Registry = class {
      adapters = /* @__PURE__ */ new Map();
      defaultAdapter;
      constructor() {
        this.defaultAdapter = new MemoryBucket();
      }
      /**
       * Register a filesystem adapter with a name
       */
      register(name, adapter) {
        this.adapters.set(name, adapter);
        if (!this.defaultAdapter) {
          this.defaultAdapter = adapter;
        }
      }
      /**
       * Get a filesystem adapter by name
       */
      get(name) {
        if (!name) {
          return this.defaultAdapter;
        }
        return this.adapters.get(name) || this.defaultAdapter;
      }
      /**
       * Set the default filesystem adapter
       */
      setDefault(adapter) {
        this.defaultAdapter = adapter;
      }
      /**
       * Get all registered adapter names
       */
      getAdapterNames() {
        return Array.from(this.adapters.keys());
      }
      /**
       * Clear all registered adapters
       */
      clear() {
        this.adapters.clear();
        this.defaultAdapter = null;
      }
    };
    FileSystemRegistry = new Registry();
  }
});

// packages/filesystem/dist/src/index.js
var init_src = __esm({
  "packages/filesystem/dist/src/index.js"() {
    init_memory();
    init_node();
    init_bun_s3();
    init_directory_storage();
    init_registry();
  }
});

// packages/platform/dist/src/directory-storage.js
function createBucketStorage(rootPath = "./dist") {
  return new PlatformBucketStorage(rootPath);
}
var PlatformBucketStorage;
var init_directory_storage2 = __esm({
  "packages/platform/dist/src/directory-storage.js"() {
    init_src();
    PlatformBucketStorage = class {
      buckets;
      constructor(rootPath = "./dist") {
        this.buckets = new BucketStorage((name) => {
          if (name === "" || name === "/" || name === ".") {
            return new LocalBucket(rootPath);
          }
          return new LocalBucket(`${rootPath}/${name}`);
        });
      }
      /**
       * Open a named bucket - creates if it doesn't exist
       * Well-known names: 'assets', 'static', 'uploads', 'temp'
       * Special values: '', '/', '.' return the root bucket
       */
      async open(name) {
        return await this.buckets.open(name);
      }
      /**
       * Check if a named bucket exists
       */
      async has(name) {
        return await this.buckets.has(name);
      }
      /**
       * Delete a named bucket and all its contents
       */
      async delete(name) {
        return await this.buckets.delete(name);
      }
      /**
       * List all available bucket names
       */
      async keys() {
        return await this.buckets.keys();
      }
      /**
       * Alias for open() - for compatibility with File System Access API naming
       */
      async getDirectoryHandle(name) {
        return await this.open(name);
      }
    };
  }
});

// packages/platform/dist/src/registry.js
var DefaultPlatformRegistry, platformRegistry;
var init_registry2 = __esm({
  "packages/platform/dist/src/registry.js"() {
    init_detection();
    DefaultPlatformRegistry = class {
      platforms = /* @__PURE__ */ new Map();
      register(name, platform) {
        this.platforms.set(name, platform);
      }
      get(name) {
        return this.platforms.get(name);
      }
      detect() {
        return getBestPlatformDetection();
      }
      list() {
        return Array.from(this.platforms.keys());
      }
    };
    platformRegistry = new DefaultPlatformRegistry();
  }
});

// packages/platform/dist/src/utils.js
var init_utils = __esm({
  "packages/platform/dist/src/utils.js"() {
  }
});

// packages/platform/dist/src/filesystem.js
var init_filesystem = __esm({
  "packages/platform/dist/src/filesystem.js"() {
    init_registry2();
  }
});

// packages/platform/dist/src/index.js
var init_src2 = __esm({
  "packages/platform/dist/src/index.js"() {
    init_types();
    init_service_worker();
    init_directory_storage2();
    init_registry2();
    init_detection();
    init_utils();
    init_filesystem();
  }
});

// test-single.js
var test_single_exports = {};
var init_test_single = __esm({
  "test-single.js"() {
    self.addEventListener("fetch", (e) => e.respondWith(new Response("single worker test")));
  }
});

// virtual-entry.js
init_src2();
var runtime = new ServiceWorkerRuntime();
var buckets = createBucketStorage(process.cwd());
createServiceWorkerGlobals(runtime, { buckets });
globalThis.self = runtime;
globalThis.addEventListener = runtime.addEventListener.bind(runtime);
globalThis.removeEventListener = runtime.removeEventListener.bind(runtime);
globalThis.dispatchEvent = runtime.dispatchEvent.bind(runtime);
await Promise.resolve().then(() => (init_test_single(), test_single_exports));
if (import.meta.url === `file://${process.argv[1]}`) {
  setTimeout(async () => {
    console.info("\u{1F527} Starting single-worker server...");
    await runtime.install();
    await runtime.activate();
    const { createServer } = await import("http");
    const PORT = process.env.PORT || 8080;
    const HOST = process.env.HOST || "0.0.0.0";
    const httpServer = createServer(async (req, res) => {
      try {
        const url = `http://${req.headers.host}${req.url}`;
        const request = new Request(url, {
          method: req.method,
          headers: req.headers,
          body: req.method !== "GET" && req.method !== "HEAD" ? req : void 0
        });
        const response = await runtime.handleRequest(request);
        res.statusCode = response.status;
        res.statusMessage = response.statusText;
        response.headers.forEach((value, key) => {
          res.setHeader(key, value);
        });
        if (response.body) {
          const reader = response.body.getReader();
          const pump = async () => {
            const { done, value } = await reader.read();
            if (done) {
              res.end();
            } else {
              res.write(value);
              await pump();
            }
          };
          await pump();
        } else {
          res.end();
        }
      } catch (error) {
        console.error("Request error:", error);
        res.statusCode = 500;
        res.setHeader("Content-Type", "text/plain");
        res.end("Internal Server Error");
      }
    });
    httpServer.listen(PORT, HOST, () => {
      console.info(`\u{1F680} Single-worker server running at http://${HOST}:${PORT}`);
    });
    const shutdown = async () => {
      console.info("\n\u{1F6D1} Shutting down single-worker server...");
      await new Promise((resolve) => httpServer.close(resolve));
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  }, 0);
}
