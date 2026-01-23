/**
 * ESBuild bundler for Shovel apps.
 *
 * Provides a consistent API for building ServiceWorker apps:
 * - build() produces all entry points (supervisor + worker for Node/Bun, worker for Cloudflare)
 * - Callers decide which output file to use based on their needs
 * - MODE (minify, sourcemaps) comes from config, not hardcoded per use case
 */

import * as ESBuild from "esbuild";
import {builtinModules, createRequire} from "node:module";
import {resolve, join, dirname, basename, relative} from "path";
import {mkdir} from "fs/promises";
import {watch, type FSWatcher, existsSync} from "fs";
import {getLogger} from "@logtape/logtape";
import type {Platform, PlatformESBuildConfig} from "@b9g/platform";

import {assetsPlugin} from "../plugins/assets.js";
import {importMetaPlugin} from "../plugins/import-meta.js";
import {createConfigPlugin} from "../plugins/config.js";
import {createEntryPlugin} from "../plugins/entry.js";
import {createAssetsManifestPlugin} from "../plugins/assets-manifest.js";
import {loadJSXConfig, applyJSXOptions} from "./jsx-config.js";
import {findProjectRoot, getNodeModulesPath} from "./project.js";
import {getGitSHA} from "./git-sha.js";
import type {ProcessedBuildConfig, BuildPluginConfig} from "./config.js";

const logger = getLogger(["shovel", "build"]);

/**
 * Node.js ESM require() shim for external CJS dependencies.
 */
const REQUIRE_SHIM = `import{createRequire as __cR}from'module';const require=__cR(import.meta.url);`;

/**
 * Options for creating a ServerBundler instance.
 */
export interface BundlerOptions {
	/** Entry point to build */
	entrypoint: string;
	/** Output directory */
	outDir: string;
	/** Platform instance */
	platform: Platform;
	/** Platform-specific esbuild configuration */
	platformESBuildConfig: PlatformESBuildConfig;
	/** User build config from shovel.json */
	userBuildConfig?: ProcessedBuildConfig;
	/** Lifecycle options for --lifecycle flag */
	lifecycle?: {
		/** Lifecycle stage to run: "install" or "activate" */
		stage: "install" | "activate";
	};
	/**
	 * Development mode: workers use message loop instead of own HTTP server.
	 * In dev mode, workers handle requests via postMessage from ServiceWorkerPool.
	 * In prod mode (default), each worker runs its own HTTP server with reusePort.
	 */
	development?: boolean;
}

/**
 * Build output paths.
 */
export interface BuildOutputs {
	/** Supervisor entry point (Node/Bun only) */
	index?: string;
	/** Worker entry point (all platforms) */
	worker?: string;
}

/**
 * Result of a build operation.
 */
export interface BuildResult {
	success: boolean;
	outputs: BuildOutputs;
	/** ESBuild metafile for bundle analysis */
	metafile?: ESBuild.Metafile;
	/** Build duration in milliseconds */
	elapsed?: number;
}

/**
 * Options for watch mode.
 */
export interface WatchOptions {
	/** Called after each rebuild */
	onRebuild?: (result: BuildResult) => void | Promise<void>;
}

/**
 * ESBuild bundler for Shovel apps.
 *
 * Usage:
 * ```typescript
 * const bundler = new ServerBundler({entrypoint, outDir, platform, ...});
 *
 * // One-shot build
 * const {success, outputs} = await bundler.build();
 * // outputs.index = supervisor (Node/Bun)
 * // outputs.worker = worker (all platforms)
 *
 * // Watch mode
 * const {success, outputs} = await bundler.watch({
 *   onRebuild: (result) => console.log("Rebuilt:", result.success)
 * });
 * ```
 */
export class ServerBundler {
	#options: BundlerOptions;
	#ctx?: ESBuild.BuildContext;
	#projectRoot: string;
	#initialBuildComplete: boolean;
	#initialBuildResolve?: (result: BuildResult) => void;
	#currentOutputs: BuildOutputs;
	#configWatchers: FSWatcher[];
	#dirWatchers: Map<string, {watcher: FSWatcher; files: Set<string>}>;
	#userEntryPath: string;
	#watchOptions?: WatchOptions;
	#changedFiles: Set<string>;
	#rebuildTimeout?: ReturnType<typeof setTimeout>;
	#buildStartTime?: number;

	constructor(options: BundlerOptions) {
		this.#options = options;
		this.#projectRoot = findProjectRoot();
		this.#initialBuildComplete = false;
		this.#currentOutputs = {worker: ""};
		this.#configWatchers = [];
		this.#dirWatchers = new Map();
		this.#userEntryPath = "";
		this.#changedFiles = new Set();
	}

	/**
	 * Schedule a debounced rebuild.
	 * Collects file changes and triggers rebuild after 50ms of quiet.
	 */
	#scheduleRebuild(changedFile: string): void {
		this.#changedFiles.add(changedFile);

		if (this.#rebuildTimeout) {
			clearTimeout(this.#rebuildTimeout);
		}

		this.#rebuildTimeout = setTimeout(() => {
			this.#rebuildTimeout = undefined;
			this.#ctx?.rebuild().catch((err) => {
				logger.error("Rebuild failed: {error}", {error: err});
			});
		}, 50);
	}

	/**
	 * One-shot build.
	 *
	 * Produces all platform entry points:
	 * - Node/Bun: index.js (supervisor) + worker.js
	 * - Cloudflare: worker.js
	 *
	 * Build options (minify, sourcemap, etc.) come from userBuildConfig.
	 */
	async build(): Promise<BuildResult> {
		const entryPath = resolve(this.#projectRoot, this.#options.entrypoint);
		const outputDir = resolve(this.#projectRoot, this.#options.outDir);
		const serverDir = join(outputDir, "server");

		await mkdir(serverDir, {recursive: true});
		await mkdir(join(outputDir, "public"), {recursive: true});

		const buildOptions = await this.#createBuildOptions(entryPath, outputDir);
		const result = await ESBuild.build(buildOptions);

		const external = buildOptions.external as string[] | undefined;
		this.#validateBuildResult(result, external ?? ["node:*"]);

		const outputs = this.#extractOutputPaths(result.metafile);
		const success = result.errors.length === 0;

		logger.debug("Build complete", {outputs, success});

		return {success, outputs, metafile: result.metafile};
	}

	/**
	 * Start watching and building.
	 *
	 * Returns after the initial build completes. Subsequent rebuilds
	 * trigger the onRebuild callback.
	 */
	async watch(options: WatchOptions = {}): Promise<BuildResult> {
		this.#watchOptions = options;
		const entryPath = resolve(this.#projectRoot, this.#options.entrypoint);
		this.#userEntryPath = entryPath;
		const outputDir = resolve(this.#projectRoot, this.#options.outDir);

		await mkdir(join(outputDir, "server"), {recursive: true});

		const initialBuildPromise = new Promise<BuildResult>((resolve) => {
			this.#initialBuildResolve = resolve;
		});

		const buildOptions = await this.#createBuildOptions(entryPath, outputDir, {
			watch: true,
		});

		this.#ctx = await ESBuild.context(buildOptions);

		logger.debug("Starting esbuild watch mode");
		await this.#ctx.watch();

		this.#watchConfigFiles();

		return initialBuildPromise;
	}

	/**
	 * Stop watching and dispose of resources.
	 */
	async stop(): Promise<void> {
		if (this.#rebuildTimeout) {
			clearTimeout(this.#rebuildTimeout);
			this.#rebuildTimeout = undefined;
		}

		for (const watcher of this.#configWatchers) {
			watcher.close();
		}
		this.#configWatchers = [];

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
	 * Create ESBuild options.
	 */
	async #createBuildOptions(
		entryPath: string,
		outputDir: string,
		options: {watch?: boolean} = {},
	): Promise<ESBuild.BuildOptions> {
		const {watch = false} = options;
		const platformESBuildConfig = this.#options.platformESBuildConfig;
		const platformDefaults = this.#options.platform.getDefaults();
		const userBuildConfig = this.#options.userBuildConfig;

		// Convert absolute entry path to relative path for esbuild resolution
		// (esbuild resolves imports relative to resolveDir in the entry plugin)
		const relativeEntryPath = "./" + relative(this.#projectRoot, entryPath);

		// In development mode, use platform-specific dev entry points if available,
		// otherwise fall back to default message loop worker.
		// In production, always use platform entry points.
		const platformEntryPoints = this.#options.development
			? (this.#options.platform.getDevelopmentEntryPoints?.(relativeEntryPath) ??
					this.#getDevelopmentEntryPoints(relativeEntryPath))
			: this.#options.platform.getProductionEntryPoints(relativeEntryPath);

		const jsxOptions = await loadJSXConfig(this.#projectRoot);

		const userPlugins = userBuildConfig?.plugins?.length
			? await this.#loadUserPlugins(userBuildConfig.plugins)
			: [];

		const platformExternal = platformESBuildConfig.external ?? ["node:*"];
		const userExternal = userBuildConfig?.external ?? [];
		const external = [...platformExternal, ...userExternal];

		const isNodePlatform =
			(platformESBuildConfig.platform ?? "node") === "node";
		const requireShim = isNodePlatform ? REQUIRE_SHIM : "";

		// Build config from userBuildConfig (respects MODE from config/env)
		const target = userBuildConfig?.target ?? "es2022";
		const sourcemap = userBuildConfig?.sourcemap ?? (watch ? "inline" : false);
		const minify = userBuildConfig?.minify ?? false;
		const treeShaking = userBuildConfig?.treeShaking ?? true;

		// Build ESBuild entry points from platform entry points
		const esbuildEntryPoints: Record<string, string> = {
			config: "shovel:config",
		};
		for (const name of Object.keys(platformEntryPoints)) {
			esbuildEntryPoints[name] = `shovel:entry:${name}`;
		}

		// assetsPlugin runs FIRST to intercept imports with { assetBase: "..." }.
		// userPlugins run after, so they can handle other file types (e.g., .glsl)
		// that don't have assetBase but still need transformation.
		const plugins: ESBuild.Plugin[] = [
			createConfigPlugin(this.#projectRoot, this.#options.outDir, {
				platformDefaults,
				lifecycle: this.#options.lifecycle,
			}),
			createEntryPlugin(this.#projectRoot, platformEntryPoints),
			createAssetsManifestPlugin(this.#projectRoot, this.#options.outDir),
			importMetaPlugin(),
			assetsPlugin({
				outDir: outputDir,
				plugins: userPlugins,
				jsx: jsxOptions.jsx,
				jsxFactory: jsxOptions.jsxFactory,
				jsxFragment: jsxOptions.jsxFragment,
				jsxImportSource: jsxOptions.jsxImportSource,
			}),
			...userPlugins,
		];

		if (watch) {
			plugins.push(this.#createBuildNotifyPlugin(external));
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

		applyJSXOptions(buildOptions, jsxOptions);

		return buildOptions;
	}

	/**
	 * Extract output paths from metafile.
	 */
	#extractOutputPaths(metafile?: ESBuild.Metafile): BuildOutputs {
		const outputs: BuildOutputs = {};

		if (!metafile) return outputs;

		const outputPaths = Object.keys(metafile.outputs);

		const indexOutput = outputPaths.find((p) => p.endsWith("index.js"));
		if (indexOutput) {
			outputs.index = resolve(this.#projectRoot, indexOutput);
		}

		const workerOutput = outputPaths.find((p) => p.endsWith("worker.js"));
		if (workerOutput) {
			outputs.worker = resolve(this.#projectRoot, workerOutput);
		}

		return outputs;
	}

	/**
	 * Get development entry points.
	 * Workers use startWorkerMessageLoop() to handle requests from ServiceWorkerPool.
	 */
	#getDevelopmentEntryPoints(userEntryPath: string): Record<string, string> {
		const workerCode = `// Development Worker
import {initWorkerRuntime, runLifecycle, startWorkerMessageLoop} from "@b9g/platform/runtime";
import {config} from "shovel:config";

const result = await initWorkerRuntime({config});
const registration = result.registration;

await import("${userEntryPath}");
await runLifecycle(registration);
startWorkerMessageLoop({registration, databases: result.databases});
`;
		return {worker: workerCode};
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
	 */
	#createBuildNotifyPlugin(external: string[]): ESBuild.Plugin {
		return {
			name: "build-notify",
			setup: (build) => {
				build.onStart(() => {
					this.#buildStartTime = performance.now();
					if (this.#changedFiles.size > 0) {
						const files = Array.from(this.#changedFiles).map((f) =>
							relative(this.#projectRoot, f),
						);
						this.#changedFiles.clear();
						if (files.length === 1) {
							logger.info("Rebuilding: {file}", {file: files[0]});
						} else {
							logger.info("Rebuilding: {files}", {
								files: files.join(", "),
							});
						}
					} else {
						logger.info("Building...");
					}
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

					const outputs = this.#extractOutputPaths(result.metafile);
					const elapsed = this.#buildStartTime
						? Math.round(performance.now() - this.#buildStartTime)
						: 0;

					if (success) {
						logger.info("Build complete in {elapsed}ms", {elapsed});
					} else {
						logger.error("Build errors ({elapsed}ms): {errors}", {
							elapsed,
							errors: result.errors,
						});
					}

					this.#currentOutputs = outputs;

					if (result.metafile) {
						this.#updateSourceWatchers(result.metafile);
					}

					const buildResult: BuildResult = {success, outputs, elapsed};

					if (!this.#initialBuildComplete) {
						this.#initialBuildComplete = true;
						await new Promise((resolve) => setTimeout(resolve, 0));
						this.#initialBuildResolve?.(buildResult);
					} else {
						await this.#watchOptions?.onRebuild?.(buildResult);
					}
				});
			},
		};
	}

	/**
	 * Validate build result.
	 */
	#validateBuildResult(
		result: ESBuild.BuildResult,
		allowedExternals: string[],
	) {
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

		if (result.metafile) {
			const allowedSet = new Set(allowedExternals);
			const wildcardPrefixes = allowedExternals
				.filter((e) => e.endsWith(":*"))
				.map((e) => e.slice(0, -1));
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
	 * Watch config files for changes.
	 */
	#watchConfigFiles() {
		const configFiles = ["shovel.json", "package.json"];

		for (const filename of configFiles) {
			const filepath = join(this.#projectRoot, filename);
			if (!existsSync(filepath)) continue;

			try {
				const watcher = watch(filepath, {persistent: false}, (event) => {
					if (event === "change") {
						this.#scheduleRebuild(filepath);
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
	 * Update source file watchers from metafile.
	 */
	#updateSourceWatchers(metafile: ESBuild.Metafile) {
		const newDirFiles = new Map<string, Set<string>>();

		if (this.#userEntryPath) {
			const entryDir = dirname(this.#userEntryPath);
			const entryFile = basename(this.#userEntryPath);
			if (!newDirFiles.has(entryDir)) {
				newDirFiles.set(entryDir, new Set());
			}
			newDirFiles.get(entryDir)!.add(entryFile);
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

		for (const [dir, entry] of this.#dirWatchers) {
			if (!newDirFiles.has(dir)) {
				entry.watcher.close();
				this.#dirWatchers.delete(dir);
			}
		}

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
								const changedFile = filename ? join(dir, filename) : dir;
								logger.debug("Native watcher detected change: {file}", {
									file: changedFile,
								});
								this.#scheduleRebuild(changedFile);
							}
						},
					);

					this.#dirWatchers.set(dir, {watcher, files});
				} catch (err) {
					logger.warn("Failed to watch directory {dir}: {error}", {
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

		logger.info("Watching {fileCount} files in {dirCount} directories", {
			fileCount: totalFiles,
			dirCount: this.#dirWatchers.size,
		});
	}
}
