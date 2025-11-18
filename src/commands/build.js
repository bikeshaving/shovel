/**
 * Production build system for Shovel apps
 * Creates self-contained, directly executable production builds
 */

import * as esbuild from "esbuild";
import {resolve, join, dirname} from "path";
import {mkdir, readFile, writeFile, chmod} from "fs/promises";
import {fileURLToPath} from "url";
import {assetsPlugin} from "@b9g/assets/plugin";
import {createEnvDefines} from "../build/env-defines.js";

// Build configuration constants
const BUILD_DEFAULTS = {
	format: "esm",
	target: "es2022",
	outputFile: "server.js",
	sourcemap: false,
	minify: false,
	treeShaking: true,
	environment: createEnvDefines("production"),
};

// Directory structure for separate buckets
const BUILD_STRUCTURE = {
	serverDir: "server",
	assetsDir: "assets",
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
	try {
		const buildContext = await initializeBuild({
			entrypoint,
			outDir,
			verbose,
			platform,
			workerCount,
		});
		const buildConfig = await createBuildConfig(buildContext);
		const result = await esbuild.build(buildConfig);

		// Make the output executable (for directly executable builds)
		const serverPath = join(buildContext.serverDir, "server.js");
		await chmod(serverPath, 0o755);

		if (verbose && result.metafile) {
			await logBundleAnalysis(result.metafile);
		}

		await generatePackageJson({
			...buildContext,
			entryPath: buildContext.entryPath,
		});

		if (verbose) {
			console.info(`📦 Built app to ${buildContext.outputDir}`);
			console.info(`📂 Server files: ${buildContext.serverDir}`);
			console.info(`📂 Asset files: ${buildContext.assetsDir}`);
		}
	} catch (error) {
		console.error(`❌ Build failed: ${error.message}`);
		if (verbose) {
			console.error(`📍 Error details:`, error);
			console.error(`📍 Stack trace:`, error.stack);
		}
		throw error;
	} finally {
		// Ensure esbuild resources are cleaned up
		// This helps prevent service corruption in test environments
		try {
			await esbuild.stop();
		} catch (stopError) {
			// Ignore errors during cleanup
		}
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

	const entryPath = resolve(entrypoint);
	const outputDir = resolve(outDir);

	// Validate entry point exists and is accessible
	try {
		const stats = await readFile(entryPath, "utf8");
		if (stats.length === 0) {
			console.warn(`⚠️  Entry point is empty: ${entryPath}`);
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
		console.info(`📂 Entry: ${entryPath}`);
		console.info(`📂 Output: ${outputDir}`);
		console.info(`🎯 Target platform: ${platform}`);
		console.info(`🏠 Workspace root: ${workspaceRoot}`);
	}

	// Ensure output directory structure exists
	try {
		await mkdir(outputDir, {recursive: true});
		await mkdir(join(outputDir, BUILD_STRUCTURE.serverDir), {recursive: true});
		await mkdir(join(outputDir, BUILD_STRUCTURE.assetsDir), {recursive: true});
	} catch (error) {
		throw new Error(
			`Failed to create output directory structure: ${error.message}`,
		);
	}

	return {
		entryPath,
		outputDir,
		serverDir: join(outputDir, BUILD_STRUCTURE.serverDir),
		assetsDir: join(outputDir, BUILD_STRUCTURE.assetsDir),
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
			const packageJson = JSON.parse(
				await readFile(resolve(workspaceRoot, "package.json"), "utf8"),
			);
			if (packageJson.workspaces) {
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
 * Create esbuild configuration for the target platform
 */
async function createBuildConfig({
	entryPath,
	serverDir,
	assetsDir,
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
		const external = ["node:*"];

		// For Node.js and Bun builds, handle @b9g dependencies
		if (!isCloudflare) {
			// Only externalize @b9g packages in very specific workspace test scenarios
			// For production executables, we always want to bundle for self-containment
			const isWorkspaceContext = workspaceRoot !== null;
			const isTestEnvironment =
				process.env.NODE_ENV === "test" ||
				entryPath.includes("/tmp/") ||
				entryPath.includes("test");

			if (
				isWorkspaceContext &&
				isTestEnvironment &&
				!entryPath.includes("executable")
			) {
				// Workspace test environment - externalize @b9g packages only for non-executable tests
				external.push("@b9g/*");
			} else {
				// Production/executable environment - bundle @b9g packages for self-contained builds
				// (no externalization needed)
			}
		}

		const buildConfig = {
			stdin: {
				contents: virtualEntry,
				resolveDir: workspaceRoot || dirname(entryPath),
				sourcefile: "virtual-entry.js",
			},
			bundle: true,
			format: BUILD_DEFAULTS.format,
			target: BUILD_DEFAULTS.target,
			platform: isCloudflare ? "browser" : "node",
			outfile: join(serverDir, BUILD_DEFAULTS.outputFile),
			absWorkingDir: workspaceRoot,
			mainFields: ["module", "main"],
			conditions: ["import", "module"],
			plugins: [
				assetsPlugin({
					outputDir: assetsDir,
					manifest: join(serverDir, "asset-manifest.json"),
				}),
			],
			metafile: true,
			sourcemap: BUILD_DEFAULTS.sourcemap,
			minify: BUILD_DEFAULTS.minify,
			treeShaking: BUILD_DEFAULTS.treeShaking,
			define: BUILD_DEFAULTS.environment,
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
	buildConfig.platform = "browser";
	buildConfig.conditions = ["worker", "browser"];

	try {
		const {cloudflareWorkerBanner, cloudflareWorkerFooter} = await import(
			"@b9g/platform-cloudflare"
		);
		buildConfig.banner = {js: cloudflareWorkerBanner};
		buildConfig.footer = {js: cloudflareWorkerFooter};
	} catch (error) {
		throw new Error(
			"@b9g/platform-cloudflare is required for Cloudflare builds. Install it with: bun add @b9g/platform-cloudflare",
		);
	}
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

	// For Node.js/Bun platforms, choose architecture based on worker count
	if (workerCount === 1) {
		return await createSingleWorkerEntry(userEntryPath);
	} else {
		return await createMultiWorkerEntry(userEntryPath, workerCount);
	}
}

/**
 * Create single-worker entry point using TypeScript template
 */
async function createSingleWorkerEntry(userEntryPath) {
	const templatePath = resolve(
		dirname(fileURLToPath(import.meta.url)),
		"../templates/single-worker-entry.ts",
	);

	const result = await esbuild.build({
		entryPoints: [templatePath],
		bundle: false, // Just transpile, don't bundle
		format: "esm",
		target: "es2022",
		platform: "node",
		write: false,
		define: {
			USER_ENTRYPOINT: JSON.stringify(userEntryPath),
		},
	});

	return result.outputFiles[0].text;
}

/**
 * Create multi-worker entry point using TypeScript template
 */
async function createMultiWorkerEntry(userEntryPath, workerCount) {
	const templatePath = resolve(
		dirname(fileURLToPath(import.meta.url)),
		"../templates/multi-worker-entry.ts",
	);

	const result = await esbuild.build({
		entryPoints: [templatePath],
		bundle: false, // Just transpile, don't bundle
		format: "esm",
		target: "es2022",
		platform: "node",
		write: false,
		define: {
			USER_ENTRYPOINT: JSON.stringify(userEntryPath),
			WORKER_COUNT: JSON.stringify(workerCount),
		},
	});

	return result.outputFiles[0].text;
}

/**
 * Log bundle analysis if metafile is available
 */
async function logBundleAnalysis(metafile) {
	try {
		console.info("📊 Bundle analysis:");
		const analysis = await esbuild.analyzeMetafile(metafile);
		console.info(analysis);
	} catch (error) {
		console.warn(`⚠️  Failed to analyze bundle: ${error.message}`);
	}
}

/**
 * Generate or copy package.json to output directory for self-contained deployment
 */
async function generatePackageJson({serverDir, platform, verbose, entryPath}) {
	// Look for package.json in the same directory as the entrypoint, not cwd
	const entryDir = dirname(entryPath);
	const sourcePackageJsonPath = resolve(entryDir, "package.json");

	try {
		// First try to copy existing package.json from source directory
		const packageJsonContent = await readFile(sourcePackageJsonPath, "utf8");

		// Validate package.json is valid JSON
		try {
			JSON.parse(packageJsonContent);
		} catch (parseError) {
			throw new Error(`Invalid package.json format: ${parseError.message}`);
		}

		await writeFile(
			join(serverDir, "package.json"),
			packageJsonContent,
			"utf8",
		);
		if (verbose) {
			console.info(`📄 Copied package.json to ${serverDir}`);
		}
	} catch (error) {
		// If no package.json exists in source, generate one for executable builds
		if (verbose) {
			console.warn(`⚠️  Could not copy package.json: ${error.message}`);
		}

		try {
			const generatedPackageJson =
				await generateExecutablePackageJson(platform);
			await writeFile(
				join(serverDir, "package.json"),
				JSON.stringify(generatedPackageJson, null, 2),
				"utf8",
			);
			if (verbose) {
				console.info(`📄 Generated package.json for ${platform} platform`);
				console.info(
					`📄 Package.json contents:`,
					JSON.stringify(generatedPackageJson, null, 2),
				);
			}
		} catch (generateError) {
			if (verbose) {
				console.warn(
					`⚠️  Could not generate package.json: ${generateError.message}`,
				);
				console.warn(`📍 Generation error details:`, generateError);
			}
			// Don't fail the build if package.json generation fails
		}
	}
}

/**
 * Generate a minimal package.json for executable builds
 */
async function generateExecutablePackageJson(platform) {
	const packageJson = {
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
		packageJson.dependencies = {};
	} else {
		// In production/published environment, add platform dependencies
		// Add platform-specific dependencies
		switch (platform) {
			case "node":
				packageJson.dependencies["@b9g/platform-node"] = "^0.1.0";
				break;
			case "bun":
				packageJson.dependencies["@b9g/platform-bun"] = "^0.1.0";
				break;
			case "cloudflare":
				packageJson.dependencies["@b9g/platform-cloudflare"] = "^0.1.0";
				break;
			default:
				// Generic platform dependencies
				packageJson.dependencies["@b9g/platform"] = "^0.1.0";
		}

		// Add core dependencies needed for runtime
		packageJson.dependencies["@b9g/cache"] = "^0.1.0";
		packageJson.dependencies["@b9g/filesystem"] = "^0.1.0";
	}

	return packageJson;
}
