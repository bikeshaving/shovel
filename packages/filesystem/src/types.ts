/**
 * Core filesystem adapter interface and types
 */

/**
 * Configuration for filesystem adapters
 */
export interface FileSystemConfig {
  /** Human readable name for this filesystem */
  name?: string;
  /** Platform-specific configuration */
  [key: string]: any;
}

/**
 * Core interface that all filesystem adapters must implement
 * Provides File System Access API compatibility across all platforms
 */
export interface FileSystemAdapter {
  /**
   * Get a root directory handle for the filesystem
   * @param name Optional filesystem name/bucket identifier
   */
  getFileSystemRoot(name?: string): Promise<FileSystemDirectoryHandle>;

  /**
   * Get configuration for this adapter
   */
  getConfig(): FileSystemConfig;

  /**
   * Cleanup resources when adapter is no longer needed
   */
  dispose?(): Promise<void>;
}