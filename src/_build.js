/**
 * Production build system for Shovel apps
 * Pre-compiles ServiceWorker code for Worker execution at runtime
 */

import * as esbuild from "esbuild";
import {resolve, join} from "path";
import {mkdir} from "fs/promises";
import {staticFilesPlugin} from "./static-files.ts";

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

	// Build ServiceWorker code (keep as ServiceWorker, just bundle dependencies)
	const result = await esbuild.build({
		entryPoints: [entryPath],
		bundle: true,
		format: "esm",
		target: "es2022",
		platform: "node",
		outfile: join(outputDir, "app.js"),
		packages: "external",
		plugins: [
			staticFilesPlugin({
				outputDir: join(outputDir, "static"),
				manifest: join(outputDir, "static-manifest.json"),
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
