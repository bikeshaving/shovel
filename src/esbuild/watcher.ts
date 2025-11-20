/**
 * Simple file watcher that runs ESBuild and triggers Worker reloads
 */

import * as esbuild from "esbuild";
import {watch} from "fs";
import {resolve, dirname, join} from "path";
import {readFileSync} from "fs";
import {mkdir} from "fs/promises";
import {assetsPlugin} from "@b9g/assets/plugin";
import {DEFAULTS} from "./config.js";
import {createEnvDefines} from "./env-defines.js";
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
		this.#options = {
			outDir: DEFAULTS.PATHS.OUTPUT_DIR,
			...options,
		};
	}

	/**
	 * Start watching and building
	 */
	async start() {
		const entryPath = resolve(this.#options.entrypoint);

		// Initial build
		await this.#build();

		// Watch for changes
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
					this.#debouncedBuild();
				}
			},
		);
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

	async #build() {
		if (this.#building) return;
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
					const packageJson = JSON.parse(
						readFileSync(resolve(workspaceRoot, "package.json"), "utf8"),
					);
					if (packageJson.workspaces) {
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
			await mkdir(join(outputDir, "assets"), {recursive: true});

			const result = await esbuild.build({
				entryPoints: [entryPath],
				bundle: true,
				format: "esm",
				target: "es2022",
				platform: "node",
				outfile: `${outputDir}/server/app.js`,
				packages: "external",
				absWorkingDir: workspaceRoot,
				plugins: [
					assetsPlugin({
						outputDir: `${outputDir}/assets`,
						manifest: `${outputDir}/server/asset-manifest.json`,
					}),
				],
				sourcemap: "inline",
				minify: false,
				treeShaking: true,
				define: createEnvDefines("development"),
			});

			if (result.errors.length > 0) {
				logger.error("Build errors", {errors: result.errors});
				this.#options.onBuild?.(false, version);
			} else {
				logger.info("Build complete", {version});
				this.#options.onBuild?.(true, version);
			}
		} catch (error) {
			logger.error("Build failed", {error});
			this.#options.onBuild?.(false, Date.now());
		} finally {
			this.#building = false;
		}
	}
}
