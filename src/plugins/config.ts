/**
 * ESBuild plugin for the shovel:config virtual module.
 *
 * Generates a config module at build time with:
 * - Static imports for provider modules (bundled, tree-shaken)
 * - process.env references for secrets (evaluated at runtime)
 *
 * Also generates typed overloads for storage APIs in dist/server/shovel.d.ts.
 */

import * as ESBuild from "esbuild";
import {mkdirSync, writeFileSync} from "node:fs";
import {join, isAbsolute} from "node:path";
import {
	loadRawConfig,
	generateConfigModule,
	generateStorageTypes,
} from "../utils/config.js";

/**
 * Options for the shovel:config plugin
 */
export interface ConfigPluginOptions {
	/** Platform-specific defaults for directories, caches, etc. */
	platformDefaults?: {
		directories?: Record<
			string,
			{module: string; export?: string; [key: string]: unknown}
		>;
		caches?: Record<
			string,
			{module: string; export?: string; [key: string]: unknown}
		>;
	};
	/** Lifecycle options for --lifecycle flag */
	lifecycle?: {
		/** Lifecycle stage to run: "install" or "activate" */
		stage: "install" | "activate";
	};
}

/**
 * Create the shovel:config virtual module plugin.
 *
 * This generates the config module at build time with:
 * - Static imports for provider modules (bundled, tree-shaken)
 * - process.env references for secrets (evaluated at runtime)
 *
 * Also generates typed overloads for storage APIs in dist/server/shovel.d.ts:
 * - DatabaseStorage.open() - typed Database instances
 * - DirectoryStorage.open() - validated directory names
 *
 * @param projectRoot - Root directory of the project
 * @param outDir - Output directory (relative to projectRoot, or absolute path)
 * @param options - Plugin options including platform defaults
 */
export function createConfigPlugin(
	projectRoot: string,
	outDir: string = "dist",
	options: ConfigPluginOptions = {},
): ESBuild.Plugin {
	// Resolve outDir to absolute path once
	const absoluteOutDir = isAbsolute(outDir)
		? outDir
		: join(projectRoot, outDir);
	const serverOutDir = join(absoluteOutDir, "server");

	return {
		name: "shovel-config",
		setup(build) {
			// Intercept imports of "shovel:config"
			build.onResolve({filter: /^shovel:config$/}, (args) => ({
				path: args.path,
				namespace: "shovel-config",
			}));

			// Return generated config module code
			// Reload config on each build to support hot reload of shovel.json changes
			// resolveDir is required so esbuild can resolve imports in the virtual module
			build.onLoad({filter: /.*/, namespace: "shovel-config"}, () => {
				// Reload config fresh on each build (watch mode may have changed shovel.json)
				const rawConfig = loadRawConfig(projectRoot);
				const configModuleCode = generateConfigModule(rawConfig, {
					projectDir: projectRoot,
					outDir: absoluteOutDir,
					platformDefaults: options.platformDefaults,
					lifecycle: options.lifecycle,
				});

				// Generate storage types (for both develop and build)
				// Include platform defaults so types match the runtime config
				const typesCode = generateStorageTypes(rawConfig, {
					platformDefaults: options.platformDefaults,
				});
				if (typesCode) {
					mkdirSync(serverOutDir, {recursive: true});
					const typesPath = join(serverOutDir, "shovel.d.ts");
					writeFileSync(typesPath, typesCode);
				}

				// Tell esbuild to watch config files so changes trigger a rebuild.
				// Always include both paths — esbuild handles non-existent files
				// by watching for their creation via the parent directory.
				const watchFiles = [
					join(projectRoot, "shovel.json"),
					join(projectRoot, "package.json"),
				];

				return {
					contents: configModuleCode,
					loader: "js",
					resolveDir: projectRoot,
					watchFiles,
				};
			});
		},
	};
}
