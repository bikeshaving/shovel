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
 * Core interface that all buckets must implement
 * Provides File System Access API compatibility across all platforms
 */
export interface Bucket {
  /**
   * Get a directory handle for the bucket
   * @param name Directory name. Use "" for root directory
   */
  getDirectoryHandle(name: string): Promise<FileSystemDirectoryHandle>;

  /**
   * Get configuration for this bucket
   */
  getConfig(): FileSystemConfig;

  /**
   * Cleanup resources when bucket is no longer needed
   */
  dispose?(): Promise<void>;
}

