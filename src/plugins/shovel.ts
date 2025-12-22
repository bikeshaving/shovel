/**
 * Shovel virtual module plugins for ESBuild.
 *
 * This module provides ESBuild plugins for Shovel's virtual modules:
 * - shovel:config - Generated config module with static imports and env vars
 * - shovel:entry - Virtual entry point wrapping user's ServiceWorker code
 *
 * These plugins are used by both the development watcher and production build.
 */

import * as ESBuild from "esbuild";
import {mkdirSync, writeFileSync} from "node:fs";
import {join, isAbsolute} from "node:path";
import {
	loadRawConfig,
	generateConfigModule,
	generateStorageTypes,
	type ShovelConfig,
} from "../utils/config.js";

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
 */
export function createConfigPlugin(
	projectRoot: string,
	outDir: string = "dist",
): ESBuild.Plugin {
	const rawConfig = loadRawConfig(projectRoot);
	const configModuleCode = generateConfigModule(rawConfig);

	// Generate storage types (for both develop and build)
	const typesCode = generateStorageTypes(rawConfig);
	if (typesCode) {
		// Handle both relative and absolute outDir paths
		const outputDir = isAbsolute(outDir) ? outDir : join(projectRoot, outDir);
		const serverOutDir = join(outputDir, "server");
		mkdirSync(serverOutDir, {recursive: true});
		const typesPath = join(serverOutDir, "shovel.d.ts");
		writeFileSync(typesPath, typesCode);
	}

	return {
		name: "shovel-config",
		setup(build) {
			// Intercept imports of "shovel:config"
			build.onResolve({filter: /^shovel:config$/}, (args) => ({
				path: args.path,
				namespace: "shovel-config",
			}));

			// Return generated config module code
			// resolveDir is required so esbuild can resolve imports in the virtual module
			build.onLoad({filter: /.*/, namespace: "shovel-config"}, () => ({
				contents: configModuleCode,
				loader: "js",
				resolveDir: projectRoot,
			}));
		},
	};
}

/**
 * Create the shovel:entry virtual module plugin.
 *
 * This provides a virtual entry point that wraps the user's ServiceWorker code
 * with runtime initialization (platform-specific bootstrapping).
 *
 * @param projectRoot - Root directory for import resolution
 * @param entryCode - The generated entry wrapper code
 */
export function createEntryPlugin(
	projectRoot: string,
	entryCode: string,
): ESBuild.Plugin {
	return {
		name: "shovel-entry",
		setup(build) {
			build.onResolve({filter: /^shovel:entry$/}, (args) => ({
				path: args.path,
				namespace: "shovel-entry",
			}));

			build.onLoad({filter: /.*/, namespace: "shovel-entry"}, () => ({
				contents: entryCode,
				loader: "js",
				resolveDir: projectRoot,
			}));
		},
	};
}

/**
 * Options for creating all shovel plugins at once.
 */
export interface ShovelPluginsOptions {
	/** Root directory of the project */
	projectRoot: string;
	/** Output directory (relative to projectRoot, or absolute path) */
	outDir?: string;
	/** Entry wrapper code for shovel:entry (optional - only needed for worker builds) */
	entryCode?: string;
}

/**
 * Create all shovel virtual module plugins.
 *
 * Convenience function to create both shovel:config and shovel:entry plugins.
 *
 * @param options - Plugin options
 * @returns Array of ESBuild plugins
 */
export function createShovelPlugins(
	options: ShovelPluginsOptions,
): ESBuild.Plugin[] {
	const plugins: ESBuild.Plugin[] = [
		createConfigPlugin(options.projectRoot, options.outDir),
	];

	if (options.entryCode) {
		plugins.push(createEntryPlugin(options.projectRoot, options.entryCode));
	}

	return plugins;
}
