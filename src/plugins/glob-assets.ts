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
 * Extract the non-glob prefix from a pattern as the root directory.
 * e.g., "./public/**\/*.png" → "./public"
 *
 * Splits on "/" because import specifiers always use forward slashes.
 */
function getGlobRoot(pattern: string): string {
	const parts = pattern.split("/");
	const rootParts: string[] = [];
	for (const part of parts) {
		if (part.includes("*")) break;
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
			build.onResolve({filter: /\*/}, (args) => {
				if (!args.with?.assetBase) return null;

				return {
					path: args.path,
					namespace: GLOB_NAMESPACE,
					pluginData: {
						resolveDir: args.resolveDir,
						importAttributes: args.with,
					},
				};
			});

			// Expand glob and generate virtual module with individual imports
			build.onLoad({filter: /.*/, namespace: GLOB_NAMESPACE}, (args) => {
				const {resolveDir, importAttributes} = args.pluginData;
				const pattern = args.path;
				const assetBase = importAttributes.assetBase;

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

					// Build per-file attributes, forwarding all original attributes
					const fileAttrs: Record<string, string> = {
						...importAttributes,
					};

					// Adjust assetBase to include subdirectory
					let fileAssetBase = assetBase;
					if (fileDir && fileDir !== ".") {
						fileAssetBase = posix.join(assetBase, fileDir, "/");
					}
					if (!fileAssetBase.endsWith("/")) {
						fileAssetBase += "/";
					}
					fileAttrs.assetBase = fileAssetBase;

					// Serialize all attributes into the with clause
					const withClause = Object.entries(fileAttrs)
						.map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
						.join(", ");

					const importPath = file.startsWith(".") ? file : `./${file}`;

					imports.push(
						`import _${i} from ${JSON.stringify(importPath)} with { ${withClause} };`,
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
