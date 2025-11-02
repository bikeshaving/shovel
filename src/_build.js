/**
 * Production build system for Shovel apps
 * Pre-compiles ServiceWorker code for Worker execution at runtime
 */

import * as esbuild from "esbuild";
import {resolve, join, dirname} from "path";
import {mkdir, readFile} from "fs/promises";
import {assetsPlugin} from "./assets.ts";

/**
 * Build ServiceWorker app for production deployment
 * Currently focused on Bun platform
 */
export async function buildForProduction({entrypoint, outDir, verbose}) {
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
			// Ignore errors when reading package.json
		}
		workspaceRoot = dirname(workspaceRoot);
	}

	// Build ServiceWorker code (keep as ServiceWorker, just bundle dependencies)
	const result = await esbuild.build({
		entryPoints: [entryPath],
		bundle: true,
		format: "esm",
		target: "es2022",
		platform: "node",
		outfile: join(outputDir, "app.js"),
		packages: "external",
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
	});

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
