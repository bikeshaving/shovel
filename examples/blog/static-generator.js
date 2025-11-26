#!/usr/bin/env node

/**
 * Example static site generator using ServiceWorker-style Shovel app
 *
 * This shows how the CLI would work:
 * 1. Load ServiceWorker entrypoint
 * 2. Collect static routes via 'static' event
 * 3. Pre-render each route by calling fetch handler
 * 4. Write static files to disk
 */

import {createNodePlatform} from "@b9g/platform-node";
import {staticFilesPlugin} from "@b9g/staticfiles";
import * as FS from "fs/promises";
import * as Path from "path";
import * as ESBuild from "esbuild";

async function generateStaticSite() {
	console.info("[Static] Generating static site from ServiceWorker app...");

	const outDir = "dist";
	const baseURL = "https://example.com";

	// Create platform
	const platform = createNodePlatform({
		hotReload: false, // No hot reloading for static builds
	});

	try {
		// Load ServiceWorker app
		console.info("[Static] Loading ServiceWorker entrypoint...");
		const serviceWorker = await platform.loadServiceWorker(
			"./src/service-worker-app.js",
			{
				hotReload: false,
				caches: {
					pages: {type: "memory"},
					api: {type: "memory"},
					static: {type: "filesystem"},
				},
			},
		);

		// Build static assets first
		console.info("[Static] Building static assets...");
		await ESBuild.build({
			entryPoints: ["./src/service-worker-app.js"],
			plugins: [
				staticFilesPlugin({
					outputDir: Path.join(outDir, "static"),
					publicPath: "/static/",
					manifest: Path.join(outDir, "static-manifest.json"),
				}),
			],
			bundle: true,
			write: false, // We just want the plugin to run
			outdir: "temp",
		});

		// Collect routes for static generation
		console.info("[Static] Collecting routes...");
		const routes = await serviceWorker.collectStaticRoutes(outDir, baseURL);
		console.info(`[Static] Found ${routes.length} routes:`, routes);

		// Ensure output directory exists
		await FS.mkdir(outDir, {recursive: true});

		// Pre-render each route
		console.info("[Static] Pre-rendering routes...");
		for (const route of routes) {
			try {
				const url = new URL(route, baseURL);
				const request = new Request(url.href);

				console.info(`[Static] Rendering ${route}...`);
				const response = await serviceWorker.handleRequest(request);

				if (response.ok) {
					const content = await response.text();
					const filePath =
						route === "/" ? "index.html" : `${route.slice(1)}.html`;
					const fullPath = Path.join(outDir, filePath);

					// Ensure directory exists
					await FS.mkdir(Path.dirname(fullPath), {recursive: true});
					await FS.writeFile(fullPath, content, "utf8");

					console.info(`[Static] ✓ ${route} → ${filePath}`);
				} else {
					console.warn(
						`[Static] ✗ ${route} failed with status ${response.status}`,
					);
				}
			} catch (error) {
				console.error(`[Static] ✗ ${route} failed:`, error.message);
			}
		}

		console.info(`[Static] ✅ Static site generated in ${outDir}/`);

		// List generated files
		const files = await FS.readdir(outDir, {recursive: true});
		console.info("[Static] Generated files:");
		files.forEach((file) => console.info(`  ${file}`));
	} finally {
		await serviceWorker?.dispose();
		await platform.dispose();
	}
}

// Run the generator
generateStaticSite().catch(console.error);
