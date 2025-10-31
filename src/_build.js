/**
 * Production build system for Shovel apps
 * Pre-compiles ServiceWorker code for Worker execution at runtime
 */

import * as esbuild from "esbuild";
import {staticFilesPlugin} from "./static-files.ts";

/**
 * Build ServiceWorker app for production deployment
 * Currently focused on Bun platform
 */
export async function buildForProduction({entrypoint, outDir, verbose}) {
	const entryPath = resolve(entrypoint);
	const outputDir = resolve(outDir);

	if (verbose) {
		console.log(`📂 Entry: ${entryPath}`);
		console.log(`📂 Output: ${outputDir}`);
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
		console.log("📊 Bundle analysis:");
		const analysis = await esbuild.analyzeMetafile(result.metafile);
		console.log(analysis);
	}

	// Build complete - server templates stay in shovel-compiler package

	if (verbose) {
		console.log(`📦 Built app to ${outputDir}`);
	}
}
