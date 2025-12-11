/**
 * File watcher that uses ESBuild's native watch mode for accurate dependency tracking.
 * Watches all imported files including node_modules and linked packages.
 *
 * Outputs a single unified bundle:
 * - server-[hash].js: Worker runtime + user's ServiceWorker code bundled together
 *
 * Hot reload works by terminating workers and recreating them with the new bundle.
 */

import * as ESBuild from "esbuild";
import {builtinModules} from "node:module";
import {resolve, join} from "path";
import {mkdir} from "fs/promises";
import {watch, type FSWatcher, existsSync} from "fs";
import {getLogger} from "@logtape/logtape";
import type {Platform, PlatformESBuildConfig} from "@b9g/platform";

import {assetsPlugin} from "../plugins/assets.js";
import {importMetaPlugin} from "../plugins/import-meta.js";
import {createConfigPlugin} from "../plugins/shovel-config.js";
import {loadJSXConfig, applyJSXOptions} from "./jsx-config.js";
import {findProjectRoot} from "./project.js";

const logger = getLogger(["shovel", "build"]);

/**
 * Create the shovel:entry virtual module plugin.
 * This provides a virtual entry point that wraps the user's ServiceWorker code
 * with runtime initialization (initWorkerRuntime + startWorkerMessageLoop).
 */
function createEntryPlugin(
	projectRoot: string,
	workerEntryCode: string,
): ESBuild.Plugin {
	return {
		name: "shovel-entry",
		setup(build) {
			build.onResolve({filter: /^shovel:entry$/}, (args) => ({
				path: args.path,
				namespace: "shovel-entry",
			}));

			build.onLoad({filter: /.*/, namespace: "shovel-entry"}, () => ({
				contents: workerEntryCode,
				loader: "js",
				resolveDir: projectRoot,
			}));
		},
	};
}

export interface WatcherOptions {
	/** Entry point to build */
	entrypoint: string;
	/** Output directory */
	outDir: string;
	/** Platform instance for getting entry wrappers and config */
	platform: Platform;
	/** Platform-specific esbuild configuration */
	platformESBuildConfig: PlatformESBuildConfig;
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
	#configWatchers: FSWatcher[] = [];

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

		// Get worker entry wrapper - imports user code directly for unified bundle
		const workerEntryWrapper = this.#options.platform.getEntryWrapper(
			entryPath,
			{type: "worker", outDir: outputDir},
		);

		// Load JSX configuration from tsconfig.json or use @b9g/crank defaults
		const jsxOptions = await loadJSXConfig(this.#projectRoot);

		// Create a promise that resolves when the initial build completes
		const initialBuildPromise = new Promise<{
			success: boolean;
			entrypoint: string;
		}>((resolve) => {
			this.#initialBuildResolve = resolve;
		});

		// Use platform-specific esbuild configuration
		const platformESBuildConfig = this.#options.platformESBuildConfig;
		const external = platformESBuildConfig.external ?? ["node:*"];

		// Build options for esbuild context
		// Single entry point: unified bundle with worker runtime + user code
		const buildOptions: ESBuild.BuildOptions = {
			entryPoints: {
				server: "shovel:entry",
			},
			bundle: true,
			format: "esm",
			target: "es2022",
			platform: platformESBuildConfig.platform ?? "node",
			outdir: `${outputDir}/server`,
			// Worker gets stable name, server gets hash for cache busting
			entryNames: "[name]",
			metafile: true,
			absWorkingDir: this.#projectRoot,
			conditions: platformESBuildConfig.conditions ?? ["import", "module"],
			plugins: [
				createConfigPlugin(this.#projectRoot, this.#options.outDir),
				createEntryPlugin(this.#projectRoot, workerEntryWrapper),
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
							// Exclude our intentional ./server.js import from worker -> server
							const dynamicImportWarnings = (result.warnings || []).filter(
								(w) =>
									(w.text.includes("cannot be bundled") ||
										w.text.includes("import() call") ||
										w.text.includes("dynamic import")) &&
									!w.text.includes("./server.js"),
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

							// Check for unexpected externals
							if (result.metafile) {
								const hasNodeWildcard = external.includes("node:*");
								const allowedSet = new Set(external);
								const unexpectedExternals: string[] = [];

								for (const path of Object.keys(result.metafile.inputs)) {
									if (!path.startsWith("<external>:")) continue;
									const moduleName = path.slice("<external>:".length);
									const isAllowed =
										allowedSet.has(moduleName) ||
										(hasNodeWildcard && moduleName.startsWith("node:")) ||
										builtinModules.includes(moduleName);
									if (!isAllowed && !unexpectedExternals.includes(moduleName)) {
										unexpectedExternals.push(moduleName);
									}
								}

								if (unexpectedExternals.length > 0) {
									success = false;
									for (const ext of unexpectedExternals) {
										logger.error("Unexpected external import: {module}", {
											module: ext,
										});
									}
									logger.error(
										"These modules are not bundled and won't be available at runtime.",
									);
								}
							}

							// Extract server.js output path from metafile
							// This is the unified bundle loaded by ServiceWorkerPool
							let outputPath = "";
							if (result.metafile) {
								const outputs = Object.keys(result.metafile.outputs);
								const serverOutput = outputs.find((p) =>
									p.endsWith("server.js"),
								);
								if (serverOutput) {
									outputPath = resolve(this.#projectRoot, serverOutput);
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
			define: platformESBuildConfig.define ?? {},
			// Mark ./server.js as external so it's imported at runtime (sibling output file)
			external: [...external, "./server.js"],
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

		// Watch config files (shovel.json, package.json) for changes
		// ESBuild doesn't track these since they're not imported
		this.#watchConfigFiles();

		// Wait for initial build to complete
		return initialBuildPromise;
	}

	/**
	 * Watch shovel.json and package.json for changes
	 * Triggers rebuild when config changes
	 */
	#watchConfigFiles() {
		const configFiles = ["shovel.json", "package.json"];

		for (const filename of configFiles) {
			const filepath = join(this.#projectRoot, filename);
			if (!existsSync(filepath)) continue;

			try {
				const watcher = watch(filepath, {persistent: false}, (event) => {
					if (event === "change") {
						logger.info(`Config changed: ${filename}, rebuilding...`);
						this.#ctx?.rebuild().catch((err) => {
							logger.error("Rebuild failed: {error}", {error: err});
						});
					}
				});

				this.#configWatchers.push(watcher);
			} catch (err) {
				logger.warn("Failed to watch {file}: {error}", {
					file: filename,
					error: err,
				});
			}
		}
	}

	/**
	 * Stop watching and dispose of esbuild context
	 */
	async stop() {
		// Close config file watchers
		for (const watcher of this.#configWatchers) {
			watcher.close();
		}
		this.#configWatchers = [];

		if (this.#ctx) {
			await this.#ctx.dispose();
			this.#ctx = undefined;
		}
	}
}
