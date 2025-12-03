import {DEFAULTS} from "../esbuild/config.js";
import {getLogger} from "@logtape/logtape";
import * as Platform from "@b9g/platform";
import * as ESBuild from "esbuild";
import {resolve, join} from "path";
import {mkdir} from "fs/promises";
import {assetsPlugin} from "@b9g/assets/plugin";
import {importMetaPlugin} from "../esbuild/import-meta-plugin.js";
import {loadJSXConfig, applyJSXOptions} from "../esbuild/jsx-config.js";
import {findProjectRoot, getNodeModulesPath} from "../utils/project.js";

const logger = getLogger(["cli"]);

export async function activateCommand(entrypoint, options) {
	try {
		const platformName = Platform.resolvePlatform(options);
		const workerCount = getWorkerCount(options);

		logger.debug("Platform: {platform}", {platform: platformName});
		logger.debug("Worker count: {workerCount}", {workerCount});

		// Build the entrypoint first (like develop/build commands do)
		// This processes asset imports via the assetsPlugin
		logger.info("Building ServiceWorker for activation");
		const builtEntrypoint = await buildForActivate(entrypoint);

		const platformInstance = await Platform.createPlatform(platformName);

		logger.info("Activating ServiceWorker", {});

		// Load the BUILT ServiceWorker (not the source file)
		const serviceWorker = await platformInstance.loadServiceWorker(
			builtEntrypoint,
			{
				hotReload: false,
				workerCount,
			},
		);

		// The ServiceWorker install/activate lifecycle will handle any self-generation
		// Apps can use self.dirs.open("static") in their activate event to pre-render
		logger.info(
			"ServiceWorker activated - check dist/ for generated content",
			{},
		);

		await serviceWorker.dispose();
		await platformInstance.dispose();
	} catch (error) {
		logger.error("ServiceWorker activation failed: {error}", {error});
		process.exit(1);
	}
}

/**
 * Build the entrypoint for activate command
 * Returns the path to the built file
 */
async function buildForActivate(entrypoint) {
	const entryPath = resolve(entrypoint);
	const outputDir = resolve("dist");
	const serverDir = join(outputDir, "server");

	// Ensure output directories exist
	await mkdir(serverDir, {recursive: true});
	await mkdir(join(outputDir, "static"), {recursive: true});

	// Find project root for node resolution
	const projectRoot = findProjectRoot();

	// Load JSX configuration
	const jsxOptions = await loadJSXConfig(projectRoot);

	const outfile = join(serverDir, "server.js");

	const buildConfig: ESBuild.BuildOptions = {
		entryPoints: [entryPath],
		bundle: true,
		format: "esm",
		target: "es2022",
		platform: "node",
		outfile,
		absWorkingDir: projectRoot,
		mainFields: ["module", "main"],
		conditions: ["import", "module"],
		nodePaths: [getNodeModulesPath()],
		plugins: [
			importMetaPlugin(),
			assetsPlugin({
				outDir: outputDir,
				clientBuild: {
					jsx: jsxOptions.jsx,
					jsxFactory: jsxOptions.jsxFactory,
					jsxFragment: jsxOptions.jsxFragment,
					jsxImportSource: jsxOptions.jsxImportSource,
				},
			}),
		],
		external: ["node:*"],
	};

	// Apply JSX configuration
	applyJSXOptions(buildConfig, jsxOptions);

	logger.debug("Building entrypoint: {entryPath}", {entryPath, outfile});

	await ESBuild.build(buildConfig);

	logger.debug("Build complete: {outfile}", {outfile});

	return outfile;
}

function getWorkerCount(options) {
	// Explicit CLI option takes precedence
	if (options.workers) {
		return parseInt(options.workers);
	}
	// Environment variable second
	if (process.env.WORKER_COUNT) {
		return parseInt(process.env.WORKER_COUNT);
	}
	// Default from config
	return DEFAULTS.WORKERS;
}
