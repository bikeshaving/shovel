/**
 * File watcher that uses ESBuild's native watch mode for accurate dependency tracking.
 * Watches all imported files including node_modules and linked packages.
 */

import * as ESBuild from "esbuild";
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
	#options: WatcherOptions;
	#ctx?: ESBuild.BuildContext;
	#initialBuildComplete: boolean = false;
	#initialBuildSuccess: boolean = false;
	#initialBuildResolve?: (success: boolean) => void;

	constructor(options: WatcherOptions) {
		this.#options = options;
	}

	/**
	 * Start watching and building
	 * @returns true if initial build succeeded, false if it failed
	 */
	async start(): Promise<boolean> {
		const entryPath = resolve(this.#options.entrypoint);
		const outputDir = resolve(this.#options.outDir);

		// Find workspace root by looking for package.json with workspaces
		const workspaceRoot = this.#findWorkspaceRoot();

		// Ensure output directory structure exists
		await mkdir(join(outputDir, "server"), {recursive: true});
		await mkdir(join(outputDir, "static"), {recursive: true});

		// Create a promise that resolves when the initial build completes
		const initialBuildPromise = new Promise<boolean>((resolve) => {
			this.#initialBuildResolve = resolve;
		});

		// Create esbuild context with onEnd plugin to detect builds
		this.#ctx = await ESBuild.context({
			entryPoints: [entryPath],
			bundle: true,
			format: "esm",
			target: "es2022",
			platform: "node",
			outfile: `${outputDir}/server/app.js`,
			// No packages: "external" - bundle everything for dev/prod parity
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
						build.onEnd((result) => {
							const version = Date.now();
							const success = result.errors.length === 0;

							if (success) {
								logger.info("Build complete", {version});
							} else {
								logger.error("Build errors", {errors: result.errors});
							}

							// Handle initial build
							if (!this.#initialBuildComplete) {
								this.#initialBuildComplete = true;
								this.#initialBuildSuccess = success;
								this.#initialBuildResolve?.(success);
							} else {
								// Subsequent rebuilds triggered by watch
								this.#options.onBuild?.(success, version);
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
