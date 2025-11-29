/**
 * Simple file watcher that runs ESBuild and triggers Worker reloads
 */

import * as ESBuild from "esbuild";
import {watch} from "fs";
import {resolve, dirname, join} from "path";
import {readFileSync} from "fs";
import {mkdir} from "fs/promises";
import {assetsPlugin} from "@b9g/assets/plugin";
import {importMetaPlugin} from "./import-meta-plugin.js";
import {getLogger} from "@logtape/logtape";

const logger = getLogger(["watcher"]);

export interface WatcherOptions {
	/** Entry point to build */
	entrypoint: string;
	/** Output directory */
	outDir: string;
	/** Callback when build completes */
	onBuild?: (success: boolean, version: number) => void;
}

export class Watcher {
	#watcher?: ReturnType<typeof watch>;
	#building: boolean;
	#options: WatcherOptions;

	constructor(options: WatcherOptions) {
		this.#building = false;
		this.#options = options;
	}

	/**
	 * Start watching and building
	 * @returns true if initial build succeeded, false if it failed
	 */
	async start(): Promise<boolean> {
		const entryPath = resolve(this.#options.entrypoint);

		// Initial build - propagate errors so caller knows if build failed
		const success = await this.#build();

		// Watch for changes (even if initial build failed, so rebuilds can fix errors)
		const watchDir = dirname(entryPath);
		logger.info("Watching for changes", {watchDir});

		this.#watcher = watch(
			watchDir,
			{recursive: true},
			(_eventType, filename) => {
				if (
					filename &&
					(filename.endsWith(".js") ||
						filename.endsWith(".ts") ||
						filename.endsWith(".tsx"))
				) {
					// Ignore files in the output directory to prevent infinite rebuild loops
					const outDir = this.#options.outDir || "dist";
					if (
						filename.startsWith(outDir + "/") ||
						filename.startsWith(outDir + "\\")
					) {
						return;
					}
					this.#debouncedBuild();
				}
			},
		);

		return success;
	}

	/**
	 * Stop watching
	 */
	async stop() {
		if (this.#watcher) {
			this.#watcher.close();
			this.#watcher = undefined;
		}
	}

	#timeout?: NodeJS.Timeout;

	#debouncedBuild() {
		if (this.#timeout) {
			clearTimeout(this.#timeout);
		}
		this.#timeout = setTimeout(() => {
			this.#build();
		}, 100);
	}

	async #build(): Promise<boolean> {
		if (this.#building) return false;
		this.#building = true;

		try {
			const entryPath = resolve(this.#options.entrypoint);
			const outputDir = resolve(this.#options.outDir);
			const version = Date.now();

			// Find workspace root by looking for package.json with workspaces
			// Search upward from cwd, but don't traverse past it
			const initialCwd = process.cwd();
			let workspaceRoot = initialCwd;

			while (workspaceRoot !== dirname(workspaceRoot)) {
				try {
					const packageJSON = JSON.parse(
						readFileSync(resolve(workspaceRoot, "package.json"), "utf8"),
					);
					if (packageJSON.workspaces) {
						break;
					}
				} catch {
					// No package.json found, continue up the tree
				}
				workspaceRoot = dirname(workspaceRoot);
			}

			// If we reached filesystem root without finding workspace, use original cwd
			if (workspaceRoot === dirname(workspaceRoot)) {
				workspaceRoot = initialCwd;
			}

			logger.info("Building", {entryPath});
			logger.info("Workspace root", {workspaceRoot});

			// Ensure output directory structure exists
			await mkdir(join(outputDir, "server"), {recursive: true});
			await mkdir(join(outputDir, "static"), {recursive: true});

			const result = await ESBuild.build({
				entryPoints: [entryPath],
				bundle: true,
				format: "esm",
				target: "es2022",
				platform: "node",
				outfile: `${outputDir}/server/app.js`,
				packages: "external",
				absWorkingDir: workspaceRoot,
				plugins: [
					importMetaPlugin(),
					assetsPlugin({
						outDir: outputDir,
					}),
				],
				sourcemap: "inline",
				minify: false,
				treeShaking: true,
			});

			if (result.errors.length > 0) {
				logger.error("Build errors", {errors: result.errors});
				this.#options.onBuild?.(false, version);
				return false;
			} else {
				logger.info("Build complete", {version});
				this.#options.onBuild?.(true, version);
				return true;
			}
		} catch (error) {
			// ESBuild throws on fatal errors like missing exports
			logger.error("Build failed", {error});
			this.#options.onBuild?.(false, Date.now());
			return false;
		} finally {
			this.#building = false;
		}
	}
}
