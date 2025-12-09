import * as ESBuild from "esbuild";
import {loadRawConfig, generateConfigModule} from "../utils/config.js";
/**
 * Create the shovel:config virtual module plugin.
 * This generates the config module at build time with:
 * - Static imports for provider modules (bundled, tree-shaken)
 * - process.env references for secrets (evaluated at runtime)
 */
export function createConfigPlugin(projectRoot: string): ESBuild.Plugin {
	const rawConfig = loadRawConfig(projectRoot);
	const configModuleCode = generateConfigModule(rawConfig);

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
