/**
 * Production build system for Shovel apps
 * Pre-compiles ServiceWorker code for Worker execution at runtime
 */

import * as esbuild from "esbuild";
import {resolve, join, dirname} from "path";
import {mkdir, readFile} from "fs/promises";
import {assetsPlugin} from "./assets.ts";
// Platform-specific imports are handled dynamically

// Workspace packages should resolve automatically via Node.js module resolution

/**
 * Build ServiceWorker app for production deployment
 * Supports multiple target platforms
 */
export async function buildForProduction({entrypoint, outDir, verbose, platform = "node"}) {
	const entryPath = resolve(entrypoint);
	const outputDir = resolve(outDir);

	if (verbose) {
		console.info(`📂 Entry: ${entryPath}`);
		console.info(`📂 Output: ${outputDir}`);
	}

	// Ensure output directory exists
	await mkdir(outputDir, {recursive: true});

	// Find workspace root by looking for package.json with workspaces
	let workspaceRoot = process.cwd();
	while (workspaceRoot !== dirname(workspaceRoot)) {
		try {
			const packageJson = JSON.parse(
				await readFile(resolve(workspaceRoot, "package.json"), "utf8"),
			);
			if (packageJson.workspaces) {
				break;
			}
		} catch {
			// No package.json found, continue up the tree
		}
		workspaceRoot = dirname(workspaceRoot);
	}

	// Platform-specific build configuration
	const isCloudflare = platform === "cloudflare" || platform === "cloudflare-workers";
	
	// Build ServiceWorker code (keep as ServiceWorker, just bundle dependencies)
	const buildConfig = {
		entryPoints: [entryPath],
		bundle: true,
		format: "esm",
		target: "es2022",
		platform: isCloudflare ? "browser" : "node",
		outfile: join(outputDir, "app.js"),
		absWorkingDir: workspaceRoot,
		plugins: [
			assetsPlugin({
				outputDir: join(outputDir, "assets"),
				manifest: join(outputDir, "assets/manifest.json"),
				dev: false,
			}),
		],
		metafile: true,
		sourcemap: false,
		minify: false,
		treeShaking: true,
		define: {
			"process.env.NODE_ENV": '"production"',
		},
	};
	
	// Platform-specific bundling strategy
	if (!isCloudflare) {
		// For Node.js/Bun, keep packages external (use npm/workspace resolution)
		buildConfig.packages = "external";
	} else {
		// For Cloudflare, bundle everything and wrap ServiceWorker as ES Module
		buildConfig.platform = "browser";
		buildConfig.conditions = ["worker", "browser"];
		
		// Dynamically import Cloudflare platform utilities
		try {
			const {cloudflareWorkerBanner, cloudflareWorkerFooter} = await import("@b9g/platform-cloudflare");
			buildConfig.banner = {
				js: cloudflareWorkerBanner,
			};
			buildConfig.footer = {
				js: cloudflareWorkerFooter,
			};
		} catch (error) {
			throw new Error("@b9g/platform-cloudflare is required for Cloudflare builds. Install it with: bun add @b9g/platform-cloudflare");
		}
	}
	
	const result = await esbuild.build(buildConfig);

	if (verbose && result.metafile) {
		console.info("📊 Bundle analysis:");
		const analysis = await esbuild.analyzeMetafile(result.metafile);
		console.info(analysis);
	}

	// Build complete - server templates stay in shovel-compiler package

	if (verbose) {
		console.info(`📦 Built app to ${outputDir}`);
	}
}
