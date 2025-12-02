/**
 * Production build system for Shovel apps
 * Creates self-contained, directly executable production builds
 */

import * as ESBuild from "esbuild";
import {resolve, join, dirname} from "path";
import {mkdir, readFile, writeFile} from "fs/promises";
import {fileURLToPath} from "url";
import {assetsPlugin} from "@b9g/assets/plugin";
import {importMetaPlugin} from "../esbuild/import-meta-plugin.js";
import {configure, getConsoleSink, getLogger} from "@logtape/logtape";
import {AsyncContext} from "@b9g/async-context";
import * as Platform from "@b9g/platform";

// Configure LogTape for build command
await configure({
	reset: true,
	contextLocalStorage: new AsyncContext.Variable(),
	sinks: {
		console: getConsoleSink(),
	},
	loggers: [
		{category: ["logtape", "meta"], sinks: []},
		{category: ["cli"], level: "info", sinks: ["console"]},
		{category: ["assets"], level: "info", sinks: ["console"]},
	],
});

const logger = getLogger(["cli"]);

// Build configuration constants
const BUILD_DEFAULTS = {
	format: "esm",
	target: "es2022",
	outputFile: "index.js",
	sourcemap: false,
	minify: false,
	treeShaking: true,
};

// Directory structure for separate buckets
const BUILD_STRUCTURE = {
	serverDir: "server",
	staticDir: "static",
};

/**
 * Build ServiceWorker app for production deployment
 * Creates directly executable output with platform-specific bootstrapping
 */
export async function buildForProduction({
	entrypoint,
	outDir,
	verbose,
	platform = "node",
	workerCount = 1,
}) {
	const buildContext = await initializeBuild({
		entrypoint,
		outDir,
		verbose,
		platform,
		workerCount,
	});
	const buildConfig = await createBuildConfig(buildContext);

	// Use build() for one-time builds (not context API which is for watch/incremental)
	// This automatically handles cleanup and prevents process hanging
	const result = await ESBuild.build(buildConfig);

	if (verbose && result.metafile) {
		await logBundleAnalysis(result.metafile);
	}

	await generatePackageJSON({
		...buildContext,
		entryPath: buildContext.entryPath,
	});

	if (verbose) {
		logger.info("Built app to", {outputDir: buildContext.outputDir});
		logger.info("Server files", {dir: buildContext.serverDir});
		logger.info("Static files", {dir: join(buildContext.outputDir, "static")});
	}
}

/**
 * Initialize build context with validated paths and settings
 */
async function initializeBuild({
	entrypoint,
	outDir,
	verbose,
	platform,
	workerCount = 1,
}) {
	// Validate inputs
	if (!entrypoint) {
		throw new Error("Entry point is required");
	}
	if (!outDir) {
		throw new Error("Output directory is required");
	}

	if (verbose) {
		logger.info("Entry:", {path: entrypoint});
		logger.info("Output:", {dir: outDir});
		logger.info("Target platform:", {platform});
	}

	const entryPath = resolve(entrypoint);
	const outputDir = resolve(outDir);

	// Validate entry point exists and is accessible
	try {
		const stats = await readFile(entryPath, "utf8");
		if (stats.length === 0) {
			logger.warn("Entry point is empty", {entryPath});
		}
	} catch (error) {
		throw new Error(`Entry point not found or not accessible: ${entryPath}`);
	}

	// Validate platform
	const validPlatforms = ["node", "bun", "cloudflare", "cloudflare-workers"];
	if (!validPlatforms.includes(platform)) {
		throw new Error(
			`Invalid platform: ${platform}. Valid platforms: ${validPlatforms.join(", ")}`,
		);
	}

	const workspaceRoot = await findWorkspaceRoot();

	if (verbose) {
		logger.info("Entry:", {entryPath});
		logger.info("Output:", {outputDir});
		logger.info("Target platform:", {platform});
		logger.info("Workspace root:", {workspaceRoot});
	}

	// Ensure output directory structure exists
	try {
		await mkdir(outputDir, {recursive: true});
		await mkdir(join(outputDir, BUILD_STRUCTURE.serverDir), {recursive: true});
		await mkdir(join(outputDir, BUILD_STRUCTURE.staticDir), {recursive: true});
	} catch (error) {
		throw new Error(
			`Failed to create output directory structure: ${error.message}`,
		);
	}

	return {
		entryPath,
		outputDir,
		serverDir: join(outputDir, BUILD_STRUCTURE.serverDir),
		workspaceRoot,
		platform,
		verbose,
		workerCount,
	};
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
	return workspaceRoot;
}

/**
 * Find the Shovel package root (where @b9g packages can be resolved from)
 */
async function findShovelPackageRoot() {
	let currentDir = dirname(fileURLToPath(import.meta.url));
	let packageRoot = currentDir;
	while (packageRoot !== dirname(packageRoot)) {
		try {
			const packageJSONPath = join(packageRoot, "package.json");
			const content = await readFile(packageJSONPath, "utf8");
			const pkg = JSON.parse(content);
			// Check if this is the shovel package
			if (pkg.name === "@b9g/shovel" || pkg.name === "shovel") {
				// If we found it in a /dist directory, go up one more level to get source root
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
	// Fallback to current directory's node_modules parent
	return currentDir;
}

/**
 * Create esbuild configuration for the target platform
 */
async function createBuildConfig({
	entryPath,
	outputDir,
	serverDir,
	workspaceRoot,
	platform,
	workerCount,
}) {
	const isCloudflare =
		platform === "cloudflare" || platform === "cloudflare-workers";

	try {
		// Create virtual entry point that properly imports platform dependencies
		const virtualEntry = await createVirtualEntry(
			entryPath,
			platform,
			workerCount,
		);

		// Determine external dependencies based on environment
		// Only externalize built-in Node.js modules (node:*)
		// Everything else gets bundled for self-contained executables
		const external = ["node:*"];

		// Get Shovel package root for resolving @b9g packages
		const shovelRoot = await findShovelPackageRoot();

		// For Node/Bun, we need to build both the server entry and user code separately
		// The user code will be loaded by the platform's loadServiceWorker method
		if (!isCloudflare) {
			// Build user code separately
			const userBuildConfig = {
				entryPoints: [entryPath],
				bundle: true,
				format: BUILD_DEFAULTS.format,
				target: BUILD_DEFAULTS.target,
				platform: "node",
				outfile: join(serverDir, "server.js"),
				absWorkingDir: workspaceRoot || dirname(entryPath),
				mainFields: ["module", "main"],
				conditions: ["import", "module"],
				// Allow user code to import @b9g packages from shovel's packages directory
				nodePaths: [
					join(shovelRoot, "packages"),
					join(shovelRoot, "node_modules"),
				],
				plugins: [
					importMetaPlugin(),
					assetsPlugin({
						outDir: outputDir,
					}),
				],
				metafile: true,
				sourcemap: BUILD_DEFAULTS.sourcemap,
				minify: BUILD_DEFAULTS.minify,
				treeShaking: BUILD_DEFAULTS.treeShaking,
				// Node.js doesn't support import.meta.env, so alias it to process.env
				// Bun supports it natively, so don't replace
				define: platform === "node" ? {"import.meta.env": "process.env"} : {},
				external,
			};

			// Build user code first
			await ESBuild.build(userBuildConfig);

			// Bundle runtime.js from @b9g/platform to server directory as worker.js
			// The ServiceWorkerPool needs this to run workers
			const runtimeSourcePath = join(
				shovelRoot,
				"packages/platform/dist/src/runtime.js",
			);
			const workerDestPath = join(serverDir, "worker.js");

			// Bundle runtime.js with all its dependencies
			// Note: No define needed - runtime.ts polyfills import.meta.env from process.env
			try {
				await ESBuild.build({
					entryPoints: [runtimeSourcePath],
					bundle: true,
					format: "esm",
					target: "es2022",
					platform: "node",
					outfile: workerDestPath,
					external: ["node:*"],
				});
			} catch (error) {
				// Try from node_modules if development path fails
				const installedRuntimePath = join(
					shovelRoot,
					"node_modules/@b9g/platform/dist/src/runtime.js",
				);
				await ESBuild.build({
					entryPoints: [installedRuntimePath],
					bundle: true,
					format: "esm",
					target: "es2022",
					platform: "node",
					outfile: workerDestPath,
					external: ["node:*"],
				});
			}
		}

		// Note: worker-wrapper.js is no longer copied to build output
		// The @b9g/node-webworker package now embeds the wrapper code and creates it
		// in a temp directory at runtime, hiding this implementation detail

		const buildConfig = {
			stdin: {
				contents: virtualEntry,
				resolveDir: shovelRoot, // Use Shovel root to resolve @b9g packages
				sourcefile: "virtual-entry.js",
			},
			bundle: true,
			format: BUILD_DEFAULTS.format,
			target: BUILD_DEFAULTS.target,
			platform: isCloudflare ? "browser" : "node",
			// Cloudflare: single-file architecture (server.js contains everything)
			// Node/Bun: multi-file architecture (index.js is entry, server.js is user code)
			outfile: join(
				serverDir,
				isCloudflare ? "server.js" : BUILD_DEFAULTS.outputFile,
			),
			absWorkingDir: workspaceRoot || dirname(entryPath),
			mainFields: ["module", "main"],
			conditions: ["import", "module"],
			plugins: isCloudflare
				? [
						importMetaPlugin(),
						assetsPlugin({
							outDir: outputDir,
						}),
					]
				: [], // Assets already handled in user code build
			metafile: true,
			sourcemap: BUILD_DEFAULTS.sourcemap,
			minify: BUILD_DEFAULTS.minify,
			treeShaking: BUILD_DEFAULTS.treeShaking,
			// Node.js doesn't support import.meta.env, so alias it to process.env
			// Bun and Cloudflare support it natively, so don't replace
			define: platform === "node" ? {"import.meta.env": "process.env"} : {},
			external,
		};

		if (isCloudflare) {
			await configureCloudflareTarget(buildConfig);
		}

		return buildConfig;
	} catch (error) {
		throw new Error(`Failed to create build configuration: ${error.message}`);
	}
}

/**
 * Configure build for Cloudflare Workers target
 */
async function configureCloudflareTarget(buildConfig) {
	// Dynamically import platform-cloudflare only when targeting Cloudflare
	// This avoids requiring the package for node/bun builds
	const {cloudflareWorkerBanner, cloudflareWorkerFooter} = await import(
		"@b9g/platform-cloudflare"
	);
	buildConfig.platform = "browser";
	buildConfig.conditions = ["worker", "browser"];
	buildConfig.banner = {js: cloudflareWorkerBanner};
	buildConfig.footer = {js: cloudflareWorkerFooter};
}

/**
 * Create virtual entry point with proper imports and worker management
 */
async function createVirtualEntry(userEntryPath, platform, workerCount = 1) {
	const isCloudflare =
		platform === "cloudflare" || platform === "cloudflare-workers";

	if (isCloudflare) {
		// For Cloudflare Workers, import the user code directly
		// Cloudflare-specific runtime setup is handled by platform package
		return `
// Import user's ServiceWorker code
import "${userEntryPath}";
`;
	}

	// For Node.js/Bun platforms, use worker-based architecture
	// Works with any worker count (including 1)
	return await createWorkerEntry(userEntryPath, workerCount, platform);
}

/**
 * Create worker-based entry point using TypeScript template
 * Works for any worker count (including 1)
 * Returns both main entry and worker thread code
 */
async function createWorkerEntry(userEntryPath, workerCount, platform) {
	// Find package root by looking for package.json
	let currentDir = dirname(fileURLToPath(import.meta.url));
	let packageRoot = currentDir;
	while (packageRoot !== dirname(packageRoot)) {
		try {
			const packageJSONPath = join(packageRoot, "package.json");
			await readFile(packageJSONPath, "utf8");
			break;
		} catch {
			packageRoot = dirname(packageRoot);
		}
	}

	// Look for .ts in development, .js in production (dist)
	let templatePath = join(packageRoot, "src/worker-entry.ts");
	try {
		await readFile(templatePath, "utf8");
	} catch {
		// If .ts doesn't exist, try .js (for built dist version)
		templatePath = join(packageRoot, "src/worker-entry.js");
	}

	// Transpile the template
	const transpileResult = await ESBuild.build({
		entryPoints: [templatePath],
		bundle: false, // Just transpile - bundling happens in final build
		format: "esm",
		target: "es2022",
		platform: "node",
		write: false,
		define: {
			WORKER_COUNT: JSON.stringify(workerCount),
			PLATFORM: JSON.stringify(platform),
		},
	});

	return transpileResult.outputFiles[0].text;
}

/**
 * Log bundle analysis if metafile is available
 */
async function logBundleAnalysis(metafile) {
	try {
		logger.info("Bundle analysis:", {});
		const analysis = await ESBuild.analyzeMetafile(metafile);
		logger.info(analysis, {});
	} catch (error) {
		logger.warn("Failed to analyze bundle", {error: error.message});
	}
}

/**
 * Generate or copy package.json to output directory for self-contained deployment
 */
async function generatePackageJSON({serverDir, platform, verbose, entryPath}) {
	// Look for package.json in the same directory as the entrypoint, not cwd
	const entryDir = dirname(entryPath);
	const sourcePackageJsonPath = resolve(entryDir, "package.json");

	try {
		// First try to copy existing package.json from source directory
		const packageJSONContent = await readFile(sourcePackageJsonPath, "utf8");

		// Validate package.json is valid JSON
		try {
			JSON.parse(packageJSONContent);
		} catch (parseError) {
			throw new Error(`Invalid package.json format: ${parseError.message}`);
		}

		await writeFile(
			join(serverDir, "package.json"),
			packageJSONContent,
			"utf8",
		);
		if (verbose) {
			logger.info("Copied package.json", {serverDir});
		}
	} catch (error) {
		// If no package.json exists in source, generate one for executable builds
		if (verbose) {
			logger.warn("Could not copy package.json", {error: error.message});
		}

		try {
			const generatedPackageJson =
				await generateExecutablePackageJSON(platform);
			await writeFile(
				join(serverDir, "package.json"),
				JSON.stringify(generatedPackageJson, null, 2),
				"utf8",
			);
			if (verbose) {
				logger.info("Generated package.json", {platform});
				logger.info("Package.json contents", {
					contents: JSON.stringify(generatedPackageJson, null, 2),
				});
			}
		} catch (generateError) {
			if (verbose) {
				logger.warn("Could not generate package.json", {
					error: generateError.message,
				});
				logger.warn("Generation error details", {error: generateError});
			}
			// Don't fail the build if package.json generation fails
		}
	}
}

/**
 * Generate a minimal package.json for executable builds
 */
async function generateExecutablePackageJSON(platform) {
	const packageJSON = {
		name: "shovel-executable",
		version: "1.0.0",
		type: "module",
		private: true,
		dependencies: {},
	};

	// Check if we're in a workspace environment
	const workspaceRoot = await findWorkspaceRoot();
	const isWorkspaceEnvironment = workspaceRoot !== null;

	if (isWorkspaceEnvironment) {
		// In workspace environment (like tests), create empty dependencies
		// since workspace packages can't be installed via npm
		// The bundler will handle all necessary dependencies
		packageJSON.dependencies = {};
	} else {
		// In production/published environment, add platform dependencies
		// Add platform-specific dependencies
		switch (platform) {
			case "node":
				packageJSON.dependencies["@b9g/platform-node"] = "^0.1.0";
				break;
			case "bun":
				packageJSON.dependencies["@b9g/platform-bun"] = "^0.1.0";
				break;
			case "cloudflare":
				packageJSON.dependencies["@b9g/platform-cloudflare"] = "^0.1.0";
				break;
			default:
				// Generic platform dependencies
				packageJSON.dependencies["@b9g/platform"] = "^0.1.0";
		}

		// Add core dependencies needed for runtime
		packageJSON.dependencies["@b9g/cache"] = "^0.1.0";
		packageJSON.dependencies["@b9g/filesystem"] = "^0.1.0";
	}

	return packageJSON;
}

/**
 * CLI command wrapper for buildForProduction
 */
export async function buildCommand(entrypoint: string, options: any) {
	// Use same platform resolution as develop command
	const platform = Platform.resolvePlatform(options);

	await buildForProduction({
		entrypoint,
		outDir: "dist",
		verbose: options.verbose || false,
		platform,
		workerCount: options.workers ? parseInt(options.workers, 10) : 1,
	});

	// Workaround for Bun-specific issue: esbuild keeps child processes alive
	// even after build() completes, preventing the Node/Bun process from exiting.
	// This is documented in https://github.com/evanw/esbuild/issues/3558
	// Node.js exits naturally via reference counting, but Bun doesn't.
	process.exit(0);
}
