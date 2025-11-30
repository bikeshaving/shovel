/**
 * File watcher that uses ESBuild's native watch mode for accurate dependency tracking.
 * Watches all imported files including node_modules and linked packages.
 */

import * as ESBuild from "esbuild";
import {resolve, dirname, join} from "path";
import {readFileSync} from "fs";
import {mkdir, unlink} from "fs/promises";
import {assetsPlugin} from "@b9g/assets/plugin";
import {importMetaPlugin} from "./import-meta-plugin.js";
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
	#initialBuildComplete: boolean;
	#initialBuildResolve?: (result: {
		success: boolean;
		entrypoint: string;
	}) => void;
	#currentEntrypoint: string;
	#previousEntrypoint: string;

	constructor(options: WatcherOptions) {
		this.#options = options;
		this.#initialBuildComplete = false;
		this.#currentEntrypoint = "";
		this.#previousEntrypoint = "";
	}

	/**
	 * Start watching and building
	 * @returns Result with success status and the hashed entrypoint path
	 */
	async start(): Promise<{success: boolean; entrypoint: string}> {
		const entryPath = resolve(this.#options.entrypoint);
		const outputDir = resolve(this.#options.outDir);

		// Find workspace root by looking for package.json with workspaces
		const workspaceRoot = this.#findWorkspaceRoot();

		// Ensure output directory structure exists
		await mkdir(join(outputDir, "server"), {recursive: true});
		await mkdir(join(outputDir, "static"), {recursive: true});

		// Create a promise that resolves when the initial build completes
		const initialBuildPromise = new Promise<{
			success: boolean;
			entrypoint: string;
		}>((resolve) => {
			this.#initialBuildResolve = resolve;
		});

		// Create esbuild context with onEnd plugin to detect builds
		this.#ctx = await ESBuild.context({
			entryPoints: [entryPath],
			bundle: true,
			format: "esm",
			target: "es2022",
			platform: "node",
			outdir: `${outputDir}/server`,
			entryNames: "[name]-[hash]",
			metafile: true,
			absWorkingDir: workspaceRoot,
			plugins: [
				importMetaPlugin(),
				assetsPlugin({
					outDir: outputDir,
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
							const success = result.errors.length === 0;

							// Extract output path from metafile
							let outputPath = "";
							if (result.metafile) {
								const outputs = Object.keys(result.metafile.outputs);
								const jsOutput = outputs.find((p) => p.endsWith(".js"));
								if (jsOutput) {
									// Convert relative path to absolute
									outputPath = resolve(jsOutput);
								}
							}

							if (success) {
								logger.info("Build complete", {entrypoint: outputPath});

								// Clean up old entrypoint file to prevent disk space leak
								// Only delete if it's different from the new one
								if (
									this.#currentEntrypoint &&
									this.#currentEntrypoint !== outputPath
								) {
									try {
										await unlink(this.#currentEntrypoint);
										// Also try to delete the source map if it exists
										await unlink(this.#currentEntrypoint + ".map").catch(
											() => {},
										);
										logger.debug("Cleaned up old build", {
											oldEntrypoint: this.#currentEntrypoint,
										});
									} catch {
										// File may already be deleted or not exist
									}
								}
							} else {
								logger.error("Build errors", {errors: result.errors});
							}

							this.#previousEntrypoint = this.#currentEntrypoint;
							this.#currentEntrypoint = outputPath;

							// Handle initial build
							if (!this.#initialBuildComplete) {
								this.#initialBuildComplete = true;
								this.#initialBuildResolve?.({success, entrypoint: outputPath});
							} else {
								// Subsequent rebuilds triggered by watch
								this.#options.onBuild?.(success, outputPath);
							}
						});
					},
				},
			],
			sourcemap: "inline",
			minify: false,
			treeShaking: true,
		});

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

	#findWorkspaceRoot(): string {
		// Search upward from cwd for package.json with workspaces
		const initialCwd = process.cwd();
		let workspaceRoot = initialCwd;

		while (workspaceRoot !== dirname(workspaceRoot)) {
			try {
				const packageJSON = JSON.parse(
					readFileSync(resolve(workspaceRoot, "package.json"), "utf8"),
				);
				if (packageJSON.workspaces) {
					return workspaceRoot;
				}
			} catch {
				// No package.json found, continue up the tree
			}
			workspaceRoot = dirname(workspaceRoot);
		}

		// If we reached filesystem root without finding workspace, use original cwd
		return initialCwd;
	}
}
