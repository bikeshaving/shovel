/**
 * ESBuild plugin for importing assets as URLs with manifest generation
 *
 * This plugin handles build-time processing of assets with assetBase imports.
 * It generates content-hashed filenames and creates a manifest for runtime lookup.
 *
 * @example
 * import { assetsPlugin } from './plugins/assets.js';
 * import { build } from 'esbuild';
 *
 * await build({
 *   plugins: [assetsPlugin()],
 *   // ... other options
 * });
 *
 * // In your app code - default hashed filename:
 * import logo from './logo.svg' with { assetBase: '/assets/' };
 * // Returns: "/assets/logo-abc123def456.svg"
 *
 * // For well-known files, use assetName to control the output filename:
 * import favicon from './favicon.ico' with { assetBase: '/', assetName: 'favicon.ico' };
 * // Returns: "/favicon.ico"
 *
 * // assetName supports [name] and [ext] placeholders:
 * import img from './photo.png' with { assetBase: '/images/', assetName: '[name].[ext]' };
 * // Returns: "/images/photo.png"
 */

import {readFileSync, writeFileSync, mkdirSync, existsSync} from "fs";
import {createHash} from "crypto";
import {join, basename, extname, relative, dirname} from "path";
import mime from "mime";
import * as ESBuild from "esbuild";
import {
	type AssetManifest,
	type AssetManifestEntry,
} from "@b9g/assets/middleware";
import {getLogger} from "@logtape/logtape";
import {NodeModulesPolyfillPlugin} from "@esbuild-plugins/node-modules-polyfill";
import {NodeGlobalsPolyfillPlugin} from "@esbuild-plugins/node-globals-polyfill";

/**
 * File extensions that need transpilation (JS/TS files)
 */
const TRANSPILABLE_EXTENSIONS = new Set([
	".ts",
	".tsx",
	".jsx",
	".mts",
	".cts",
]);

/**
 * File extensions that need CSS bundling
 */
const CSS_EXTENSIONS = new Set([".css"]);

const logger = getLogger(["shovel"]);

/**
 * Configuration for assets plugin (build-time)
 */
export interface AssetsPluginConfig {
	/**
	 * Root output directory.
	 * Assets go to {outDir}/public/{assetBase}/
	 * Manifest goes to {outDir}/server/assets.json
	 * @default 'dist'
	 */
	outDir?: string;

	/**
	 * ESBuild plugins for asset bundling
	 */
	plugins?: ESBuild.Plugin[];

	/**
	 * ESBuild define
	 */
	define?: Record<string, string>;

	/**
	 * ESBuild inject
	 */
	inject?: string[];

	/**
	 * External packages
	 */
	external?: string[];

	/**
	 * Path aliases
	 */
	alias?: Record<string, string>;

	/**
	 * JSX transform mode: "transform" (classic), "automatic" (React 17+), or "preserve"
	 * @default "automatic"
	 */
	jsx?: "transform" | "preserve" | "automatic";

	/**
	 * JSX factory function (e.g., "createElement", "h", "React.createElement")
	 * Used when jsx is "transform"
	 */
	jsxFactory?: string;

	/**
	 * JSX fragment (e.g., "Fragment", "React.Fragment")
	 * Used when jsx is "transform"
	 */
	jsxFragment?: string;

	/**
	 * JSX import source for automatic runtime (e.g., "react", "preact", "@b9g/crank")
	 * Used when jsx is "automatic"
	 * @default "@b9g/crank"
	 */
	jsxImportSource?: string;
}

/** Hash length for content-based cache busting */
const HASH_LENGTH = 16;

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
	const outDir = options.outDir ?? "dist";
	const manifest: AssetManifest = {
		assets: {},
		generated: new Date().toISOString(),
		config: {
			outDir,
		},
	};

	// Cache esbuild contexts for incremental rebuilds (keyed by absolute path)
	const contexts = new Map<string, ESBuild.BuildContext>();

	return {
		name: "shovel-assets",
		setup(build: any) {
			// Handle resolution to ensure files get processed
			build.onResolve({filter: /.*/}, (_args: any) => {
				return null; // Let default resolution handle all imports
			});

			// Helper to get or create an esbuild context for incremental builds
			async function getContext(
				absPath: string,
				buildOptions: ESBuild.BuildOptions,
			): Promise<ESBuild.BuildContext> {
				let ctx = contexts.get(absPath);
				if (!ctx) {
					ctx = await ESBuild.context(buildOptions);
					contexts.set(absPath, ctx);
				}
				return ctx;
			}

			// Intercept all imports
			build.onLoad({filter: /.*/}, async (args: any) => {
				// Only process imports with { assetBase: 'base-path' }
				if (!args.with?.assetBase || typeof args.with.assetBase !== "string") {
					return null; // Let other loaders handle it
				}

				try {
					const ext = extname(args.path);
					const name = basename(args.path, ext);
					const wantsCSS = args.with.type === "css";

					// Check what type of file this is
					const needsTranspilation = TRANSPILABLE_EXTENSIONS.has(ext);
					const needsCSSBundling = CSS_EXTENSIONS.has(ext);

					logger.debug(
						"Processing asset: {path} ext={ext} needsCSS={needsCSSBundling} plugins={pluginCount}",
						{
							path: args.path,
							ext,
							needsCSSBundling,
							pluginCount: options.plugins?.length ?? 0,
						},
					);

					// Validate type: "css" usage
					if (wantsCSS && !needsTranspilation) {
						return {
							errors: [
								{
									text: `type: "css" can only be used with transpilable files (.ts, .tsx, .jsx, etc.), not ${ext}`,
								},
							],
						};
					}

					let content: Buffer;
					let outputExt = ext;
					let mimeType: string | undefined;

					if (needsTranspilation) {
						// Transpile TypeScript/JSX to JavaScript with Node.js polyfills for browser

						// Default polyfill plugins for browser compatibility
						const defaultPlugins: ESBuild.Plugin[] = [
							NodeModulesPolyfillPlugin(),
							NodeGlobalsPolyfillPlugin({
								process: true,
								buffer: true,
							}),
						];

						// Merge user plugins with defaults (user plugins run first)
						const plugins = options.plugins
							? [...options.plugins, ...defaultPlugins]
							: defaultPlugins;

						const ctx = await getContext(args.path, {
							entryPoints: [args.path],
							bundle: true,
							format: "esm",
							target: ["es2022", "chrome90"],
							platform: "browser",
							write: false,
							minify: true,
							// outdir is required for esbuild to know where to put extracted CSS
							outdir: outDir,
							// Apply polyfills and user-provided build options
							plugins,
							define: options.define,
							inject: options.inject,
							external: options.external,
							alias: options.alias,
							// Apply JSX configuration (defaults to @b9g/crank automatic runtime)
							jsx: options.jsx ?? "automatic",
							jsxFactory: options.jsxFactory,
							jsxFragment: options.jsxFragment,
							jsxImportSource: options.jsxImportSource ?? "@b9g/crank",
						});
						const result = await ctx.rebuild();
						if (!result.outputFiles) {
							return {
								errors: [{text: `No output files generated for ${args.path}`}],
							};
						}

						if (wantsCSS) {
							// Find the CSS output file
							const cssOutput = result.outputFiles.find((f) =>
								f.path.endsWith(".css"),
							);
							if (!cssOutput) {
								return {
									errors: [
										{
											text: `No CSS was extracted from ${args.path}. The file must import CSS for type: "css" to work.`,
										},
									],
								};
							}
							content = Buffer.from(cssOutput.text);
							outputExt = ".css";
							mimeType = "text/css";
						} else {
							// Find the JS output file
							const jsOutput = result.outputFiles.find((f) =>
								f.path.endsWith(".js"),
							);
							if (!jsOutput) {
								return {
									errors: [
										{
											text: `No JavaScript output was generated for ${args.path}`,
										},
									],
								};
							}
							content = Buffer.from(jsOutput.text);
							outputExt = ".js";
							mimeType = "application/javascript";
						}
					} else if (needsCSSBundling) {
						// Bundle CSS files through esbuild to resolve @import statements
						// Use a plugin to mark absolute URL paths as external (e.g., /assets/...)
						// but not filesystem absolute paths (e.g., /private/var/...)
						const entryPath = args.path;
						const externalAbsolutePathsPlugin: ESBuild.Plugin = {
							name: "external-absolute-paths",
							setup(build) {
								// Mark web-root absolute paths (starting with /) as external
								// but only if they're NOT the entry point and NOT filesystem paths
								build.onResolve({filter: /^\//}, (resolveArgs) => {
									// Skip entry points (they have kind: "entry-point")
									if (resolveArgs.kind === "entry-point") {
										return null;
									}
									// Mark as external (for CSS url() references like /assets/...)
									return {
										path: resolveArgs.path,
										external: true,
									};
								});
							},
						};

						// Merge user plugins with the external paths plugin
						const plugins: ESBuild.Plugin[] = [
							...(options.plugins || []),
							externalAbsolutePathsPlugin,
						];
						logger.debug("CSS bundling plugins: {plugins}", {
							plugins: plugins.map((p) => p.name),
						});

						const ctx = await getContext(entryPath, {
							entryPoints: [entryPath],
							bundle: true,
							write: false,
							minify: true,
							// outdir required for esbuild to generate output paths
							outdir: outDir,
							plugins,
							// Loaders for web assets referenced in CSS via url()
							loader: {
								// Fonts
								".woff": "file",
								".woff2": "file",
								".ttf": "file",
								".eot": "file",
								// Images
								".svg": "file",
								".png": "file",
								".jpg": "file",
								".jpeg": "file",
								".gif": "file",
								".webp": "file",
								".ico": "file",
								// Media
								".mp4": "file",
								".webm": "file",
								".mp3": "file",
								".ogg": "file",
							},
						});
						const result = await ctx.rebuild();
						// Find the CSS output file (esbuild may also output font/image files)
						const cssOutput = result.outputFiles?.find((f) =>
							f.path.endsWith(".css"),
						);
						if (!cssOutput) {
							return {
								errors: [{text: `No CSS output generated for ${args.path}`}],
							};
						}

						// Write out any other output files (fonts, images referenced in CSS)
						// These are placed relative to the CSS file location
						const basePath = normalizePath(args.with.assetBase);
						const cssOutputDir = join(outDir, "public", basePath);
						if (!existsSync(cssOutputDir)) {
							mkdirSync(cssOutputDir, {recursive: true});
						}
						for (const file of result.outputFiles || []) {
							if (file === cssOutput) continue;
							// Get just the filename from the output path
							const assetFilename = file.path.split("/").pop()!;
							const assetPath = join(cssOutputDir, assetFilename);
							writeFileSync(assetPath, file.contents);

							// Add to manifest so assets middleware can serve it
							const assetUrl = `${basePath}${assetFilename}`;
							const assetHash = createHash("sha256")
								.update(file.contents)
								.digest("hex")
								.slice(0, HASH_LENGTH);
							manifest.assets[assetFilename] = {
								source: assetFilename,
								output: assetFilename,
								url: assetUrl,
								hash: assetHash,
								size: file.contents.length,
								type: mime.getType(assetFilename) || undefined,
							};
						}

						content = Buffer.from(cssOutput.text);
						outputExt = ".css";
						mimeType = "text/css";
					} else {
						// Static assets - copy as-is
						content = readFileSync(args.path);
						mimeType = mime.getType(args.path) || undefined;
					}

					// Generate content hash for cache busting (based on output content)
					const hash = createHash("sha256")
						.update(content)
						.digest("hex")
						.slice(0, HASH_LENGTH);

					// Generate filename - use assetName if provided, otherwise generate with hash
					// assetName supports [name] and [ext] placeholders
					let filename: string;
					if (args.with.assetName && typeof args.with.assetName === "string") {
						// Use explicit filename (e.g., "favicon.ico" or "[name].[ext]")
						filename = args.with.assetName
							.replace(/\[name\]/g, name)
							.replace(/\[ext\]/g, outputExt.slice(1)); // remove leading dot
					} else {
						filename = `${name}-${hash}${outputExt}`;
					}

					// Generate public URL using the base path from import attribute
					const basePath = normalizePath(args.with.assetBase);
					const publicURL = `${basePath}${filename}`;

					// Output directory: {outDir}/public/{assetBase}/
					// e.g., outDir="dist", assetBase="/assets" → dist/public/assets/
					const outputDir = join(outDir, "public", basePath);
					if (!existsSync(outputDir)) {
						mkdirSync(outputDir, {recursive: true});
					}

					// Write file to output directory
					const outputPath = join(outputDir, filename);
					writeFileSync(outputPath, content);

					// Create manifest entry
					// eslint-disable-next-line no-restricted-properties -- esbuild plugin runs in build context
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

			// Write manifest file and clean up contexts when build finishes
			build.onEnd(async () => {
				// Dispose all esbuild contexts
				for (const ctx of contexts.values()) {
					await ctx.dispose();
				}
				contexts.clear();

				try {
					// Manifest goes to {outDir}/server/assets.json
					// Server bucket keeps it non-public (contains internal build metadata)
					const manifestPath = join(outDir, "server", "assets.json");
					const manifestDir = dirname(manifestPath);
					if (!existsSync(manifestDir)) {
						mkdirSync(manifestDir, {recursive: true});
					}

					// Write manifest file
					writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
					logger.debug("Generated asset manifest", {
						path: manifestPath,
						assetCount: Object.keys(manifest.assets).length,
					});
				} catch (error: any) {
					logger.warn("Failed to write asset manifest: {error}", {error});
				}
			});
		},
	};
}

// Default export
export default assetsPlugin;
