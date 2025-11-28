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

/**
 * File extensions that need transpilation
 */
const TRANSPILABLE_EXTENSIONS = new Set([".ts", ".tsx", ".jsx", ".mts", ".cts"]);

const logger = getLogger(["assets"]);

/**
 * Configuration for assets plugin (build-time)
 */
export interface AssetsPluginConfig {
	/**
	 * Directory to output assets
	 * @default 'dist/assets'
	 */
	outputDir?: string;

	/**
	 * Public URL path prefix
	 * @default '/assets/'
	 */
	publicPath?: string;

	/**
	 * Path to asset manifest file
	 * @default 'dist/server/asset-manifest.json'
	 */
	manifest?: string;

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
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Required<AssetsPluginConfig> = {
	outputDir: "dist/assets",
	publicPath: "/assets/",
	manifest: "dist/server/asset-manifest.json",
	hashLength: 8,
	includeHash: true,
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
		config: {
			publicPath: config.publicPath,
			outputDir: config.outputDir,
		},
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
						// Transpile TypeScript/JSX to JavaScript
						const result = await ESBuild.build({
							entryPoints: [args.path],
							bundle: true,
							format: "esm",
							target: "es2022",
							platform: "browser",
							write: false,
							minify: true,
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

					// Ensure output directory exists
					if (!existsSync(config.outputDir)) {
						mkdirSync(config.outputDir, {recursive: true});
					}

					// Write file to output directory
					const outputPath = join(config.outputDir, filename);
					writeFileSync(outputPath, content);

					// Generate public URL using the base path from import attribute
					const basePath = normalizePath(args.with.assetBase);
					const publicURL = `${basePath}${filename}`;

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
					// Ensure manifest directory exists
					const manifestDir = dirname(config.manifest);
					if (!existsSync(manifestDir)) {
						mkdirSync(manifestDir, {recursive: true});
					}

					// Write manifest file
					writeFileSync(config.manifest, JSON.stringify(manifest, null, 2));
					logger.info("Generated asset manifest", {
						path: config.manifest,
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
