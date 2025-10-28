import type { AssetsConfig } from './shared.js';

/**
 * ESBuild/Bun plugin for importing assets as URLs with manifest generation
 * 
 * @param options - Plugin configuration options
 * @returns ESBuild/Bun plugin
 * 
 * @example
 * ```typescript
 * import { assetsPlugin } from '@b9g/assets/plugin';
 * 
 * await build({
 *   plugins: [assetsPlugin()]
 * });
 * ```
 */
export function assetsPlugin(options?: AssetsConfig): {
  name: string;
  setup: (build: any) => void;
};

export default assetsPlugin;
