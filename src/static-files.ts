import {readFileSync, writeFileSync, mkdirSync, existsSync} from "fs";
import {createHash} from "crypto";
import {join, basename, extname, relative, dirname} from "path";
import {fileURLToPath} from "url";
import {lookup} from "mime-types";
import type {
	AssetsConfig,
	AssetManifest,
	AssetManifestEntry,
} from "./shared.ts";
import {mergeConfig} from "./shared.ts";

/**
 * ESBuild/Bun plugin for importing assets as URLs with manifest generation
 *
 * @param options - Plugin configuration options
 * @returns ESBuild/Bun plugin
 *
 * @example
 * import { staticFilesPlugin } from '@b9g/staticfiles/plugin';
 *
 * await build({
 *   plugins: [staticFilesPlugin()]
 * });
 *
 * // In your code:
 * import logo from './logo.svg' with { url: '/static/' };
 * // Returns: "/static/logo-abc12345.svg"
 */
export function staticFilesPlugin(options: AssetsConfig = {}) {
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
		name: "shovel-staticfiles",
		setup(build) {
			// Handle resolution to ensure files get processed
			build.onResolve({filter: /.*/}, (args) => {
				console.log(`[staticFilesPlugin] onResolve called:`, {
					path: args.path,
					with: args.with,
					importer: args.importer,
				});

				return null; // Let default resolution handle all imports
			});

			// Intercept all imports
			build.onLoad({filter: /.*/}, (args) => {
				console.log(`[staticFilesPlugin] onLoad called:`, {
					path: args.path,
					with: args.with,
					namespace: args.namespace,
				});

				// Only process imports with { url: 'base-path' }
				if (!args.with?.url || typeof args.with.url !== "string") {
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
					const basePath = args.with.url;
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
					console.log(
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
export default staticFilesPlugin;
