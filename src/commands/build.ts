/**
 * Production build system for Shovel apps
 * Creates self-contained, directly executable production builds
 */
import {resolve, join, dirname} from "path";
import {getLogger} from "@logtape/logtape";
import * as Platform from "@b9g/platform";
import {readFile, writeFile} from "fs/promises";

import {ServerBundler} from "../utils/bundler.js";
import {findProjectRoot, findWorkspaceRoot} from "../utils/project.js";
import type {ProcessedShovelConfig} from "../utils/config.js";

const logger = getLogger(["shovel"]);

/**
 * Build ServiceWorker app for production deployment
 * Uses the unified ServerBundler for consistent build output across all commands
 */
export async function buildForProduction({
	entrypoint,
	outDir,
	platform = "node",
	userBuildConfig,
}: {
	entrypoint: string;
	outDir: string;
	platform?: string;
	userBuildConfig?: ProcessedShovelConfig["build"];
}) {
	const entryPath = resolve(entrypoint);
	const outputDir = resolve(outDir);
	const serverDir = join(outputDir, "server");
	const projectRoot = findProjectRoot(dirname(entryPath));

	logger.debug("Entry:", {entryPath});
	logger.debug("Output:", {outputDir});
	logger.debug("Target platform:", {platform});
	logger.debug("Project root:", {projectRoot});

	// Create platform instance
	const platformInstance = await Platform.createPlatform(platform);
	const platformESBuildConfig = platformInstance.getESBuildConfig();

	// Build using the unified bundler
	const bundler = new ServerBundler({
		entrypoint,
		outDir,
		platform: platformInstance,
		platformESBuildConfig,
		userBuildConfig,
	});

	const {success, outputs} = await bundler.build();
	if (!success) {
		throw new Error("Build failed");
	}

	// Generate package.json for self-contained deployment
	await generatePackageJSON({serverDir, platform, entryPath});

	logger.debug("Built app to", {outputDir});
	logger.debug("Server files", {dir: serverDir});
	logger.debug("Public files", {dir: join(outputDir, "public")});
	// Report the main entry point (supervisor for Node/Bun, worker for Cloudflare)
	logger.info("Build complete: {path}", {
		path: outputs.index || outputs.worker,
	});
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
	options: {platform?: string},
	config: ProcessedShovelConfig,
) {
	// Use same platform resolution as develop command
	const platform = Platform.resolvePlatform({...options, config});

	await buildForProduction({
		entrypoint,
		outDir: "dist",
		platform,
		userBuildConfig: config.build,
	});

	// Workaround for Bun-specific issue: esbuild keeps child processes alive
	// even after build() completes, preventing the Node/Bun process from exiting.
	// This is documented in https://github.com/evanw/esbuild/issues/3558
	// Node.js exits naturally via reference counting, but Bun doesn't.
	process.exit(0);
}
