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
import {resolve, join, dirname, basename} from "path";
import {mkdir} from "fs/promises";
import {watch, type FSWatcher, existsSync} from "fs";
import {getLogger} from "@logtape/logtape";
import type {Platform, PlatformESBuildConfig} from "@b9g/platform";

import {assetsPlugin} from "../plugins/assets.js";
import {importMetaPlugin} from "../plugins/import-meta.js";
import {createConfigPlugin, createEntryPlugin} from "../plugins/shovel.js";
import {loadJSXConfig, applyJSXOptions} from "./jsx-config.js";
import {findProjectRoot} from "./project.js";
import {getGitSHA} from "./git-sha.js";

const logger = getLogger(["shovel", "build"]);

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
	#configWatchers: FSWatcher[];
	#dirWatchers: Map<string, {watcher: FSWatcher; files: Set<string>}>;
	#userEntryPath: string;

	constructor(options: WatcherOptions) {
		this.#options = options;
		this.#projectRoot = findProjectRoot();
		this.#initialBuildComplete = false;
		this.#currentEntrypoint = "";
		this.#configWatchers = [];
		this.#dirWatchers = new Map();
		this.#userEntryPath = "";
	}

	/**
	 * Start watching and building
	 * @returns Result with success status and the hashed entrypoint path
	 */
	async start(): Promise<{success: boolean; entrypoint: string}> {
		const entryPath = resolve(this.#projectRoot, this.#options.entrypoint);
		this.#userEntryPath = entryPath; // Store for native file watching
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
		// Two entry points:
		// - server: unified bundle with worker runtime + user code
		// - config: standalone config module for main thread to import
		const buildOptions: ESBuild.BuildOptions = {
			entryPoints: {
				server: "shovel:entry",
				config: "shovel:config",
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
				createConfigPlugin(this.#projectRoot, this.#options.outDir, {
					platformDefaults: this.#options.platform.getDefaults(),
				}),
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

							// Update native file watchers based on metafile inputs
							// This provides instant file change detection via inotify/fsevents
							// as a complement to esbuild's polling-based watch mode
							// IMPORTANT: Must complete before resolving initial build promise
							// so that file watchers are ready when start() returns
							if (result.metafile) {
								this.#updateSourceWatchers(result.metafile);
							}

							// Handle initial build
							if (!this.#initialBuildComplete) {
								this.#initialBuildComplete = true;
								// Yield to the event loop to ensure inotify watches are
								// fully registered before signaling readiness. Without this,
								// file modifications immediately after start() may be missed.
								await new Promise((resolve) => setTimeout(resolve, 0));
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
			define: {
				...(platformESBuildConfig.define ?? {}),
				// Inject output directory for [outdir] placeholder resolution
				__SHOVEL_OUTDIR__: JSON.stringify(outputDir),
				// Inject git commit SHA for [git] placeholder
				__SHOVEL_GIT__: JSON.stringify(getGitSHA(this.#projectRoot)),
			},
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
	 * Update native directory watchers for source files from metafile.
	 * Uses fs.watch on directories for instant inotify/fsevents detection
	 * as a complement to esbuild's polling-based watch mode.
	 *
	 * Watching directories instead of files handles:
	 * - File deletion and recreation (directory watcher survives)
	 * - Concurrent modifications (one watcher per directory)
	 * - Fewer file descriptors (one per directory vs one per file)
	 */
	#updateSourceWatchers(metafile: ESBuild.Metafile) {
		// Build map of directory -> set of filenames from metafile inputs
		// Skip virtual files (<stdin>, <external>:, shovel:, etc.)
		const newDirFiles = new Map<string, Set<string>>();

		// Always include the user entry file directory explicitly
		// This handles cases where the entry file is outside the project root
		// (e.g., in /tmp for tests) and metafile paths don't resolve correctly
		if (this.#userEntryPath) {
			const entryDir = dirname(this.#userEntryPath);
			const entryFile = basename(this.#userEntryPath);
			if (!newDirFiles.has(entryDir)) {
				newDirFiles.set(entryDir, new Set());
			}
			newDirFiles.get(entryDir)!.add(entryFile);
			logger.debug("Explicitly watching user entry file: {path}", {
				path: this.#userEntryPath,
			});
		}

		for (const inputPath of Object.keys(metafile.inputs)) {
			if (inputPath.startsWith("<") || inputPath.startsWith("shovel")) {
				continue;
			}

			// inputPath is relative to absWorkingDir (project root)
			// For paths like "../../../tmp/foo.ts", resolve() handles them correctly
			const fullPath = resolve(this.#projectRoot, inputPath);
			const dir = dirname(fullPath);
			const file = basename(fullPath);

			if (!newDirFiles.has(dir)) {
				newDirFiles.set(dir, new Set());
			}
			newDirFiles.get(dir)!.add(file);
		}

		// Remove watchers for directories no longer needed
		for (const [dir, entry] of this.#dirWatchers) {
			if (!newDirFiles.has(dir)) {
				entry.watcher.close();
				this.#dirWatchers.delete(dir);
			}
		}

		// Update or add watchers for each directory
		for (const [dir, files] of newDirFiles) {
			const existing = this.#dirWatchers.get(dir);

			if (existing) {
				// Update the file set for existing watcher
				existing.files = files;
			} else {
				// Create new directory watcher
				if (!existsSync(dir)) continue;

				try {
					const watcher = watch(dir, {persistent: false}, (event, filename) => {
						const entry = this.#dirWatchers.get(dir);
						if (!entry) return;

						// On Linux, filename can sometimes be null even for real changes.
						// If we have a filename, check if it's one of our tracked files.
						// If filename is null, trigger rebuild anyway (esbuild will dedupe).
						const isTrackedFile = filename ? entry.files.has(filename) : true;

						if (isTrackedFile) {
							logger.debug("Native watcher detected change: {file}", {
								file: filename ? join(dir, filename) : dir,
							});
							// Trigger rebuild - esbuild dedupes concurrent rebuilds
							this.#ctx?.rebuild().catch((err) => {
								logger.error("Rebuild failed: {error}", {error: err});
							});
						}
					});

					this.#dirWatchers.set(dir, {watcher, files});
				} catch (err) {
					// Non-fatal: esbuild's polling will catch it
					logger.debug("Failed to watch directory {dir}: {error}", {
						dir,
						error: err,
					});
				}
			}
		}

		const totalFiles = Array.from(this.#dirWatchers.values()).reduce(
			(sum, entry) => sum + entry.files.size,
			0,
		);

		// Log which directories we're watching (useful for debugging)
		const watchedDirs = Array.from(this.#dirWatchers.keys());
		logger.debug(
			"Watching {fileCount} source files in {dirCount} directories with native fs.watch",
			{fileCount: totalFiles, dirCount: this.#dirWatchers.size},
		);
		logger.debug("Watched directories: {dirs}", {
			dirs:
				watchedDirs.slice(0, 5).join(", ") +
				(watchedDirs.length > 5 ? "..." : ""),
		});
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

		// Close directory watchers
		for (const entry of this.#dirWatchers.values()) {
			entry.watcher.close();
		}
		this.#dirWatchers.clear();

		if (this.#ctx) {
			await this.#ctx.dispose();
			this.#ctx = undefined;
		}
	}
}
