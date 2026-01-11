/**
 * Unified ESBuild orchestration for Shovel apps.
 *
 * ServerBundler handles all build modes:
 * - One-shot builds for production (build command)
 * - Watch mode for development (develop command)
 * - Build for activation (activate command)
 *
 * Consolidates shared logic: requireShim, JSX config, plugins, defines, externals, validation.
 */

import * as ESBuild from "esbuild";
import {builtinModules, createRequire} from "node:module";
import {resolve, join, dirname, basename} from "path";
import {mkdir} from "fs/promises";
import {watch, type FSWatcher, existsSync} from "fs";
import {getLogger} from "@logtape/logtape";
import type {Platform, PlatformESBuildConfig} from "@b9g/platform";

import {assetsPlugin} from "../plugins/assets.js";
import {importMetaPlugin} from "../plugins/import-meta.js";
import {createConfigPlugin} from "../plugins/config.js";
import {createEntryPlugin} from "../plugins/entry.js";
import {loadJSXConfig, applyJSXOptions} from "./jsx-config.js";
import {findProjectRoot, getNodeModulesPath} from "./project.js";
import {getGitSHA} from "./git-sha.js";
import type {ProcessedBuildConfig, BuildPluginConfig} from "./config.js";

const logger = getLogger(["shovel"]);

/**
 * Node.js ESM require() shim for external CJS dependencies.
 * Node.js ESM doesn't have require defined, but external deps may use it.
 */
const REQUIRE_SHIM = `import{createRequire as __cR}from'module';const require=__cR(import.meta.url);`;

export interface BundlerOptions {
	/** Entry point to build */
	entrypoint: string;
	/** Output directory */
	outDir: string;
	/** Platform instance for getting entry wrappers and config */
	platform: Platform;
	/** Platform-specific esbuild configuration */
	platformESBuildConfig: PlatformESBuildConfig;
	/** User build config from shovel.json */
	userBuildConfig?: ProcessedBuildConfig;
	/** Callback when build completes (watch mode only) */
	onBuild?: (success: boolean, entrypoint: string) => void;
}

export interface BuildResult {
	success: boolean;
	entrypoint: string;
}

/**
 * Unified ESBuild bundler for Shovel apps.
 *
 * Handles production builds, development watch mode, and activation builds.
 */
export class ServerBundler {
	#options: BundlerOptions;
	#ctx?: ESBuild.BuildContext;
	#projectRoot: string;
	#initialBuildComplete: boolean;
	#initialBuildResolve?: (result: BuildResult) => void;
	// Track current entrypoint for potential future use (e.g., status queries)
	#currentEntrypoint: string;
	#configWatchers: FSWatcher[];
	#dirWatchers: Map<string, {watcher: FSWatcher; files: Set<string>}>;
	#userEntryPath: string;

	constructor(options: BundlerOptions) {
		this.#options = options;
		this.#projectRoot = findProjectRoot();
		this.#initialBuildComplete = false;
		this.#currentEntrypoint = "";
		this.#configWatchers = [];
		this.#dirWatchers = new Map();
		this.#userEntryPath = "";
	}

	/**
	 * One-shot build for production deployment.
	 * Creates standalone executables (supervisor + worker with server).
	 * @returns Result with success status and the output entrypoint path
	 */
	async build(): Promise<BuildResult> {
		return this.#buildInternal({production: true});
	}

	/**
	 * One-shot build for activation (running ServiceWorker lifecycle).
	 * Creates worker with message loop (for use with loadServiceWorker/ServiceWorkerPool).
	 * @returns Result with success status and the output entrypoint path
	 */
	async buildForActivation(): Promise<BuildResult> {
		return this.#buildInternal({production: false});
	}

	/**
	 * Internal build implementation.
	 * @param options.production - If true, use production entry points (standalone server).
	 *                             If false, use development entry points (message loop).
	 */
	async #buildInternal(options: {production: boolean}): Promise<BuildResult> {
		const entryPath = resolve(this.#projectRoot, this.#options.entrypoint);
		const outputDir = resolve(this.#projectRoot, this.#options.outDir);
		const serverDir = join(outputDir, "server");

		// Ensure output directory structure exists
		await mkdir(serverDir, {recursive: true});
		await mkdir(join(outputDir, "public"), {recursive: true});

		// Use production entry points for build(), development entry points for activation
		const buildOptions = await this.#createBuildOptions(entryPath, outputDir, {
			watchMode: !options.production, // watchMode=true uses dev entry points
		});

		// Use build() for one-shot builds (not context API which is for watch/incremental)
		const result = await ESBuild.build(buildOptions);

		// Validate the build
		const external = buildOptions.external as string[] | undefined;
		this.#validateBuildResult(result, external ?? ["node:*"]);

		// Extract main entry output path from metafile
		// Production: Node/Bun uses index.js (supervisor), Cloudflare uses worker.js directly
		// Activation/Dev: All platforms use worker.js (message loop entry)
		let outputPath = "";
		if (result.metafile) {
			const outputs = Object.keys(result.metafile.outputs);
			// For production, prefer index.js (supervisor) if it exists, else worker.js
			// For activation/dev, always use worker.js
			const mainOutput = options.production
				? outputs.find((p) => p.endsWith("index.js")) ||
					outputs.find((p) => p.endsWith("worker.js"))
				: outputs.find((p) => p.endsWith("worker.js"));
			if (mainOutput) {
				outputPath = resolve(this.#projectRoot, mainOutput);
			}
		}

		const success = result.errors.length === 0;
		logger.debug("Build complete", {entrypoint: outputPath, success});

		return {success, entrypoint: outputPath};
	}

	/**
	 * Start watching and building for development.
	 * @returns Result with success status and the hashed entrypoint path
	 */
	async watch(): Promise<BuildResult> {
		const entryPath = resolve(this.#projectRoot, this.#options.entrypoint);
		this.#userEntryPath = entryPath; // Store for native file watching
		const outputDir = resolve(this.#projectRoot, this.#options.outDir);

		// Ensure output directory structure exists
		await mkdir(join(outputDir, "server"), {recursive: true});

		// Create a promise that resolves when the initial build completes
		const initialBuildPromise = new Promise<BuildResult>((resolve) => {
			this.#initialBuildResolve = resolve;
		});

		const buildOptions = await this.#createBuildOptions(entryPath, outputDir, {
			watchMode: true,
		});

		// Create esbuild context with watch support
		this.#ctx = await ESBuild.context(buildOptions);

		// Start watching - this does the initial build and watches all dependencies
		logger.debug("Starting esbuild watch mode");
		await this.#ctx.watch();

		// Watch config files (shovel.json, package.json) for changes
		// ESBuild doesn't track these since they're not imported
		this.#watchConfigFiles();

		// Wait for initial build to complete
		return initialBuildPromise;
	}

	/**
	 * Stop watching and dispose of esbuild context
	 */
	async stop(): Promise<void> {
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

	/**
	 * Create ESBuild options for the build.
	 *
	 * Entry points are determined by the platform:
	 * - Cloudflare: { server: "<code>" } - single file with everything inline
	 * - Node/Bun: { index: "<supervisor>", worker: "<runtime + user code>" }
	 *
	 * The config entry is always added for runtime configuration.
	 */
	async #createBuildOptions(
		entryPath: string,
		outputDir: string,
		options: {watchMode?: boolean} = {},
	): Promise<ESBuild.BuildOptions> {
		const {watchMode = false} = options;
		const platformESBuildConfig = this.#options.platformESBuildConfig;
		const platformDefaults = this.#options.platform.getDefaults();
		const userBuildConfig = this.#options.userBuildConfig;

		// Get platform-specific entry points based on mode:
		// - Production: getProductionEntryPoints() returns supervisor + worker with server
		// - Development: getEntryWrapper() returns worker with message loop (no server)
		const platformEntryPoints = watchMode
			? {
					worker: this.#options.platform.getEntryWrapper(entryPath, {
						type: "worker",
					}),
				}
			: this.#options.platform.getProductionEntryPoints(entryPath);

		// Load JSX configuration from tsconfig.json or use @b9g/crank defaults
		const jsxOptions = await loadJSXConfig(this.#projectRoot);

		// Load user plugins if specified
		const userPlugins = userBuildConfig?.plugins?.length
			? await this.#loadUserPlugins(userBuildConfig.plugins)
			: [];

		// Merge externals: platform defaults + user additions
		const platformExternal = platformESBuildConfig.external ?? ["node:*"];
		const userExternal = userBuildConfig?.external ?? [];
		const external = [...platformExternal, ...userExternal];

		// Determine if we need the require shim (Node.js only)
		const isNodePlatform =
			(platformESBuildConfig.platform ?? "node") === "node";
		const requireShim = isNodePlatform ? REQUIRE_SHIM : "";

		// Build config values
		const target = userBuildConfig?.target ?? "es2022";
		const sourcemap = watchMode
			? ("inline" as const)
			: (userBuildConfig?.sourcemap ?? false);
		const minify = watchMode ? false : (userBuildConfig?.minify ?? false);
		const treeShaking = userBuildConfig?.treeShaking ?? true;

		// Build ESBuild entry points from platform entry points
		// Each platform entry becomes shovel:entry:<name>
		const esbuildEntryPoints: Record<string, string> = {
			config: "shovel:config",
		};
		for (const name of Object.keys(platformEntryPoints)) {
			esbuildEntryPoints[name] = `shovel:entry:${name}`;
		}

		// Core plugins
		const plugins: ESBuild.Plugin[] = [
			...userPlugins,
			createConfigPlugin(this.#projectRoot, this.#options.outDir, {
				platformDefaults,
			}),
			createEntryPlugin(this.#projectRoot, platformEntryPoints),
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
		];

		// Add build-notify plugin for watch mode
		if (watchMode) {
			plugins.push(this.#createBuildNotifyPlugin(external, outputDir));
		}

		const buildOptions: ESBuild.BuildOptions = {
			entryPoints: esbuildEntryPoints,
			bundle: true,
			format: "esm",
			target,
			platform: platformESBuildConfig.platform ?? "node",
			outdir: `${outputDir}/server`,
			entryNames: "[name]",
			metafile: true,
			absWorkingDir: this.#projectRoot,
			conditions: platformESBuildConfig.conditions ?? ["import", "module"],
			nodePaths: [getNodeModulesPath()],
			plugins,
			define: {
				...(platformESBuildConfig.define ?? {}),
				...(userBuildConfig?.define ?? {}),
				__SHOVEL_OUTDIR__: JSON.stringify(outputDir),
				__SHOVEL_GIT__: JSON.stringify(getGitSHA(this.#projectRoot)),
			},
			alias: userBuildConfig?.alias,
			external,
			sourcemap,
			minify,
			treeShaking,
			...(requireShim && {banner: {js: requireShim}}),
		};

		// Apply JSX configuration
		applyJSXOptions(buildOptions, jsxOptions);

		return buildOptions;
	}

	/**
	 * Load user ESBuild plugins from build config.
	 */
	async #loadUserPlugins(
		plugins: BuildPluginConfig[],
	): Promise<ESBuild.Plugin[]> {
		const loadedPlugins: ESBuild.Plugin[] = [];

		for (const pluginConfig of plugins) {
			const {
				module: modulePath,
				export: exportName = "default",
				...options
			} = pluginConfig;

			try {
				const projectRequire = createRequire(
					join(this.#projectRoot, "package.json"),
				);
				const resolvedPath = modulePath.startsWith(".")
					? resolve(this.#projectRoot, modulePath)
					: projectRequire.resolve(modulePath);

				// eslint-disable-next-line no-restricted-syntax
				const mod = await import(resolvedPath);
				const pluginFactory =
					exportName === "default" ? mod.default : mod[exportName];

				if (typeof pluginFactory !== "function") {
					throw new Error(
						`Plugin export "${exportName}" from "${modulePath}" is not a function`,
					);
				}

				const hasOptions = Object.keys(options).length > 0;
				const plugin = hasOptions ? pluginFactory(options) : pluginFactory();

				loadedPlugins.push(plugin);
				logger.debug("Loaded ESBuild plugin", {
					module: modulePath,
					export: exportName,
				});
			} catch (error) {
				throw new Error(
					`Failed to load ESBuild plugin "${modulePath}": ${error instanceof Error ? error.message : error}`,
				);
			}
		}

		return loadedPlugins;
	}

	/**
	 * Create the build-notify plugin for watch mode.
	 * Handles build completion callbacks and native file watcher updates.
	 */
	#createBuildNotifyPlugin(
		external: string[],
		_outputDir: string,
	): ESBuild.Plugin {
		return {
			name: "build-notify",
			setup: (build) => {
				build.onStart(() => {
					logger.info("Building...");
				});
				build.onEnd(async (result) => {
					let success = result.errors.length === 0;

					// Check for non-bundleable dynamic imports
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

					// Extract main entry output path from metafile
					// Watch mode always uses worker.js (message loop entry for dev)
					let outputPath = "";
					if (result.metafile) {
						const outputs = Object.keys(result.metafile.outputs);
						const mainOutput = outputs.find((p) => p.endsWith("worker.js"));
						if (mainOutput) {
							outputPath = resolve(this.#projectRoot, mainOutput);
						}
					}

					if (success) {
						logger.debug("Build complete", {entrypoint: outputPath});
					} else {
						logger.error("Build errors: {errors}", {errors: result.errors});
					}

					this.#currentEntrypoint = outputPath;

					// Update native file watchers based on metafile inputs
					if (result.metafile) {
						this.#updateSourceWatchers(result.metafile);
					}

					// Handle initial build
					if (!this.#initialBuildComplete) {
						this.#initialBuildComplete = true;
						// Yield to the event loop to ensure inotify watches are registered
						await new Promise((resolve) => setTimeout(resolve, 0));
						this.#initialBuildResolve?.({success, entrypoint: outputPath});
					} else {
						// Subsequent rebuilds triggered by watch
						await this.#options.onBuild?.(success, outputPath);
					}
				});
			},
		};
	}

	/**
	 * Validate build result for dynamic imports and unexpected externals.
	 */
	#validateBuildResult(
		result: ESBuild.BuildResult,
		allowedExternals: string[],
	) {
		// Check for non-bundleable dynamic imports
		const dynamicImportWarnings = (result.warnings || []).filter(
			(w) =>
				(w.text.includes("cannot be bundled") ||
					w.text.includes("import() call") ||
					w.text.includes("dynamic import")) &&
				!w.text.includes("./server.js"),
		);

		if (dynamicImportWarnings.length > 0) {
			const locations = dynamicImportWarnings
				.map((w) => {
					const loc = w.location;
					const file = loc?.file || "unknown";
					const line = loc?.line || "?";
					return `  ${file}:${line} - ${w.text}`;
				})
				.join("\n");

			throw new Error(
				`Build failed: Non-analyzable dynamic imports found:\n${locations}\n\n` +
					`Dynamic imports must use literal strings, not variables.`,
			);
		}

		// Check for unexpected externals
		if (result.metafile) {
			const allowedSet = new Set(allowedExternals);
			// Extract wildcard prefixes (e.g., "node:*" -> "node:", "bun:*" -> "bun:")
			const wildcardPrefixes = allowedExternals
				.filter((e) => e.endsWith(":*"))
				.map((e) => e.slice(0, -1)); // "node:*" -> "node:"
			const unexpectedExternals: string[] = [];

			for (const path of Object.keys(result.metafile.inputs)) {
				if (!path.startsWith("<external>:")) continue;
				const moduleName = path.slice("<external>:".length);
				const isAllowed =
					allowedSet.has(moduleName) ||
					wildcardPrefixes.some((prefix) => moduleName.startsWith(prefix)) ||
					builtinModules.includes(moduleName);
				if (!isAllowed && !unexpectedExternals.includes(moduleName)) {
					unexpectedExternals.push(moduleName);
				}
			}

			if (unexpectedExternals.length > 0) {
				const externals = unexpectedExternals.map((e) => `  - ${e}`).join("\n");
				throw new Error(
					`Build failed: Unexpected external imports found:\n${externals}\n\n` +
						`These modules are not bundled and won't be available at runtime.`,
				);
			}
		}
	}

	/**
	 * Watch shovel.json and package.json for changes.
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
	 */
	#updateSourceWatchers(metafile: ESBuild.Metafile) {
		const newDirFiles = new Map<string, Set<string>>();

		// Always include the user entry file directory explicitly
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
				existing.files = files;
			} else {
				if (!existsSync(dir)) continue;

				try {
					const watcher = watch(
						dir,
						{persistent: false},
						(_event, filename) => {
							const entry = this.#dirWatchers.get(dir);
							if (!entry) return;

							const isTrackedFile = filename ? entry.files.has(filename) : true;

							if (isTrackedFile) {
								logger.debug("Native watcher detected change: {file}", {
									file: filename ? join(dir, filename) : dir,
								});
								this.#ctx?.rebuild().catch((err) => {
									logger.error("Rebuild failed: {error}", {error: err});
								});
							}
						},
					);

					this.#dirWatchers.set(dir, {watcher, files});
				} catch (err) {
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
}
