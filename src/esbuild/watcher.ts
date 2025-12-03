/**
 * File watcher that uses ESBuild's native watch mode for accurate dependency tracking.
 * Watches all imported files including node_modules and linked packages.
 */

import * as ESBuild from "esbuild";
import {resolve, join} from "path";
import {mkdir} from "fs/promises";
import {assetsPlugin} from "@b9g/assets/plugin";
import {importMetaPlugin} from "./import-meta-plugin.js";
import {loadJSXConfig, applyJSXOptions} from "./jsx-config.js";
import {findProjectRoot} from "../utils/project.js";
import {getLogger} from "@logtape/logtape";

const logger = getLogger(["watcher"]);

export interface WatcherOptions {
	/** Entry point to build */
	entrypoint: string;
	/** Output directory */
	outDir: string;
	/** Callback when build completes - entrypoint is the hashed output path */
	onBuild?: (success: boolean, entrypoint: string) => void;
}

export class Watcher {
	#options: WatcherOptions;
	#ctx?: ESBuild.BuildContext;
	#projectRoot: string;
	#initialBuildComplete: boolean;
	#initialBuildResolve?: (result: {
		success: boolean;
		entrypoint: string;
	}) => void;
	#currentEntrypoint: string;

	constructor(options: WatcherOptions) {
		this.#options = options;
		this.#projectRoot = findProjectRoot();
		this.#initialBuildComplete = false;
		this.#currentEntrypoint = "";
	}

	/**
	 * Start watching and building
	 * @returns Result with success status and the hashed entrypoint path
	 */
	async start(): Promise<{success: boolean; entrypoint: string}> {
		const entryPath = resolve(this.#projectRoot, this.#options.entrypoint);
		const outputDir = resolve(this.#projectRoot, this.#options.outDir);

		// Ensure output directory structure exists
		await mkdir(join(outputDir, "server"), {recursive: true});
		await mkdir(join(outputDir, "static"), {recursive: true});

		// Load JSX configuration from tsconfig.json or use @b9g/crank defaults
		const jsxOptions = await loadJSXConfig(this.#projectRoot);

		// Create a promise that resolves when the initial build completes
		const initialBuildPromise = new Promise<{
			success: boolean;
			entrypoint: string;
		}>((resolve) => {
			this.#initialBuildResolve = resolve;
		});

		// Build options for esbuild context
		const buildOptions: ESBuild.BuildOptions = {
			entryPoints: [entryPath],
			bundle: true,
			format: "esm",
			target: "es2022",
			platform: "node",
			outdir: `${outputDir}/server`,
			entryNames: "[name]-[hash]",
			metafile: true,
			absWorkingDir: this.#projectRoot,
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
				// Plugin to detect build completion (works with watch mode)
				{
					name: "build-notify",
					setup: (build) => {
						build.onStart(() => {
							logger.info("Building", {
								entrypoint: this.#options.entrypoint,
							});
						});
						build.onEnd(async (result) => {
							let success = result.errors.length === 0;

							// Check for non-bundleable dynamic imports (would fail at runtime)
							const dynamicImportWarnings = (result.warnings || []).filter(
								(w) =>
									w.text.includes("cannot be bundled") ||
									w.text.includes("import() call") ||
									w.text.includes("dynamic import"),
							);

							if (dynamicImportWarnings.length > 0) {
								success = false;
								for (const warning of dynamicImportWarnings) {
									const loc = warning.location;
									const file = loc?.file || "unknown";
									const line = loc?.line || "?";
									logger.error(
										"Non-analyzable dynamic import at {file}:{line}: {text}",
										{file, line, text: warning.text},
									);
								}
								logger.error(
									"Dynamic imports must use literal strings, not variables. " +
										"For config-driven providers, ensure they are registered in shovel.json.",
								);
							}

							// Extract output path from metafile
							let outputPath = "";
							if (result.metafile) {
								const outputs = Object.keys(result.metafile.outputs);
								const jsOutput = outputs.find((p) => p.endsWith(".js"));
								if (jsOutput) {
									// Convert relative path to absolute (relative to project root)
									outputPath = resolve(this.#projectRoot, jsOutput);
								}
							}

							if (success) {
								logger.info("Build complete", {entrypoint: outputPath});
							} else {
								logger.error("Build errors: {errors}", {errors: result.errors});
							}

							this.#currentEntrypoint = outputPath;

							// Handle initial build
							if (!this.#initialBuildComplete) {
								this.#initialBuildComplete = true;
								this.#initialBuildResolve?.({success, entrypoint: outputPath});
							} else {
								// Subsequent rebuilds triggered by watch
								// Note: esbuild automatically cleans up old hashed files during rebuild
								await this.#options.onBuild?.(success, outputPath);
							}
						});
					},
				},
			],
			sourcemap: "inline",
			minify: false,
			treeShaking: true,
		};

		// Apply JSX configuration (from tsconfig.json or @b9g/crank defaults)
		applyJSXOptions(buildOptions, jsxOptions);

		// Create esbuild context with onEnd plugin to detect builds
		this.#ctx = await ESBuild.context(buildOptions);

		// Start watching - this does the initial build and watches all dependencies
		logger.info("Starting esbuild watch mode");
		await this.#ctx.watch();

		// Wait for initial build to complete
		return initialBuildPromise;
	}

	/**
	 * Stop watching and dispose of esbuild context
	 */
	async stop() {
		if (this.#ctx) {
			await this.#ctx.dispose();
			this.#ctx = undefined;
		}
	}
}
