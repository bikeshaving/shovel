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

// Core implementations (no external dependencies)
export {MemoryFileSystemAdapter} from "./memory.js";
export {NodeFileSystemAdapter, NodeFileSystemDirectoryHandle, NodeFileSystemFileHandle} from "./node.js";

// Registry for managing filesystem adapters
export {FileSystemRegistry, getFileSystemRoot} from "./registry.js";