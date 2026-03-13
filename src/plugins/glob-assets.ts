/**
 * ESBuild plugin for glob asset imports.
 *
 * Expands glob patterns in import paths into individual asset imports,
 * which then flow through the existing assetsPlugin pipeline.
 *
 * @example
 * // Import all images from ./public/ — each gets hashed and manifested
 * import urls from "./public/**\/*.{png,svg,ico}" with { assetBase: "/" };
 * // urls = { "logo.png": "/logo-abc123.png", "images/hero.png": "/images/hero-def456.png" }
 *
 * // Use assetName to preserve original filenames (no hashing)
 * import "./static/**\/*" with { assetBase: "/static/", assetName: "[name].[ext]" };
 *
 * // Side-effect import — files are processed but no URL map is needed
 * import "./public/**\/*.{png,svg}" with { assetBase: "/" };
 */

import {globSync} from "glob";
import {posix} from "path";
import type * as ESBuild from "esbuild";

const GLOB_NAMESPACE = "shovel-glob-assets";

/**
 * Detect whether an import path contains glob characters.
 */
function isGlobPattern(path: string): boolean {
	return path.includes("*") || path.includes("{") || path.includes("?");
}

/**
 * Extract the non-glob prefix from a pattern as the root directory.
 * e.g., "./public/**\/*.png" → "./public/"
 */
function getGlobRoot(pattern: string): string {
	const parts = pattern.split("/");
	const rootParts: string[] = [];
	for (const part of parts) {
		if (isGlobPattern(part)) break;
		rootParts.push(part);
	}
	return rootParts.join("/") || ".";
}

/**
 * ESBuild plugin for expanding glob patterns in asset imports.
 */
export function globAssetsPlugin(): ESBuild.Plugin {
	return {
		name: "shovel-glob-assets",
		setup(build) {
			// Intercept imports with glob patterns and assetBase attribute
			build.onResolve({filter: /[*?{]/}, (args) => {
				if (!args.with?.assetBase) return null;

				return {
					path: args.path,
					namespace: GLOB_NAMESPACE,
					pluginData: {
						resolveDir: args.resolveDir,
						assetBase: args.with.assetBase,
						assetName: args.with.assetName,
					},
				};
			});

			// Expand glob and generate virtual module with individual imports
			build.onLoad({filter: /.*/, namespace: GLOB_NAMESPACE}, (args) => {
				const {resolveDir, assetBase, assetName} = args.pluginData;
				const pattern = args.path;

				// Expand the glob relative to the resolve directory
				const files = globSync(pattern, {
					cwd: resolveDir,
					nodir: true,
					dot: false,
				});

				if (files.length === 0) {
					return {
						warnings: [
							{
								text: `Glob pattern "${pattern}" matched no files`,
							},
						],
						contents: "export default {};",
						loader: "js" as const,
					};
				}

				// Determine the root directory (non-glob prefix) for relative path computation
				const globRoot = getGlobRoot(pattern);

				// Generate individual import statements
				const imports: string[] = [];
				const exports: string[] = [];

				for (let i = 0; i < files.length; i++) {
					const file = files[i];
					// Compute path relative to glob root for directory structure preservation
					const relativeToRoot = posix.relative(globRoot, file);
					const fileDir = posix.dirname(relativeToRoot);

					// Compute per-file assetBase: user's base + subdirectory
					let fileAssetBase = assetBase;
					if (fileDir && fileDir !== ".") {
						fileAssetBase = posix.join(assetBase, fileDir, "/");
					}
					// Ensure trailing slash
					if (!fileAssetBase.endsWith("/")) {
						fileAssetBase += "/";
					}

					// Build the with clause
					const withParts = [`assetBase: ${JSON.stringify(fileAssetBase)}`];
					if (assetName) {
						withParts.push(`assetName: ${JSON.stringify(assetName)}`);
					}

					// Use ./ prefix for the import path relative to resolveDir
					const importPath = file.startsWith(".") ? file : `./${file}`;

					imports.push(
						`import _${i} from ${JSON.stringify(importPath)} with { ${withParts.join(", ")} };`,
					);
					exports.push(`${JSON.stringify(relativeToRoot)}: _${i}`);
				}

				const contents = [
					...imports,
					`export default { ${exports.join(", ")} };`,
				].join("\n");

				return {
					contents,
					loader: "js" as const,
					resolveDir,
				};
			});
		},
	};
}
