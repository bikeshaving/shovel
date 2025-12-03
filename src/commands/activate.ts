import {DEFAULTS} from "../esbuild/config.js";
import {getLogger} from "@logtape/logtape";
import * as Platform from "@b9g/platform";
import * as ESBuild from "esbuild";
import {resolve, join, dirname} from "path";
import {mkdir, readFile} from "fs/promises";
import {fileURLToPath} from "url";
import {assetsPlugin} from "@b9g/assets/plugin";
import {importMetaPlugin} from "../esbuild/import-meta-plugin.js";
import {loadJSXConfig, applyJSXOptions} from "../esbuild/jsx-config.js";

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
	const entryDir = dirname(entryPath);
	const outputDir = resolve("dist");
	const serverDir = join(outputDir, "server");

	// Ensure output directories exist
	await mkdir(serverDir, {recursive: true});
	await mkdir(join(outputDir, "static"), {recursive: true});

	// Find workspace root for node resolution
	const workspaceRoot = await findWorkspaceRoot();

	// Load JSX configuration
	const jsxOptions = await loadJSXConfig(workspaceRoot || entryDir);

	// Get Shovel package root for resolving @b9g packages
	const shovelRoot = await findShovelPackageRoot();

	const outfile = join(serverDir, "server.js");

	const buildConfig: ESBuild.BuildOptions = {
		entryPoints: [entryPath],
		bundle: true,
		format: "esm",
		target: "es2022",
		platform: "node",
		outfile,
		absWorkingDir: workspaceRoot || entryDir,
		mainFields: ["module", "main"],
		conditions: ["import", "module"],
		nodePaths: [join(shovelRoot, "packages"), join(shovelRoot, "node_modules")],
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

/**
 * Find workspace root by looking for package.json with workspaces field
 */
async function findWorkspaceRoot() {
	let workspaceRoot = process.cwd();
	while (workspaceRoot !== dirname(workspaceRoot)) {
		try {
			const packageJSON = JSON.parse(
				await readFile(resolve(workspaceRoot, "package.json"), "utf8"),
			);
			if (packageJSON.workspaces) {
				return workspaceRoot;
			}
		} catch {
			// No package.json found, continue up the tree
		}
		workspaceRoot = dirname(workspaceRoot);
	}
	return process.cwd();
}

/**
 * Find the Shovel package root
 */
async function findShovelPackageRoot() {
	let currentDir = dirname(fileURLToPath(import.meta.url));
	let packageRoot = currentDir;
	while (packageRoot !== dirname(packageRoot)) {
		try {
			const packageJSONPath = join(packageRoot, "package.json");
			const content = await readFile(packageJSONPath, "utf8");
			const pkg = JSON.parse(content);
			if (pkg.name === "@b9g/shovel" || pkg.name === "shovel") {
				if (packageRoot.endsWith("/dist") || packageRoot.endsWith("\\dist")) {
					return dirname(packageRoot);
				}
				return packageRoot;
			}
		} catch {
			// Not found at this level, continue searching
		}
		packageRoot = dirname(packageRoot);
	}
	return currentDir;
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
