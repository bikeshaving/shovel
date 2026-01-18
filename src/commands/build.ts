/**
 * Production build system for Shovel apps
 * Creates self-contained, directly executable production builds
 */
import {resolve, join, dirname, basename} from "path";
import {getLogger} from "@logtape/logtape";
import {resolvePlatform, type Platform} from "@b9g/platform";
import {readFile, writeFile} from "fs/promises";
import type * as ESBuild from "esbuild";

import {ServerBundler} from "../utils/bundler.js";
import {findProjectRoot, findWorkspaceRoot} from "../utils/project.js";
import {createPlatform} from "../utils/platform.js";
import type {ProcessedShovelConfig} from "../utils/config.js";

const logger = getLogger(["shovel", "build"]);

/**
 * Format bytes to human readable string
 */
function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Log bundle sizes from metafile
 */
function logBundleSizes(metafile: ESBuild.Metafile): void {
	const outputs: {name: string; bytes: number}[] = [];

	for (const [outputPath, output] of Object.entries(metafile.outputs)) {
		if (!outputPath.endsWith(".js")) continue;
		outputs.push({
			name: basename(outputPath),
			bytes: output.bytes,
		});
	}

	// Sort by size descending
	outputs.sort((a, b) => b.bytes - a.bytes);

	const total = outputs.reduce((sum, o) => sum + o.bytes, 0);

	for (const output of outputs) {
		logger.info("{name}: {size}", {
			name: output.name,
			size: formatBytes(output.bytes),
		});
	}
	logger.info("Total: {size}", {size: formatBytes(total)});
	logger.info("(set shovel.build log level to debug for breakdown)");

	// Log detailed breakdown at debug level
	for (const [outputPath, output] of Object.entries(metafile.outputs)) {
		if (!outputPath.endsWith(".js")) continue;

		// Collect inputs by category
		const nodeModules: {path: string; bytes: number}[] = [];
		const sourceFiles: {path: string; bytes: number}[] = [];

		for (const [inputPath, input] of Object.entries(output.inputs)) {
			if (inputPath.includes("node_modules")) {
				nodeModules.push({path: inputPath, bytes: input.bytesInOutput});
			} else if (
				!inputPath.startsWith("<") &&
				!inputPath.startsWith("shovel:")
			) {
				sourceFiles.push({path: inputPath, bytes: input.bytesInOutput});
			}
		}

		// Sort by size and show top contributors
		nodeModules.sort((a, b) => b.bytes - a.bytes);
		const topDeps = nodeModules.slice(0, 5);

		if (topDeps.length > 0) {
			logger.debug("{output} top dependencies:", {
				output: basename(outputPath),
			});
			for (const dep of topDeps) {
				logger.debug("  {path}: {size}", {
					path: dep.path,
					size: formatBytes(dep.bytes),
				});
			}
		}
	}
}

/**
 * Build result returned to callers
 */
export interface BuildResult {
	/** Platform instance (for running lifecycle) */
	platform: Platform;
	/** Path to worker entry point */
	workerPath: string | undefined;
}

/**
 * Build ServiceWorker app for production deployment
 * Uses the unified ServerBundler for consistent build output across all commands
 */
export async function buildForProduction({
	entrypoint,
	outDir,
	platform = "node",
	userBuildConfig,
	lifecycle,
}: {
	entrypoint: string;
	outDir: string;
	platform?: string;
	userBuildConfig?: ProcessedShovelConfig["build"];
	lifecycle?: {stage: "install" | "activate"};
}): Promise<BuildResult> {
	const entryPath = resolve(entrypoint);
	const outputDir = resolve(outDir);
	const serverDir = join(outputDir, "server");
	const projectRoot = findProjectRoot(dirname(entryPath));

	logger.debug("Entry:", {entryPath});
	logger.debug("Output:", {outputDir});
	logger.debug("Target platform:", {platform});
	logger.debug("Project root:", {projectRoot});

	// Create platform instance
	const platformInstance = await createPlatform(platform);
	const platformESBuildConfig = platformInstance.getESBuildConfig();

	// Build using the unified bundler
	const bundler = new ServerBundler({
		entrypoint,
		outDir,
		platform: platformInstance,
		platformESBuildConfig,
		userBuildConfig,
		lifecycle,
	});

	const {success, outputs, metafile} = await bundler.build();
	if (!success) {
		throw new Error("Build failed");
	}

	// Generate package.json for self-contained deployment
	await generatePackageJSON({serverDir, platform, entryPath});

	logger.debug("Built app to", {outputDir});
	logger.debug("Server files", {dir: serverDir});
	logger.debug("Public files", {dir: join(outputDir, "public")});

	// Log bundle sizes
	if (metafile) {
		logBundleSizes(metafile);
	}

	// Report the main entry point (supervisor for Node/Bun, worker for Cloudflare)
	logger.info("Build complete: {path}", {
		path: outputs.index || outputs.worker,
	});

	return {
		platform: platformInstance,
		workerPath: outputs.worker,
	};
}

/**
 * Generate or copy package.json to output directory for self-contained deployment
 */
async function generatePackageJSON({
	serverDir,
	platform,
	entryPath,
}: {
	serverDir: string;
	platform: string;
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
		logger.debug("Copied package.json", {serverDir});
	} catch (error) {
		// If no package.json exists in source, generate one for executable builds
		logger.debug("Could not copy package.json: {error}", {error});

		try {
			const generatedPackageJson =
				await generateExecutablePackageJSON(platform);
			await writeFile(
				join(serverDir, "package.json"),
				JSON.stringify(generatedPackageJson, null, 2),
				"utf8",
			);
			logger.debug("Generated package.json", {platform});
		} catch (generateError) {
			logger.debug("Could not generate package.json: {error}", {
				error: generateError,
			});
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
	options: {platform?: string; lifecycle?: boolean | string},
	config: ProcessedShovelConfig,
) {
	// Use same platform resolution as develop command
	const platform = resolvePlatform({...options, config});

	// Determine lifecycle stage if --lifecycle is provided
	let lifecycleOption: {stage: "install" | "activate"} | undefined;
	if (options.lifecycle) {
		const stage =
			typeof options.lifecycle === "string" ? options.lifecycle : "activate";
		if (stage !== "install" && stage !== "activate") {
			throw new Error(
				`Invalid lifecycle stage: ${stage}. Must be "install" or "activate".`,
			);
		}
		lifecycleOption = {stage};
	}

	const {platform: platformInstance, workerPath} = await buildForProduction({
		entrypoint,
		outDir: "dist",
		platform,
		userBuildConfig: config.build,
		lifecycle: lifecycleOption,
	});

	// Run lifecycle if requested
	// --lifecycle [stage] runs the ServiceWorker lifecycle
	// - --lifecycle or --lifecycle activate: runs install + activate (default)
	// - --lifecycle install: runs install only
	if (lifecycleOption) {
		if (!workerPath) {
			throw new Error("No worker entry point found in build outputs");
		}

		const lifecycleStart = performance.now();
		logger.info("Running ServiceWorker lifecycle: {stage}", {
			stage: lifecycleOption.stage,
		});

		// Register and wait for ServiceWorker to be ready
		// Lifecycle runs at module load time - the worker reads config.lifecycle.stage
		await platformInstance.serviceWorker.register(workerPath);
		await platformInstance.serviceWorker.ready;

		// Terminate workers after lifecycle completes
		await platformInstance.serviceWorker.terminate();
		const lifecycleElapsed = Math.round(performance.now() - lifecycleStart);
		logger.info("Lifecycle complete in {elapsed}ms", {
			elapsed: lifecycleElapsed,
		});
	}

	await platformInstance.dispose();
}
