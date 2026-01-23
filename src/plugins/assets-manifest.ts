/**
 * ESBuild plugin for the shovel:assets virtual module.
 *
 * Provides build-time access to the asset manifest, allowing the assets
 * middleware to import the manifest directly rather than reading it from
 * the filesystem at runtime.
 *
 * This is essential for Cloudflare Workers where there's no filesystem
 * access to server files at runtime.
 */

import * as ESBuild from "esbuild";
import {existsSync, readFileSync} from "node:fs";
import {join, isAbsolute} from "node:path";
import {getLogger} from "@logtape/logtape";

const logger = getLogger(["shovel", "assets"]);

/**
 * Create the shovel:assets virtual module plugin.
 *
 * @param projectRoot - Root directory of the project
 * @param outDir - Output directory (relative to projectRoot, or absolute path)
 */
export function createAssetsManifestPlugin(
	projectRoot: string,
	outDir: string = "dist",
): ESBuild.Plugin {
	// Resolve outDir to absolute path once
	const absoluteOutDir = isAbsolute(outDir)
		? outDir
		: join(projectRoot, outDir);
	const manifestPath = join(absoluteOutDir, "server", "assets.json");

	return {
		name: "shovel-assets",
		setup(build) {
			// Intercept imports of "shovel:assets"
			build.onResolve({filter: /^shovel:assets$/}, (args) => ({
				path: args.path,
				namespace: "shovel-assets",
			}));

			// Return the manifest JSON as a module
			// The assets plugin writes the manifest during onEnd, but we read it
			// during onLoad. This works because:
			// 1. In production builds, assets are processed in a prior build phase
			// 2. In watch mode, rebuilds pick up the updated manifest
			build.onLoad({filter: /.*/, namespace: "shovel-assets"}, () => {
				let manifest = {assets: {}, generated: "", config: {outDir}};

				if (existsSync(manifestPath)) {
					try {
						manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
					} catch (err) {
						logger.warn(
							"Failed to parse assets manifest, using empty default",
							{
								path: manifestPath,
								error: err,
							},
						);
					}
				}

				return {
					contents: `export default ${JSON.stringify(manifest)};`,
					loader: "js",
				};
			});
		},
	};
}
