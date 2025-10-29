/**
 * @b9g/platform-node - Node.js platform adapter for Shovel
 * 
 * Provides hot reloading, ESBuild integration, and optimized caching for Node.js environments.
 */

export { NodePlatform, createNodePlatform, type NodePlatformOptions } from './platform.js';
export { Watcher, Hot, createModuleLinker, fixErrorStack } from '@b9g/shovel-compiler';

// Re-export common platform types
export type {
  Platform,
  CacheConfig,
  StaticConfig,
  Handler,
  Server,
  ServerOptions,
} from '@b9g/platform';