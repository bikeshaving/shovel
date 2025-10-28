import { Cache, generateCacheKey, type CacheQueryOptions } from './cache.js';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * Configuration options for FilesystemCache
 */
export interface FilesystemCacheOptions {
  /** Base directory for cache storage */
  directory?: string;
  /** Maximum age of entries in milliseconds */
  maxAge?: number;
  /** Whether to create directories if they don't exist */
  createDirectories?: boolean;
}

/**
 * Serialized request metadata
 */
interface SerializedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  timestamp: number;
}

/**
 * Serialized response metadata
 */
interface SerializedResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  timestamp: number;
  hasBody: boolean;
}

/**
 * Filesystem-based cache implementation for SSG and Node.js servers
 * Stores requests and responses as files in a directory structure
 */
export class FilesystemCache extends Cache {
  private baseDir: string;

  constructor(
    private name: string,
    private options: FilesystemCacheOptions = {}
  ) {
    super();
    
    this.baseDir = path.join(
      this.options.directory || './cache',
      this.sanitizeName(name)
    );

    if (this.options.createDirectories !== false) {
      this.ensureDirectoryExists(this.baseDir);
    }
  }

  /**
   * Find a cached response for the given request
   */
  async match(request: Request, options?: CacheQueryOptions): Promise<Response | undefined> {
    try {
      const entryPath = this.getEntryPath(request, options);
      
      if (!fs.existsSync(entryPath)) {
        return undefined;
      }

      // Check if entry has expired
      if (this.isExpired(entryPath)) {
        await this.deleteEntry(entryPath);
        return undefined;
      }

      // Load response metadata
      const responseMetadata = await this.loadResponseMetadata(entryPath);
      if (!responseMetadata) {
        return undefined;
      }

      // Load response body if it exists
      let body: BodyInit | null = null;
      if (responseMetadata.hasBody) {
        const bodyPath = path.join(entryPath, 'body');
        if (fs.existsSync(bodyPath)) {
          body = fs.readFileSync(bodyPath);
        }
      }

      // Reconstruct response
      return new Response(body, {
        status: responseMetadata.status,
        statusText: responseMetadata.statusText,
        headers: responseMetadata.headers
      });

    } catch (error) {
      console.warn(`FilesystemCache match error:`, error);
      return undefined;
    }
  }

  /**
   * Store a request/response pair in the cache
   */
  async put(request: Request, response: Response): Promise<void> {
    try {
      const entryPath = this.getEntryPath(request);
      
      // Ensure entry directory exists
      this.ensureDirectoryExists(entryPath);

      // Serialize request metadata
      const requestMetadata: SerializedRequest = {
        url: request.url,
        method: request.method,
        headers: Object.fromEntries(request.headers.entries()),
        timestamp: Date.now()
      };

      // Clone response to avoid consumption
      const clonedResponse = response.clone();
      const responseBody = await clonedResponse.arrayBuffer();

      // Serialize response metadata
      const responseMetadata: SerializedResponse = {
        status: clonedResponse.status,
        statusText: clonedResponse.statusText,
        headers: Object.fromEntries(clonedResponse.headers.entries()),
        timestamp: Date.now(),
        hasBody: responseBody.byteLength > 0
      };

      // Write files atomically by writing to temp files first
      const requestPath = path.join(entryPath, 'request.json');
      const responsePath = path.join(entryPath, 'response.json');
      const bodyPath = path.join(entryPath, 'body');

      const tempRequestPath = requestPath + '.tmp';
      const tempResponsePath = responsePath + '.tmp';
      const tempBodyPath = bodyPath + '.tmp';

      // Write temporary files
      fs.writeFileSync(tempRequestPath, JSON.stringify(requestMetadata, null, 2));
      fs.writeFileSync(tempResponsePath, JSON.stringify(responseMetadata, null, 2));
      
      if (responseMetadata.hasBody) {
        fs.writeFileSync(tempBodyPath, new Uint8Array(responseBody));
      }

      // Atomic rename to final locations
      fs.renameSync(tempRequestPath, requestPath);
      fs.renameSync(tempResponsePath, responsePath);
      
      if (responseMetadata.hasBody) {
        fs.renameSync(tempBodyPath, bodyPath);
      }

    } catch (error) {
      throw new Error(`FilesystemCache put error: ${error.message}`);
    }
  }

  /**
   * Delete a cached entry
   */
  async delete(request: Request, options?: CacheQueryOptions): Promise<boolean> {
    try {
      const entryPath = this.getEntryPath(request, options);
      
      if (!fs.existsSync(entryPath)) {
        return false;
      }

      await this.deleteEntry(entryPath);
      return true;

    } catch (error) {
      console.warn(`FilesystemCache delete error:`, error);
      return false;
    }
  }

  /**
   * Get all cached request keys
   */
  async keys(request?: Request, options?: CacheQueryOptions): Promise<Request[]> {
    try {
      if (!fs.existsSync(this.baseDir)) {
        return [];
      }

      const requests: Request[] = [];
      const entries = fs.readdirSync(this.baseDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const entryPath = path.join(this.baseDir, entry.name);
        
        // Skip expired entries
        if (this.isExpired(entryPath)) {
          await this.deleteEntry(entryPath);
          continue;
        }

        // Load request metadata
        const requestMetadata = await this.loadRequestMetadata(entryPath);
        if (!requestMetadata) continue;

        const cachedRequest = new Request(requestMetadata.url, {
          method: requestMetadata.method,
          headers: requestMetadata.headers
        });

        // If filtering by specific request, check if it matches
        if (request) {
          const requestKey = generateCacheKey(request, options);
          const cachedKey = generateCacheKey(cachedRequest, options);
          if (requestKey !== cachedKey) {
            continue;
          }
        }

        requests.push(cachedRequest);
      }

      return requests;

    } catch (error) {
      console.warn(`FilesystemCache keys error:`, error);
      return [];
    }
  }

  /**
   * Clear all entries from the cache
   */
  async clear(): Promise<void> {
    try {
      if (fs.existsSync(this.baseDir)) {
        fs.rmSync(this.baseDir, { recursive: true, force: true });
      }
      
      if (this.options.createDirectories !== false) {
        this.ensureDirectoryExists(this.baseDir);
      }
    } catch (error) {
      throw new Error(`FilesystemCache clear error: ${error.message}`);
    }
  }

  /**
   * Get cache statistics
   */
  getStats() {
    try {
      if (!fs.existsSync(this.baseDir)) {
        return {
          name: this.name,
          entryCount: 0,
          directory: this.baseDir,
          maxAge: this.options.maxAge
        };
      }

      const entries = fs.readdirSync(this.baseDir, { withFileTypes: true });
      const entryCount = entries.filter(entry => entry.isDirectory()).length;

      return {
        name: this.name,
        entryCount,
        directory: this.baseDir,
        maxAge: this.options.maxAge
      };

    } catch (error) {
      return {
        name: this.name,
        entryCount: 0,
        directory: this.baseDir,
        maxAge: this.options.maxAge,
        error: error.message
      };
    }
  }

  /**
   * Dispose of the cache and clean up resources
   */
  async dispose(): Promise<void> {
    // For filesystem cache, disposal is essentially clearing
    // Individual entries remain on disk for persistence
    // Override this method if you want different cleanup behavior
  }

  /**
   * Generate a file path for a cache entry
   */
  private getEntryPath(request: Request, options?: CacheQueryOptions): string {
    const key = generateCacheKey(request, options);
    const hash = this.hashKey(key);
    return path.join(this.baseDir, hash);
  }

  /**
   * Generate a hash from a cache key for filesystem storage
   */
  private hashKey(key: string): string {
    return crypto.createHash('sha256').update(key).digest('hex').substring(0, 16);
  }

  /**
   * Sanitize cache name for filesystem use
   */
  private sanitizeName(name: string): string {
    return name.replace(/[^a-zA-Z0-9-_]/g, '_');
  }

  /**
   * Ensure a directory exists, creating it if necessary
   */
  private ensureDirectoryExists(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  /**
   * Check if a cache entry has expired
   */
  private isExpired(entryPath: string): boolean {
    if (!this.options.maxAge) {
      return false;
    }

    try {
      const responsePath = path.join(entryPath, 'response.json');
      if (!fs.existsSync(responsePath)) {
        return true;
      }

      const stats = fs.statSync(responsePath);
      const age = Date.now() - stats.mtime.getTime();
      return age > this.options.maxAge;

    } catch (error) {
      return true; // If we can't read the file, consider it expired
    }
  }

  /**
   * Delete a cache entry directory and all its contents
   */
  private async deleteEntry(entryPath: string): Promise<void> {
    try {
      if (fs.existsSync(entryPath)) {
        fs.rmSync(entryPath, { recursive: true, force: true });
      }
    } catch (error) {
      console.warn(`Failed to delete cache entry ${entryPath}:`, error);
    }
  }

  /**
   * Load request metadata from filesystem
   */
  private async loadRequestMetadata(entryPath: string): Promise<SerializedRequest | null> {
    try {
      const requestPath = path.join(entryPath, 'request.json');
      if (!fs.existsSync(requestPath)) {
        return null;
      }

      const content = fs.readFileSync(requestPath, 'utf-8');
      return JSON.parse(content) as SerializedRequest;

    } catch (error) {
      console.warn(`Failed to load request metadata from ${entryPath}:`, error);
      return null;
    }
  }

  /**
   * Load response metadata from filesystem
   */
  private async loadResponseMetadata(entryPath: string): Promise<SerializedResponse | null> {
    try {
      const responsePath = path.join(entryPath, 'response.json');
      if (!fs.existsSync(responsePath)) {
        return null;
      }

      const content = fs.readFileSync(responsePath, 'utf-8');
      return JSON.parse(content) as SerializedResponse;

    } catch (error) {
      console.warn(`Failed to load response metadata from ${entryPath}:`, error);
      return null;
    }
  }
}