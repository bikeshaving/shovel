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
 * Bucket is a semantic alias for FileSystemDirectoryHandle
 * Represents a named storage bucket that provides direct filesystem access
 */
export type Bucket = FileSystemDirectoryHandle;

