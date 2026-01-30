/**
 * ESBuild plugin for the shovel:assets virtual module.
 *
 * Provides build-time access to the asset manifest, allowing the assets
 * middleware to import the manifest directly rather than reading it from
 * the filesystem at runtime.
 *
 * This is essential for Cloudflare Workers where there's no filesystem
 * access to server files at runtime.
 *
 * The manifest is shared between this plugin and the assets plugin via
 * a shared object. The assets plugin populates the manifest during onLoad,
 * and this plugin reads it during onEnd to replace the placeholder.
 *
 * Since ESBuild resolves imports in dependency order (shovel:assets may be
 * loaded before asset files are processed), we use a placeholder marker
 * during onLoad and replace it with the actual manifest in onEnd after
 * all assets have been processed.
 */

import * as ESBuild from "esbuild";
import {existsSync, readFileSync, writeFileSync} from "node:fs";
import {join, isAbsolute} from "node:path";
import {getLogger} from "@logtape/logtape";

const logger = getLogger(["shovel", "assets"]);

/**
 * Unique marker for the placeholder manifest.
 * This gets replaced with actual manifest content in onEnd.
 */
const MANIFEST_PLACEHOLDER = "__SHOVEL_ASSETS_MANIFEST_PLACEHOLDER__";

/**
 * Shared manifest state between assets plugin and manifest plugin.
 * The assets plugin writes to this, the manifest plugin reads from it.
 */
export interface SharedAssetsManifest {
	assets: Record<string, unknown>;
	generated: string;
	config: {outDir: string};
}

/**
 * Create a shared manifest object that both plugins can access.
 */
export function createSharedManifest(outDir: string): SharedAssetsManifest {
	return {
		assets: {},
		generated: "",
		config: {outDir},
	};
}

/**
 * Create the shovel:assets virtual module plugin.
 *
 * @param projectRoot - Root directory of the project
 * @param outDir - Output directory (relative to projectRoot, or absolute path)
 * @param sharedManifest - Optional shared manifest from assets plugin
 */
export function createAssetsManifestPlugin(
	projectRoot: string,
	outDir: string = "dist",
	sharedManifest?: SharedAssetsManifest,
): ESBuild.Plugin {
	// Resolve outDir to absolute path once
	const absoluteOutDir = isAbsolute(outDir)
		? outDir
		: join(projectRoot, outDir);
	const manifestPath = join(absoluteOutDir, "server", "assets.json");

	return {
		name: "shovel-assets-manifest",
		setup(build) {
			// Intercept imports of "shovel:assets"
			build.onResolve({filter: /^shovel:assets$/}, (args) => ({
				path: args.path,
				namespace: "shovel-assets",
			}));

			// Return a placeholder during build - replaced in onEnd after assets are processed
			build.onLoad({filter: /.*/, namespace: "shovel-assets"}, () => {
				// If we have a shared manifest (watch mode via ServerBundler), always use
				// the placeholder approach. This ensures we get the CURRENT build's manifest
				// from onEnd, not a stale one from disk.
				if (sharedManifest) {
					return {
						contents: `export default ${MANIFEST_PLACEHOLDER};`,
						loader: "js",
					};
				}

				// For standalone builds without sharedManifest, try to read from filesystem
				if (existsSync(manifestPath)) {
					try {
						const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
						return {
							contents: `export default ${JSON.stringify(manifest)};`,
							loader: "js",
						};
					} catch (err) {
						logger.warn("Failed to parse assets manifest, using placeholder", {
							path: manifestPath,
							error: err,
						});
					}
				}

				// Return placeholder - will be replaced in onEnd with actual manifest
				return {
					contents: `export default ${MANIFEST_PLACEHOLDER};`,
					loader: "js",
				};
			});

			// After build completes, replace placeholder with actual manifest
			build.onEnd((result) => {
				if (!sharedManifest) return;

				// Generate final manifest content
				const manifestContent = JSON.stringify(sharedManifest);

				// Find and update output files that contain the placeholder
				if (result.outputFiles) {
					// When write: false, we can modify outputFiles directly
					for (const file of result.outputFiles) {
						if (file.text.includes(MANIFEST_PLACEHOLDER)) {
							const newText = file.text.replace(
								MANIFEST_PLACEHOLDER,
								manifestContent,
							);
							// Update the file contents
							(file as any).contents = new TextEncoder().encode(newText);
						}
					}
				} else {
					// When write: true, we need to read/modify/write the files
					// This is the production build case
					const serverDir = join(absoluteOutDir, "server");
					const jsFiles = ["worker.js", "index.js"];

					for (const jsFile of jsFiles) {
						const filePath = join(serverDir, jsFile);
						if (existsSync(filePath)) {
							try {
								const content = readFileSync(filePath, "utf8");
								if (content.includes(MANIFEST_PLACEHOLDER)) {
									const newContent = content.replace(
										MANIFEST_PLACEHOLDER,
										manifestContent,
									);
									writeFileSync(filePath, newContent, "utf8");
									logger.debug("Updated {file} with asset manifest", {
										file: jsFile,
									});
								}
							} catch (err) {
								logger.warn("Failed to update {file} with manifest: {error}", {
									file: jsFile,
									error: err,
								});
							}
						}
					}
				}
			});
		},
	};
}
