/**
 * ESBuild plugin for importing assets as URLs with manifest generation
 *
 * This plugin handles build-time processing of assets with assetBase imports.
 * It generates content-hashed filenames and creates a manifest for runtime lookup.
 *
 * @example
 * import { assetsPlugin } from '@b9g/assets/plugin';
 * import { build } from 'esbuild';
 *
 * await build({
 *   plugins: [assetsPlugin()],
 *   // ... other options
 * });
 *
 * // In your app code:
 * import logo from './logo.svg' with { assetBase: '/static/' };
 * // Returns: "/static/logo-abc12345.svg"
 */

import {readFileSync, writeFileSync, mkdirSync, existsSync} from "fs";
import {createHash} from "crypto";
import {join, basename, extname, relative, dirname} from "path";
import mime from "mime";
import * as ESBuild from "esbuild";
import {type AssetManifest, type AssetManifestEntry} from "./index.js";
import {getLogger} from "@logtape/logtape";
import {NodeModulesPolyfillPlugin} from "@esbuild-plugins/node-modules-polyfill";
import {NodeGlobalsPolyfillPlugin} from "@esbuild-plugins/node-globals-polyfill";

/**
 * File extensions that need transpilation
 */
const TRANSPILABLE_EXTENSIONS = new Set([".ts", ".tsx", ".jsx", ".mts", ".cts"]);

const logger = getLogger(["assets"]);

/**
 * ESBuild options that can be passed for client bundle transpilation
 */
export interface ClientBuildOptions {
	/**
	 * ESBuild plugins for client bundles (e.g., node polyfills)
	 */
	plugins?: ESBuild.Plugin[];

	/**
	 * ESBuild define for client bundles
	 */
	define?: Record<string, string>;

	/**
	 * ESBuild inject for client bundles
	 */
	inject?: string[];

	/**
	 * External packages for client bundles
	 */
	external?: string[];

	/**
	 * Alias for client bundles
	 */
	alias?: Record<string, string>;
}

/**
 * Configuration for assets plugin (build-time)
 */
export interface AssetsPluginConfig {
	/**
	 * Root output directory.
	 * Assets go to {outDir}/static/{assetBase}/
	 * Manifest goes to {outDir}/server/asset-manifest.json
	 * @default 'dist'
	 */
	outDir?: string;

	/**
	 * Length of content hash for cache busting
	 * @default 8
	 */
	hashLength?: number;

	/**
	 * Whether to include content hash in filename
	 * @default true
	 */
	includeHash?: boolean;

	/**
	 * Custom ESBuild options for client bundle transpilation
	 * Use this to add Node.js polyfills or other browser-specific configurations
	 */
	clientBuild?: ClientBuildOptions;
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Required<Omit<AssetsPluginConfig, "clientBuild">> & {
	clientBuild: ClientBuildOptions;
} = {
	outDir: "dist",
	hashLength: 8,
	includeHash: true,
	clientBuild: {},
};

/**
 * Merge user config with defaults
 */
function mergeConfig(
	userConfig: AssetsPluginConfig = {},
): Required<AssetsPluginConfig> {
	return {
		...DEFAULT_CONFIG,
		...userConfig,
	};
}

/**
 * Normalize asset base path to ensure consistent URL generation
 * Ensures leading slash and trailing slash for clean concatenation
 */
function normalizePath(basePath: string): string {
	// Ensure leading slash for absolute paths
	if (!basePath.startsWith("/")) {
		basePath = "/" + basePath;
	}
	// Ensure trailing slash for clean concatenation
	if (!basePath.endsWith("/")) {
		basePath = basePath + "/";
	}
	return basePath;
}

/**
 * ESBuild/Bun plugin for importing assets as URLs with manifest generation
 *
 * @param options - Plugin configuration options
 * @returns ESBuild/Bun plugin
 */
export function assetsPlugin(options: AssetsPluginConfig = {}) {
	const config = mergeConfig(options);
	const manifest: AssetManifest = {
		assets: {},
		generated: new Date().toISOString(),
	};

	return {
		name: "shovel-assets",
		setup(build: any) {
			// Handle resolution to ensure files get processed
			build.onResolve({filter: /.*/}, (_args: any) => {
				return null; // Let default resolution handle all imports
			});

			// Intercept all imports
			build.onLoad({filter: /.*/}, async (args: any) => {
				// Only process imports with { assetBase: 'base-path' }
				if (!args.with?.assetBase || typeof args.with.assetBase !== "string") {
					return null; // Let other loaders handle it
				}

				try {
					// Read the file content
					const rawContent = readFileSync(args.path);
					const ext = extname(args.path);
					const name = basename(args.path, ext);

					// Check if this file needs transpilation
					const needsTranspilation = TRANSPILABLE_EXTENSIONS.has(ext);
					let content: Buffer;
					let outputExt = ext;
					let mimeType: string | undefined;

					if (needsTranspilation) {
						// Transpile TypeScript/JSX to JavaScript with Node.js polyfills for browser
						const clientOpts = config.clientBuild;

						// Default polyfill plugins for browser compatibility
						const defaultPlugins: ESBuild.Plugin[] = [
							NodeModulesPolyfillPlugin(),
							NodeGlobalsPolyfillPlugin({
								process: true,
								buffer: true,
							}),
						];

						// Merge user plugins with defaults (user plugins run first)
						const plugins = clientOpts.plugins
							? [...clientOpts.plugins, ...defaultPlugins]
							: defaultPlugins;

						const result = await ESBuild.build({
							entryPoints: [args.path],
							bundle: true,
							format: "esm",
							target: "es2022",
							platform: "browser",
							write: false,
							minify: true,
							// Apply polyfills and user-provided client build options
							plugins,
							define: clientOpts.define,
							inject: clientOpts.inject,
							external: clientOpts.external,
							alias: clientOpts.alias,
						});
						content = Buffer.from(result.outputFiles[0].text);
						outputExt = ".js";
						mimeType = "application/javascript";
					} else {
						content = rawContent;
						mimeType = mime.getType(args.path) || undefined;
					}

					// Generate content hash for cache busting (based on output content)
					const hash = createHash("sha256")
						.update(content)
						.digest("hex")
						.slice(0, config.hashLength);

					// Generate filename with correct extension
					let filename: string;
					if (config.includeHash) {
						filename = `${name}-${hash}${outputExt}`;
					} else {
						filename = `${name}${outputExt}`;
					}

					// Generate public URL using the base path from import attribute
					const basePath = normalizePath(args.with.assetBase);
					const publicURL = `${basePath}${filename}`;

					// Output directory: {outDir}/static/{assetBase}/
					// e.g., outDir="dist", assetBase="/assets" → dist/static/assets/
					const outputDir = join(config.outDir, "static", basePath);
					if (!existsSync(outputDir)) {
						mkdirSync(outputDir, {recursive: true});
					}

					// Write file to output directory
					const outputPath = join(outputDir, filename);
					writeFileSync(outputPath, content);

					// Create manifest entry
					const sourcePath = relative(process.cwd(), args.path);
					const manifestEntry: AssetManifestEntry = {
						source: sourcePath,
						output: filename,
						url: publicURL,
						hash,
						size: content.length,
						type: mimeType,
					};

					// Add to manifest
					manifest.assets[sourcePath] = manifestEntry;

					// Return as JavaScript module that exports the URL string
					return {
						contents: `export default ${JSON.stringify(publicURL)};`,
						loader: "js",
					};
				} catch (error: any) {
					return {
						errors: [
							{
								text: `Failed to process asset: ${error.message}`,
								detail: error,
							},
						],
					};
				}
			});

			// Write manifest file when build finishes
			build.onEnd(() => {
				try {
					// Manifest goes to {outDir}/server/asset-manifest.json
					const manifestPath = join(config.outDir, "server", "asset-manifest.json");
					const manifestDir = dirname(manifestPath);
					if (!existsSync(manifestDir)) {
						mkdirSync(manifestDir, {recursive: true});
					}

					// Write manifest file
					writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
					logger.info("Generated asset manifest", {
						path: manifestPath,
						assetCount: Object.keys(manifest.assets).length,
					});
				} catch (error: any) {
					logger.warn("Failed to write asset manifest", {error: error.message});
				}
			});
		},
	};
}

// Default export
export default assetsPlugin;
