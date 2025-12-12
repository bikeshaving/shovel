import * as ESBuild from "esbuild";
import {mkdirSync, writeFileSync} from "node:fs";
import {join, isAbsolute} from "node:path";
import {loadRawConfig, generateConfigModule} from "../utils/config.js";
import {
	discoverDatabases,
	discoverDirectoryNames,
	generateStorageTypes,
} from "../utils/database-types.js";

/**
 * Create the shovel:config virtual module plugin.
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
	const databases = discoverDatabases(projectRoot);
	const directoryNames = discoverDirectoryNames(projectRoot);

	if (databases.length > 0 || directoryNames.length > 0) {
		// Handle both relative and absolute outDir paths
		const outputDir = isAbsolute(outDir) ? outDir : join(projectRoot, outDir);
		const serverOutDir = join(outputDir, "server");
		mkdirSync(serverOutDir, {recursive: true});
		const typesCode = generateStorageTypes(
			databases,
			directoryNames,
			serverOutDir,
		);
		if (typesCode) {
			const typesPath = join(serverOutDir, "shovel.d.ts");
			writeFileSync(typesPath, typesCode);
		}
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
