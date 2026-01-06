import {DEFAULTS} from "../utils/config.js";
import {getLogger} from "@logtape/logtape";
import * as Platform from "@b9g/platform";
import type {ProcessedShovelConfig} from "../utils/config.js";
import type {PlatformESBuildConfig} from "@b9g/platform";
import * as ESBuild from "esbuild";
import {resolve, join} from "path";
import {mkdir} from "fs/promises";
import {assetsPlugin} from "../plugins/assets.js";
import {importMetaPlugin} from "../plugins/import-meta.js";
import {loadJSXConfig, applyJSXOptions} from "../utils/jsx-config.js";
import {findProjectRoot, getNodeModulesPath} from "../utils/project.js";

const logger = getLogger(["shovel"]);

export async function activateCommand(
	entrypoint: string,
	options: {workers?: string; verbose?: boolean; platform?: string},
	config: ProcessedShovelConfig,
) {
	try {
		const platformName = Platform.resolvePlatform({...options, config});
		const workerCount = getWorkerCount(options, config);

		logger.debug("Platform: {platform}", {platform: platformName});
		logger.debug("Worker count: {workerCount}", {workerCount});

		// Create platform first to get esbuild config
		const platformInstance = await Platform.createPlatform(platformName);
		const platformESBuild = platformInstance.getESBuildConfig();

		// Build the entrypoint first (like develop/build commands do)
		// This processes asset imports via the assetsPlugin
		logger.info("Building ServiceWorker for activation");
		const builtEntrypoint = await buildForActivate(entrypoint, platformESBuild);

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
		// Apps can use self.directories.open("public") in their activate event to pre-render
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
async function buildForActivate(
	entrypoint: string,
	platformESBuildConfig: PlatformESBuildConfig,
) {
	const entryPath = resolve(entrypoint);
	const outputDir = resolve("dist");
	const serverDir = join(outputDir, "server");

	// Ensure output directories exist
	await mkdir(serverDir, {recursive: true});
	await mkdir(join(outputDir, "public"), {recursive: true});

	// Find project root for node resolution
	const projectRoot = findProjectRoot();

	// Load JSX configuration
	const jsxOptions = await loadJSXConfig(projectRoot);

	const outfile = join(serverDir, "server.js");

	// Use platform-specific externals
	const external = platformESBuildConfig.external ?? ["node:*"];

	const buildConfig: ESBuild.BuildOptions = {
		entryPoints: [entryPath],
		bundle: true,
		format: "esm",
		target: "es2022",
		platform: platformESBuildConfig.platform ?? "node",
		outfile,
		absWorkingDir: projectRoot,
		mainFields: ["module", "main"],
		conditions: platformESBuildConfig.conditions ?? ["import", "module"],
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
		define: platformESBuildConfig.define ?? {},
		external,
	};

	// Apply JSX configuration
	applyJSXOptions(buildConfig, jsxOptions);

	logger.debug("Building entrypoint: {entryPath}", {entryPath, outfile});

	await ESBuild.build(buildConfig);

	logger.debug("Build complete: {outfile}", {outfile});

	return outfile;
}

function getWorkerCount(
	options: {workers?: string},
	config: {workers?: number} | null,
) {
	// CLI option overrides everything (explicit user intent)
	if (options.workers) {
		return parseInt(options.workers, 10);
	}
	// Config already handles: json value > WORKERS env > default
	return config?.workers ?? DEFAULTS.WORKERS;
}
