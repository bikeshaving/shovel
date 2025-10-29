/**
 * ESBuild-based hot reloading watcher for Node.js platform
 * Restores the sophisticated VM-based module system with dependency tracking
 */

import * as Path from 'path';
import * as FS from 'fs/promises';
import { fileURLToPath, pathToFileURL } from 'url';
import * as VM from 'vm';
import * as ESBuild from 'esbuild';
import { SourceMapConsumer } from 'source-map';
import MagicString from 'magic-string';
import { staticFilesPlugin } from '@b9g/staticfiles';

/**
 * Watcher record for tracking build results
 */
interface WatchRecord {
  entry: string;
  result: ESBuild.BuildResult;
  isInitial: boolean;
}

/**
 * Cache entry for module watching
 */
interface CacheEntry {
  entry: string;
  ctx: Promise<ESBuild.BuildContext> | ESBuild.BuildContext;
  result: Promise<ESBuild.BuildResult> | ESBuild.BuildResult;
  resolve: ((result: ESBuild.BuildResult) => void) | null;
}

/**
 * Hot module replacement support
 */
export class Hot {
  private disposeCallbacks: (() => void)[] = [];

  /**
   * Accept hot updates (basic implementation)
   */
  accept(callback?: () => void): void {
    if (callback) {
      throw new Error('Hot.accept with callback not implemented yet');
    }
  }

  /**
   * Invalidate this module
   */
  invalidate(): void {
    throw new Error('Hot.invalidate not implemented yet');
  }

  /**
   * Register cleanup callback
   */
  dispose(callback: () => void): void {
    this.disposeCallbacks.push(callback);
  }

  /**
   * Mark module as non-updatable
   */
  decline(): void {
    // No-op for now
  }

  /**
   * Execute all dispose callbacks
   */
  _dispose(): void {
    for (const callback of this.disposeCallbacks) {
      try {
        callback();
      } catch (error) {
        console.error('Error in hot dispose callback:', error);
      }
    }
    this.disposeCallbacks.length = 0;
  }
}

/**
 * ESBuild watcher with hot module reloading
 */
export class Watcher {
  private cache = new Map<string, CacheEntry>();
  private callback: (record: WatchRecord, watcher: Watcher) => void | Promise<void>;
  private plugin: ESBuild.Plugin;

  constructor(callback: (record: WatchRecord, watcher: Watcher) => void | Promise<void>) {
    this.callback = callback;
    this.plugin = {
      name: 'watcher',
      setup: (build) => {
        build.onEnd(async (result) => {
          try {
            const entry = build.initialOptions.entryPoints?.[0] as string;
            const cacheValue = this.cache.get(entry);
            if (!cacheValue) return;

            const isInitial = cacheValue.resolve != null;
            if (cacheValue.resolve) {
              cacheValue.resolve(result);
              cacheValue.resolve = null;
            }
            cacheValue.result = result;

            await this.callback({
              entry,
              result,
              isInitial,
            }, this);
          } catch (error) {
            console.error('Error in watcher callback:', error);
          }
        });
      },
    };
  }

  /**
   * Build/watch a module entry point
   */
  async build(entry: string): Promise<ESBuild.BuildResult> {
    if (this.cache.has(entry)) {
      const cached = this.cache.get(entry)!;
      return cached.result instanceof Promise ? await cached.result : cached.result;
    }

    const ctxPromise = this.createESBuildContext(entry);
    let resolve: ((result: ESBuild.BuildResult) => void) | null = null;
    
    const cacheValue: CacheEntry = {
      entry,
      ctx: ctxPromise,
      result: new Promise<ESBuild.BuildResult>((r) => (resolve = r)),
      resolve,
    };
    
    this.cache.set(entry, cacheValue);

    // Start watching
    ctxPromise.then(async (ctx) => {
      await ctx.watch();
      cacheValue.ctx = ctx;
    }).catch((error) => {
      console.error(`Failed to start watching ${entry}:`, error);
      if (resolve) {
        resolve({ errors: [{ text: error.message }] } as ESBuild.BuildResult);
      }
    });

    return cacheValue.result instanceof Promise ? await cacheValue.result : cacheValue.result;
  }

  /**
   * Create ESBuild context for a module
   */
  private async createESBuildContext(entry: string): Promise<ESBuild.BuildContext> {
    return ESBuild.context({
      entryPoints: [entry],
      plugins: [
        staticFilesPlugin({
          outputDir: 'dist/static',
          publicPath: '/static/',
          manifest: 'dist/static-manifest.json',
        }),
        this.createImportMetaPlugin(), 
        this.plugin
      ],
      format: 'esm',
      platform: 'node',
      bundle: false,
      metafile: true,
      write: false,
      packages: 'external',
      sourcemap: 'both',
      outdir: 'dist',
      logLevel: 'silent',
      target: 'es2022',
      jsx: 'automatic',
      jsxImportSource: 'react',
      loader: {
        '.svg': 'file',
        '.png': 'file',
        '.jpg': 'file',
        '.jpeg': 'file',
        '.gif': 'file',
        '.css': 'file',
      },
    });
  }

  /**
   * Plugin to fix import.meta.url in bundled code
   */
  private createImportMetaPlugin(): ESBuild.Plugin {
    return {
      name: 'import-meta',
      setup(build) {
        build.onLoad({ filter: /\.(js|ts|jsx|tsx)$/ }, async (args) => {
          let code = await FS.readFile(args.path, 'utf8');
          const magicString = new MagicString(code);
          
          // Fix import.meta.url to point to the original file
          magicString.prepend(
            `import.meta && (import.meta.url = "${pathToFileURL(args.path).href}");\n`
          );

          code = magicString.toString();
          const map = magicString.generateMap({
            file: args.path,
            source: args.path,
            hires: true,
          });

          code = code + '\n//# sourceMappingURL=' + map.toUrl();
          
          return {
            contents: code,
            loader: Path.extname(args.path).slice(1) as ESBuild.Loader,
          };
        });
      },
    };
  }

  /**
   * Dispose of all watchers
   */
  async dispose(): Promise<void> {
    const disposePromises: Promise<void>[] = [];
    
    for (const cacheValue of this.cache.values()) {
      if (cacheValue.ctx instanceof Promise) {
        disposePromises.push(
          cacheValue.ctx.then(ctx => ctx.dispose()).catch(console.error)
        );
      } else {
        disposePromises.push(cacheValue.ctx.dispose());
      }
    }

    await Promise.allSettled(disposePromises);
    this.cache.clear();
  }
}

/**
 * Fix error stack traces using source maps
 */
export function fixErrorStack(error: Error, sourceMapConsumer?: SourceMapConsumer): void {
  if (!sourceMapConsumer || !error.stack) return;

  const lines = error.stack.split('\n');
  const [message, ...stackLines] = lines;

  const fixedLines = stackLines.map((line) => {
    return line.replace(
      /ESBUILD_VM_RUN:(\d+):(\d+)/g,
      (match, lineStr, columnStr) => {
        const originalPos = sourceMapConsumer.originalPositionFor({
          line: parseInt(lineStr, 10),
          column: parseInt(columnStr, 10),
        });

        if (originalPos.source) {
          const source = Path.resolve(process.cwd(), originalPos.source);
          return `${pathToFileURL(source)}:${originalPos.line}:${originalPos.column}`;
        }

        return match;
      }
    );
  });

  error.stack = [message, ...fixedLines].join('\n');
}

/**
 * Create module linker for VM modules
 */
export function createModuleLinker(watcher: Watcher, context?: VM.Context) {
  return async function link(specifier: string, referencingModule: VM.Module): Promise<VM.Module> {
    const basedir = Path.dirname(fileURLToPath(referencingModule.identifier));
    const resolved = await resolveSpecifier(specifier, basedir);

    if (isPathSpecifier(specifier)) {
      // This is a relative/absolute import - compile with ESBuild
      const url = pathToFileURL(resolved).href;
      const result = await watcher.build(resolved);
      const code = result.outputFiles?.find((file) => file.path.endsWith('.js'))?.text || '';
      
      return new VM.SourceTextModule(code, {
        identifier: url,
        context, // Use the shared context
        initializeImportMeta(meta: any) {
          meta.url = url;
          meta.hot = new Hot();
        },
        async importModuleDynamically(specifier: string, referencingModule: VM.Module) {
          const linked = await link(specifier, referencingModule);
          await linked.link(link);
          await linked.evaluate();
          return linked;
        },
      });
    }

    // This is a bare module specifier - import from node_modules
    const importedModule = await import(resolved);
    const exports = Object.keys(importedModule);
    
    return new VM.SyntheticModule(exports, function () {
      for (const key of exports) {
        this.setExport(key, importedModule[key]);
      }
    }, {
      identifier: resolved,
      context, // Use the shared context
    });
  };
}

/**
 * Simple specifier resolution (similar to Node.js resolution)
 */
async function resolveSpecifier(specifier: string, basedir: string): Promise<string> {
  if (isPathSpecifier(specifier)) {
    return Path.resolve(basedir, specifier);
  }
  
  // For bare specifiers, try to resolve from node_modules
  try {
    return require.resolve(specifier, { paths: [basedir] });
  } catch {
    return specifier; // Let import() handle it
  }
}

/**
 * Check if specifier is a path (relative or absolute)
 */
function isPathSpecifier(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/');
}