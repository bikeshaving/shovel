/**
 * Simple file watcher that runs ESBuild and triggers Worker reloads
 */

import * as esbuild from 'esbuild';
import { watch } from 'fs';
import { resolve, dirname } from 'path';
import { staticFilesPlugin } from './static-files.js';

export interface SimpleWatcherOptions {
  /** Entry point to build */
  entrypoint: string;
  /** Output directory */
  outDir: string;
  /** Callback when build completes */
  onBuild?: (success: boolean, version: number) => void;
}

export class SimpleWatcher {
  private watcher?: ReturnType<typeof watch>;
  private building = false;
  private options: SimpleWatcherOptions;

  constructor(options: SimpleWatcherOptions) {
    this.options = {
      outDir: 'dist',
      ...options
    };
  }

  /**
   * Start watching and building
   */
  async start() {
    const entryPath = resolve(this.options.entrypoint);
    const outputDir = resolve(this.options.outDir);

    // Initial build
    await this.build();

    // Watch for changes
    const watchDir = dirname(entryPath);
    console.log(`[Watcher] Watching ${watchDir} for changes...`);
    
    this.watcher = watch(watchDir, { recursive: true }, (eventType, filename) => {
      if (filename && (filename.endsWith('.js') || filename.endsWith('.ts') || filename.endsWith('.tsx'))) {
        this.debouncedBuild();
      }
    });
  }

  /**
   * Stop watching
   */
  async stop() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = undefined;
    }
  }

  private timeout?: NodeJS.Timeout;

  private debouncedBuild() {
    if (this.timeout) {
      clearTimeout(this.timeout);
    }
    this.timeout = setTimeout(() => {
      this.build();
    }, 100);
  }

  private async build() {
    if (this.building) return;
    this.building = true;

    try {
      const entryPath = resolve(this.options.entrypoint);
      const outputDir = resolve(this.options.outDir);
      const version = Date.now();

      console.log(`[Watcher] Building ${entryPath}...`);

      const result = await esbuild.build({
        entryPoints: [entryPath],
        bundle: true,
        format: 'esm',
        target: 'es2022',
        platform: 'node',
        outfile: `${outputDir}/app.js`,
        packages: 'external',
        plugins: [
          staticFilesPlugin({
            outputDir: `${outputDir}/static`,
            manifest: `${outputDir}/static-manifest.json`,
            dev: true
          })
        ],
        sourcemap: 'inline',
        minify: false,
        treeShaking: true,
        define: {
          'process.env.NODE_ENV': '"development"'
        }
      });

      if (result.errors.length > 0) {
        console.error('[Watcher] Build errors:', result.errors);
        this.options.onBuild?.(false, version);
      } else {
        console.log(`[Watcher] Build complete (v${version})`);
        this.options.onBuild?.(true, version);
      }

    } catch (error) {
      console.error('[Watcher] Build failed:', error);
      this.options.onBuild?.(false, Date.now());
    } finally {
      this.building = false;
    }
  }
}