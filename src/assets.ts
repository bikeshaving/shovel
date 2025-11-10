/**
 * ESBuild/Bun plugin for importing assets as URLs with manifest generation
 *
 * Updated to work with the new dist/assets organization and self.buckets API
 */

import {readFileSync, writeFileSync, mkdirSync, existsSync} from "fs";
import {createHash} from "crypto";
import {join, basename, extname, relative, dirname} from "path";
import {lookup} from "mime-types";

/**
 * Configuration for assets plugin and runtime handler
 */
export interface AssetsConfig {
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
 * Asset manifest entry
 */
export interface AssetManifestEntry {
	/** Original file path relative to source */
	source: string;
	/** Output file path relative to outputDir */
	output: string;
	/** Public URL for the asset */
	url: string;
	/** Content hash */
	hash: string;
	/** File size in bytes */
	size: number;
	/** MIME type */
	type?: string;
}

/**
 * Asset manifest structure
 */
export interface AssetManifest {
	/** Assets indexed by their source path */
	assets: Record<string, AssetManifestEntry>;
	/** Generation timestamp */
	generated: string;
	/** Configuration used */
	config: {
		publicPath: string;
		outputDir: string;
	};
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: Required<AssetsConfig> = {
	outputDir: "dist/assets",
	publicPath: "/assets/",
	manifest: "dist/server/asset-manifest.json",
	hashLength: 8,
	includeHash: true,
};

/**
 * Merge user config with defaults
 */
export function mergeConfig(
	userConfig: AssetsConfig = {},
): Required<AssetsConfig> {
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
 *
 * @example
 * import { assetsPlugin } from '@b9g/assets/plugin';
 *
 * await build({
 *   plugins: [assetsPlugin()]
 * });
 *
 * // In your code:
 * import logo from './logo.svg' with { assetBase: '/assets/' };
 * // Returns: "/assets/logo-abc12345.svg"
 */
export function assetsPlugin(options: AssetsConfig = {}) {
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
		setup(build) {
			// Handle resolution to ensure files get processed
			build.onResolve({filter: /.*/}, (_args) => {
				return null; // Let default resolution handle all imports
			});

			// Intercept all imports
			build.onLoad({filter: /.*/}, (args) => {
				// Only process imports with { assetBase: 'base-path' }
				if (!args.with?.assetBase || typeof args.with.assetBase !== "string") {
					return null; // Let other loaders handle it
				}

				try {
					// Read the file content
					const content = readFileSync(args.path);

					// Generate content hash for cache busting
					const hash = createHash("sha256")
						.update(content)
						.digest("hex")
						.slice(0, config.hashLength);

					// Generate filename
					let filename: string;
					if (config.includeHash) {
						const ext = extname(args.path);
						const name = basename(args.path, ext);
						filename = `${name}-${hash}${ext}`;
					} else {
						filename = basename(args.path);
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
					const publicUrl = `${basePath}${filename}`;

					// Create manifest entry
					const sourcePath = relative(process.cwd(), args.path);
					const manifestEntry: AssetManifestEntry = {
						source: sourcePath,
						output: filename,
						url: publicUrl,
						hash,
						size: content.length,
						type: lookup(args.path) || undefined,
					};

					// Add to manifest
					manifest.assets[sourcePath] = manifestEntry;

					// Return as JavaScript module that exports the URL string
					return {
						contents: `export default ${JSON.stringify(publicUrl)};`,
						loader: "js",
					};
				} catch (error) {
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
					console.info(
						`📦 Generated asset manifest: ${config.manifest} (${Object.keys(manifest.assets).length} assets)`,
					);
				} catch (error) {
					console.warn(`Failed to write asset manifest: ${error.message}`);
				}
			});
		},
	};
}

// Default export
export default assetsPlugin;
