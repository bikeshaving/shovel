/**
 * Filesystem adapter registry
 * Manages registration and retrieval of filesystem adapters
 */

import type {FileSystemAdapter} from "./types.js";
import {MemoryFileSystemAdapter} from "./memory.js";

/**
 * Global registry of filesystem adapters
 */
class Registry {
  private adapters = new Map<string, FileSystemAdapter>();
  private defaultAdapter: FileSystemAdapter;

  constructor() {
    // Set memory adapter as default
    this.defaultAdapter = new MemoryFileSystemAdapter();
  }

  /**
   * Register a filesystem adapter with a name
   */
  register(name: string, adapter: FileSystemAdapter): void {
    this.adapters.set(name, adapter);
    
    // Set as default if it's the first one registered
    if (!this.defaultAdapter) {
      this.defaultAdapter = adapter;
    }
  }

  /**
   * Get a filesystem adapter by name
   */
  get(name?: string): FileSystemAdapter | null {
    if (!name) {
      return this.defaultAdapter;
    }
    return this.adapters.get(name) || this.defaultAdapter;
  }

  /**
   * Set the default filesystem adapter
   */
  setDefault(adapter: FileSystemAdapter): void {
    this.defaultAdapter = adapter;
  }

  /**
   * Get all registered adapter names
   */
  getAdapterNames(): string[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * Clear all registered adapters
   */
  clear(): void {
    this.adapters.clear();
    this.defaultAdapter = null;
  }
}

/**
 * Global filesystem registry instance
 */
export const FileSystemRegistry = new Registry();

/**
 * Get a file system directory handle using the registered adapters
 * @param name Directory name. Use "" for root directory
 * @param adapterName Optional adapter name (uses default if not specified)
 */
export async function getDirectoryHandle(
  name: string,
  adapterName?: string,
): Promise<FileSystemDirectoryHandle> {
  const adapter = FileSystemRegistry.get(adapterName);
  
  if (!adapter) {
    if (adapterName) {
      throw new Error(`No filesystem adapter registered with name: ${adapterName}`);
    } else {
      throw new Error("No default filesystem adapter registered");
    }
  }

  return await adapter.getDirectoryHandle(name);
}

/**
 * @deprecated Use getDirectoryHandle() instead
 */
export async function getBucket(
  name?: string,
  adapterName?: string,
): Promise<FileSystemDirectoryHandle> {
  const adapter = FileSystemRegistry.get(adapterName);
  
  if (!adapter) {
    throw new Error("No default filesystem adapter registered");
  }

  return await adapter.getDirectoryHandle(name || "");
}

/**
 * @deprecated Use getDirectoryHandle() instead
 */
export async function getFileSystemRoot(
  name?: string,
): Promise<FileSystemDirectoryHandle> {
  const adapter = FileSystemRegistry.get();
  
  if (!adapter) {
    throw new Error("No default filesystem adapter registered");
  }

  return await adapter.getDirectoryHandle(name || "");
}