/**
 * @b9g/filesystem - Universal File System Access API implementations
 * 
 * Provides File System Access API implementations for all JavaScript runtimes,
 * allowing orthogonal filesystem support independent of platform.
 */

// Core filesystem interface
export type {
  FileSystemAdapter,
  FileSystemConfig
} from "./types.js";

// Platform-specific implementations
export {NodeFileSystemAdapter} from "./node.js";
export {S3FileSystemAdapter} from "./s3.js";
export {CloudflareFileSystemAdapter} from "./cloudflare.js";
export {BunFileSystemAdapter} from "./bun.js";
export {MemoryFileSystemAdapter} from "./memory.js";

// Registry for managing filesystem adapters
export {FileSystemRegistry, getFileSystemRoot} from "./registry.js";