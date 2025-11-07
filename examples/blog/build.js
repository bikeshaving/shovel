#!/usr/bin/env bun
import {build} from "esbuild";
import {assetsPlugin} from "@b9g/assets/plugin";

await build({
	entryPoints: ["src/app.js"],
	bundle: true,
	outdir: "dist",
	format: "esm",
	target: "es2022",
	plugins: [
		assetsPlugin({
			publicPath: "/",
			outputDir: "dist/assets",
			manifest: "dist/server/asset-manifest.json",
		}),
	],
	external: ["@b9g/*"], // Keep Shovel packages external for SSG
});

console.info("✅ Built app with assets in dist/assets/");
