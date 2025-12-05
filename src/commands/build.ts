/**
 * Production build system for Shovel apps
 * Creates self-contained, directly executable production builds
 */

import * as ESBuild from "esbuild";
import {resolve, join, dirname} from "path";
import {mkdir, readFile, writeFile} from "fs/promises";
import {assetsPlugin} from "@b9g/assets/plugin";
import {importMetaPlugin} from "../utils/import-meta-plugin.js";
import {loadJSXConfig, applyJSXOptions} from "../utils/jsx-config.js";
import {
	findProjectRoot,
	findWorkspaceRoot,
	getNodeModulesPath,
} from "../utils/project.js";
import {getLogger} from "@logtape/logtape";
import * as Platform from "@b9g/platform";
import {loadRawConfig, generateConfigModule} from "../utils/config.js";
import type {ProcessedShovelConfig} from "../utils/config.js";

const logger = getLogger(["cli"]);

/**
 * Check esbuild warnings for non-bundleable dynamic imports and convert to errors.
 * Variable-based dynamic imports cannot be bundled and will fail at runtime
 * when node_modules is not available.
 */
function validateDynamicImports(
	result: ESBuild.BuildResult,
	context: string,
): void {
	const dynamicImportWarnings = (result.warnings || []).filter(
		(w) =>
			w.text.includes("cannot be bundled") ||
			w.text.includes("import() call") ||
			w.text.includes("dynamic import"),
	);

	if (dynamicImportWarnings.length > 0) {
		const locations = dynamicImportWarnings
			.map((w) => {
				const loc = w.location;
				const file = loc?.file || "unknown";
				const line = loc?.line || "?";
				return `  ${file}:${line} - ${w.text}`;
			})
			.join("\n");

		throw new Error(
			`Build failed (${context}): Non-analyzable dynamic imports found:\n${locations}\n\n` +
				`Dynamic imports must use literal strings, not variables.\n` +
				`For config-driven providers, ensure they are registered in shovel.json.`,
		);
	}
}

// Build configuration constants
const BUILD_DEFAULTS = {
	format: "esm",
	target: "es2022",
	outputFile: "index.js",
	sourcemap: false,
	minify: false,
	treeShaking: true,
};

// Directory structure for build output
const BUILD_STRUCTURE = {
	serverDir: "server",
	staticDir: "static",
};

/**
 * Create the shovel:config virtual module plugin.
 * This generates the config module at build time with:
 * - Static imports for provider modules (bundled, tree-shaken)
 * - process.env references for secrets (evaluated at runtime)
 */
function createConfigPlugin(projectRoot: string): ESBuild.Plugin {
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
			build.onLoad({filter: /.*/, namespace: "shovel-config"}, () => ({
				contents: configModuleCode,
				loader: "js",
			}));
		},
	};
}

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
}: {
	entrypoint: string;
	outDir: string;
	verbose?: boolean;
	platform?: string;
	workerCount?: number;
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

	// Validate no non-bundleable dynamic imports (would fail at runtime)
	validateDynamicImports(result, "main bundle");

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
}: {
	entrypoint: string;
	outDir: string;
	verbose?: boolean;
	platform: string;
	workerCount?: number;
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

	const projectRoot = findProjectRoot();

	if (verbose) {
		logger.info("Entry:", {entryPath});
		logger.info("Output:", {outputDir});
		logger.info("Target platform:", {platform});
		logger.info("Project root:", {projectRoot});
	}

	// Ensure output directory structure exists
	try {
		await mkdir(outputDir, {recursive: true});
		await mkdir(join(outputDir, BUILD_STRUCTURE.serverDir), {recursive: true});
		await mkdir(join(outputDir, BUILD_STRUCTURE.staticDir), {recursive: true});
	} catch (error) {
		throw new Error(`Failed to create output directory structure: ${error}`);
	}

	return {
		entryPath,
		outputDir,
		serverDir: join(outputDir, BUILD_STRUCTURE.serverDir),
		projectRoot,
		platform,
		verbose,
		workerCount,
	};
}

/**
 * Create esbuild configuration for the target platform
 */
async function createBuildConfig({
	entryPath,
	outputDir,
	serverDir,
	projectRoot,
	platform: platformName,
}: {
	entryPath: string;
	outputDir: string;
	serverDir: string;
	projectRoot: string;
	platform: string;
}) {
	// Create platform instance to get configuration
	const platform = await Platform.createPlatform(platformName);
	const platformEsbuildConfig = platform.getEsbuildConfig();
	const entryWrapper = platform.getEntryWrapper(entryPath);

	// Determine if platform bundles user code inline (like Cloudflare)
	// vs builds it separately and loads at runtime (like Node/Bun)
	const bundlesUserCodeInline =
		platformEsbuildConfig.bundlesUserCodeInline ?? false;

	// Load JSX configuration from tsconfig.json or use @b9g/crank defaults
	const jsxOptions = await loadJSXConfig(projectRoot || dirname(entryPath));

	try {
		// Determine external dependencies
		// Use platform-specific externals if provided, otherwise default to node:*
		const external = platformEsbuildConfig.external ?? ["node:*"];

		// For platforms that load user code at runtime (Node/Bun), build it separately
		// The wrapper's loadServiceWorker() will load ./server.js at runtime
		if (!bundlesUserCodeInline) {
			// Build user code separately
			const userBuildConfig: ESBuild.BuildOptions = {
				entryPoints: [entryPath],
				bundle: true,
				format: BUILD_DEFAULTS.format as ESBuild.Format,
				target: BUILD_DEFAULTS.target,
				platform: platformEsbuildConfig.platform ?? "node",
				outfile: join(serverDir, "server.js"),
				absWorkingDir: projectRoot,
				mainFields: ["module", "main"],
				conditions: platformEsbuildConfig.conditions ?? ["import", "module"],
				// Resolve packages from the user's project node_modules
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
				metafile: true,
				sourcemap: BUILD_DEFAULTS.sourcemap,
				minify: BUILD_DEFAULTS.minify,
				treeShaking: BUILD_DEFAULTS.treeShaking,
				define: platformEsbuildConfig.define ?? {},
				external,
			};

			// Apply JSX configuration (from tsconfig.json or @b9g/crank defaults)
			applyJSXOptions(userBuildConfig, jsxOptions);

			// Build user code first
			const userBuildResult = await ESBuild.build(userBuildConfig);

			// Validate no non-bundleable dynamic imports in user code
			validateDynamicImports(userBuildResult, "user code");

			// Build worker with virtual entry that configures logging via shovel:config
			// The ServiceWorkerPool needs this to run workers
			const workerDestPath = join(serverDir, "worker.js");

			// Virtual worker entry that configures logging before importing the actual worker
			const virtualWorkerEntry = `
import {configureLogging} from "@b9g/platform/runtime";
import {config} from "shovel:config";
await configureLogging(config.logging);

// Import the actual worker (runs its initialization code)
import "@b9g/platform/worker";
`;

			await ESBuild.build({
				stdin: {
					contents: virtualWorkerEntry,
					resolveDir: projectRoot,
					sourcefile: "virtual-worker-entry.js",
				},
				bundle: true,
				format: "esm",
				target: "es2022",
				platform: "node",
				outfile: workerDestPath,
				external: ["node:*"],
				plugins: [createConfigPlugin(projectRoot)],
			});
		}

		// All platforms now provide entry wrappers via getEntryWrapper()
		const buildConfig: ESBuild.BuildOptions = {
			stdin: {
				contents: entryWrapper,
				// Use serverDir so ./server.js resolves to the built user code
				resolveDir: serverDir,
				sourcefile: "virtual-entry.js",
			},
			bundle: true,
			format: BUILD_DEFAULTS.format as ESBuild.Format,
			target: BUILD_DEFAULTS.target,
			platform: platformEsbuildConfig.platform ?? "node",
			// Inline bundling (Cloudflare): single-file (server.js contains everything)
			// Separate bundling (Node/Bun): multi-file (index.js is entry, server.js is user code)
			outfile: join(
				serverDir,
				bundlesUserCodeInline ? "server.js" : BUILD_DEFAULTS.outputFile,
			),
			absWorkingDir: projectRoot,
			mainFields: ["module", "main"],
			conditions: platformEsbuildConfig.conditions ?? ["import", "module"],
			// Resolve packages from the user's project node_modules
			nodePaths: [getNodeModulesPath()],
			plugins: bundlesUserCodeInline
				? [
						createConfigPlugin(projectRoot),
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
					]
				: [createConfigPlugin(projectRoot)], // Config plugin needed for entry wrapper
			metafile: true,
			sourcemap: BUILD_DEFAULTS.sourcemap,
			minify: BUILD_DEFAULTS.minify,
			treeShaking: BUILD_DEFAULTS.treeShaking,
			define: platformEsbuildConfig.define ?? {},
			external,
		};

		// Apply JSX configuration for platforms that bundle user code inline
		if (bundlesUserCodeInline) {
			applyJSXOptions(buildConfig, jsxOptions);
		}

		return buildConfig;
	} catch (error) {
		throw new Error(`Failed to create build configuration: ${error}`);
	}
}

/**
 * Log bundle analysis if metafile is available
 */
async function logBundleAnalysis(metafile: ESBuild.Metafile) {
	try {
		logger.info("Bundle analysis:", {});
		const analysis = await ESBuild.analyzeMetafile(metafile);
		logger.info(analysis, {});
	} catch (error) {
		logger.warn("Failed to analyze bundle: {error}", {error});
	}
}

/**
 * Generate or copy package.json to output directory for self-contained deployment
 */
async function generatePackageJSON({
	serverDir,
	platform,
	verbose,
	entryPath,
}: {
	serverDir: string;
	platform: string;
	verbose?: boolean;
	entryPath: string;
}) {
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
			throw new Error(`Invalid package.json format: ${parseError}`);
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
			logger.warn("Could not copy package.json: {error}", {error});
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
				logger.warn("Could not generate package.json: {error}", {
					error: generateError,
				});
			}
			// Don't fail the build if package.json generation fails
		}
	}
}

/**
 * Generate a minimal package.json for executable builds
 */
async function generateExecutablePackageJSON(platform: string) {
	const packageJSON: {
		name: string;
		version: string;
		type: string;
		private: boolean;
		dependencies: Record<string, string>;
	} = {
		name: "shovel-executable",
		version: "1.0.0",
		type: "module",
		private: true,
		dependencies: {},
	};

	// Check if we're in a workspace environment
	const isWorkspaceEnvironment = findWorkspaceRoot() !== null;

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
export async function buildCommand(
	entrypoint: string,
	options: {workers?: string; verbose?: boolean; platform?: string},
	config: ProcessedShovelConfig,
) {
	// Use same platform resolution as develop command
	const platform = Platform.resolvePlatform({...options, config});

	await buildForProduction({
		entrypoint,
		outDir: "dist",
		verbose: options.verbose || false,
		platform,
		workerCount: options.workers
			? parseInt(options.workers, 10)
			: config.workers,
	});

	// Workaround for Bun-specific issue: esbuild keeps child processes alive
	// even after build() completes, preventing the Node/Bun process from exiting.
	// This is documented in https://github.com/evanw/esbuild/issues/3558
	// Node.js exits naturally via reference counting, but Bun doesn't.
	process.exit(0);
}
