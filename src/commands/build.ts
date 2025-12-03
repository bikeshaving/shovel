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
import {loadJSXConfig, applyJSXOptions} from "../esbuild/jsx-config.js";
import {
	extractProviders,
	generateProviderRegistry,
} from "../esbuild/provider-registry.js";
import {
	findProjectRoot,
	findWorkspaceRoot,
	getNodeModulesPath,
} from "../utils/project.js";
import {configure, getConsoleSink, getLogger} from "@logtape/logtape";
import {AsyncContext} from "@b9g/async-context";
import * as Platform from "@b9g/platform";
import {loadConfig, type ProcessedShovelConfig} from "@b9g/platform/config";

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
	config,
}: {
	entrypoint: string;
	outDir: string;
	verbose?: boolean;
	platform?: string;
	workerCount?: number;
	config?: ProcessedShovelConfig;
}) {
	const buildContext = await initializeBuild({
		entrypoint,
		outDir,
		verbose,
		platform,
		workerCount,
	});
	const buildConfig = await createBuildConfig({...buildContext, config});

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
		throw new Error(
			`Failed to create output directory structure: ${error.message}`,
		);
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
	platform,
	workerCount,
	config,
}: {
	entryPath: string;
	outputDir: string;
	serverDir: string;
	projectRoot: string;
	platform: string;
	workerCount: number;
	config?: ProcessedShovelConfig;
}) {
	const isCloudflare =
		platform === "cloudflare" || platform === "cloudflare-workers";

	// Load JSX configuration from tsconfig.json or use @b9g/crank defaults
	const jsxOptions = await loadJSXConfig(projectRoot || dirname(entryPath));

	try {
		// Create virtual entry point that properly imports platform dependencies
		const virtualEntry = await createVirtualEntry(
			entryPath,
			platform,
			workerCount,
			config,
		);

		// Determine external dependencies based on environment
		// Only externalize built-in Node.js modules (node:*)
		// Everything else gets bundled for self-contained executables
		const external = ["node:*"];

		// For Node/Bun, we need to build both the server entry and user code separately
		// The user code will be loaded by the platform's loadServiceWorker method
		if (!isCloudflare) {
			// Build user code separately
			const userBuildConfig: ESBuild.BuildOptions = {
				entryPoints: [entryPath],
				bundle: true,
				format: BUILD_DEFAULTS.format as ESBuild.Format,
				target: BUILD_DEFAULTS.target,
				platform: "node",
				outfile: join(serverDir, "server.js"),
				absWorkingDir: projectRoot,
				mainFields: ["module", "main"],
				conditions: ["import", "module"],
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
				// Node.js doesn't support import.meta.env, so alias it to process.env
				// Bun supports it natively, so don't replace
				define: platform === "node" ? {"import.meta.env": "process.env"} : {},
				external,
			};

			// Apply JSX configuration (from tsconfig.json or @b9g/crank defaults)
			applyJSXOptions(userBuildConfig, jsxOptions);

			// Build user code first
			const userBuildResult = await ESBuild.build(userBuildConfig);

			// Validate no non-bundleable dynamic imports in user code
			validateDynamicImports(userBuildResult, "user code");

			// Bundle runtime.js from @b9g/platform to server directory as worker.js
			// The ServiceWorkerPool needs this to run workers
			const runtimeSourcePath = join(
				getNodeModulesPath(),
				"@b9g/platform/dist/src/runtime.js",
			);
			const workerDestPath = join(serverDir, "worker.js");

			// Bundle runtime.js with all its dependencies
			// Note: No define needed - runtime.ts polyfills import.meta.env from process.env
			await ESBuild.build({
				entryPoints: [runtimeSourcePath],
				bundle: true,
				format: "esm",
				target: "es2022",
				platform: "node",
				outfile: workerDestPath,
				external: ["node:*"],
			});
		}

		// Note: worker-wrapper.js is no longer copied to build output
		// The @b9g/node-webworker package now embeds the wrapper code and creates it
		// in a temp directory at runtime, hiding this implementation detail

		const buildConfig: ESBuild.BuildOptions = {
			stdin: {
				contents: virtualEntry,
				resolveDir: projectRoot, // Resolve packages from user's project
				sourcefile: "virtual-entry.js",
			},
			bundle: true,
			format: BUILD_DEFAULTS.format as ESBuild.Format,
			target: BUILD_DEFAULTS.target,
			platform: isCloudflare ? "browser" : "node",
			// Cloudflare: single-file architecture (server.js contains everything)
			// Node/Bun: multi-file architecture (index.js is entry, server.js is user code)
			outfile: join(
				serverDir,
				isCloudflare ? "server.js" : BUILD_DEFAULTS.outputFile,
			),
			absWorkingDir: projectRoot,
			mainFields: ["module", "main"],
			conditions: ["import", "module"],
			// Resolve packages from the user's project node_modules
			nodePaths: [getNodeModulesPath()],
			plugins: isCloudflare
				? [
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

		// Apply JSX configuration for Cloudflare builds (user code is bundled inline)
		if (isCloudflare) {
			applyJSXOptions(buildConfig, jsxOptions);
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
async function createVirtualEntry(
	userEntryPath: string,
	platform: string,
	workerCount = 1,
	config?: ProcessedShovelConfig,
) {
	const isCloudflare =
		platform === "cloudflare" || platform === "cloudflare-workers";

	// Generate provider registry from config
	// This creates static imports for all configured providers so they can be bundled
	const registryCode = config
		? generateProviderRegistry(extractProviders(config))
		: "";

	if (isCloudflare) {
		// For Cloudflare Workers, import the user code directly
		// Cloudflare-specific runtime setup is handled by platform package
		return `${registryCode}
// Import user's ServiceWorker code
import "${userEntryPath}";
`;
	}

	// For Node.js/Bun platforms, use worker-based architecture
	// Works with any worker count (including 1)
	const workerEntry = await createWorkerEntry(
		userEntryPath,
		workerCount,
		platform,
	);
	return registryCode + workerEntry;
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
		} catch (err) {
			// Only ignore file-not-found errors, rethrow others
			if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
				throw err;
			}
			packageRoot = dirname(packageRoot);
		}
	}

	// Look for .ts in development, .js in production (dist)
	let templatePath = join(packageRoot, "src/worker-entry.ts");
	try {
		await readFile(templatePath, "utf8");
	} catch (err) {
		// Only ignore file-not-found errors, rethrow others
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
			throw err;
		}
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
		logger.warn("Failed to analyze bundle: {error}", {error});
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
async function generateExecutablePackageJSON(platform) {
	const packageJSON = {
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
export async function buildCommand(entrypoint: string, options: any) {
	// Load config from shovel.json or package.json
	const config = loadConfig(process.cwd());

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
		config,
	});

	// Workaround for Bun-specific issue: esbuild keeps child processes alive
	// even after build() completes, preventing the Node/Bun process from exiting.
	// This is documented in https://github.com/evanw/esbuild/issues/3558
	// Node.js exits naturally via reference counting, but Bun doesn't.
	process.exit(0);
}
