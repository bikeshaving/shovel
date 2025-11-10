#!/usr/bin/env node
import {Command} from "commander";
import pkg from "../package.json" with {type: "json"};
import {DEFAULTS, getDefaultWorkerCount} from "./config.js";

function getWorkerCount(options) {
	// Explicit CLI option takes precedence
	if (options.workers) {
		const count = parseInt(options.workers);
		if (isNaN(count) || count < 1) {
			throw new Error(
				`Invalid worker count: ${options.workers}. Must be a positive integer.`,
			);
		}
		return count;
	}

	// TODO: wtf where does this go
	return getDefaultWorkerCount();
}

// Main CLI execution starts here
{
	// Main CLI execution
	process.title = "shovel";
	const program = new Command();

	program
		.name("shovel")
		.version(pkg.version)
		.description("Universal ServiceWorker deployment platform");

	/**
	 * Development command - auto-detects platform
	 */
	program
		.command("develop <entrypoint>")
		.description("Start development server with hot reloading")
		.option("-p, --port <port>", "Port to listen on", DEFAULTS.SERVER.PORT.toString())
		.option(
			"--platform <platform>",
			"Explicit platform (node, bun, cloudflare)",
		)
		.option("--host <host>", "Host to bind to", DEFAULTS.SERVER.HOST)
		.option(
			"-w, --workers <count>",
			"Number of worker threads (default: 2 in dev, CPU count in prod)",
		)
		.option("--cache <adapter>", "Cache adapter (memory, redis, kv)")
		.option("--filesystem <adapter>", "Filesystem adapter (memory, fs, s3, r2, bun-s3)")
		.option("--verbose", "Verbose logging")
		.action(async (entrypoint, options) => {
			try {
				const platform = await import("@b9g/platform");
				const platformName = platform.resolvePlatform(options);
				const workerCount = getWorkerCount(options);

				if (options.verbose) {
					platform.displayPlatformInfo(platformName);
					console.info(`[CLI] ✅ Worker configuration: ${workerCount} workers`);
				}

				// Create platform with smart defaults
				const platformConfig = {
					hotReload: true,
					port: parseInt(options.port) || DEFAULTS.SERVER.PORT,
					host: options.host || DEFAULTS.SERVER.HOST,
				};

				// Convert CLI flags to platform config format
				if (options.cache) {
					platformConfig.caches = {
						pages: { type: options.cache },
						api: { type: options.cache },
						static: { type: options.cache },
					};
				}

				if (options.filesystem) {
					platformConfig.filesystem = { type: options.filesystem };
				}

				const platformInstance = await platform.createPlatform(platformName, platformConfig);

				console.info(`[CLI] ▶️  Starting development server...`);
				console.info(`[CLI] ✅ Workers: ${workerCount}`);

				// Set up file watching and building for development
				const {Watcher} = await import("./watcher.ts");
				let serviceWorker;

				const outDir = "dist";
				const watcher = new Watcher({
					entrypoint,
					outDir,
					onBuild: async (success, version) => {
						if (success && serviceWorker) {
							console.info(`[CLI] 🔄 Reloading Workers (v${version})...`);
							// The reloadWorkers method is on the platform instance, not the ServiceWorker runtime
							if (platformInstance && typeof platformInstance.reloadWorkers === 'function') {
								await platformInstance.reloadWorkers(version);
							}
							console.info(`[CLI] ✅ Workers reloaded`);
						}
					},
				});

				// Initial build and start watching
				console.info(`[CLI] 🔄 Building ${entrypoint}...`);
				await watcher.start();
				console.info(`[CLI] ✅ Build complete, watching for changes...`);

				// Load ServiceWorker app from built output
				const builtEntrypoint = `${outDir}/server/app.js`;
				serviceWorker = await platformInstance.loadServiceWorker(builtEntrypoint, {
					hotReload: true,
					workerCount,
					caches: {
						pages: {type: "memory", maxEntries: DEFAULTS.CACHE.MAX_ENTRIES},
						api: {type: "memory", ttl: DEFAULTS.CACHE.TTL},
						static: {type: "memory"},
					},
				});

				// Create development server
				const server = platformInstance.createServer(serviceWorker.handleRequest, {
					port: parseInt(options.port) || DEFAULTS.SERVER.PORT,
					host: options.host || DEFAULTS.SERVER.HOST,
				});

				await server.listen();
				console.info(
					`[CLI] ✅ Server running at http://${options.host}:${options.port}`,
				);
				console.info(`[CLI] ➡️  Serving: ${entrypoint}`);

				// Graceful shutdown
				process.on("SIGINT", async () => {
					console.info("\n[CLI] ⏹️  Shutting down...");
					await watcher.stop();
					await serviceWorker.dispose();
					await platformInstance.dispose();
					await server.close();
					process.exit(0);
				});
			} catch (error) {
				console.error(`[CLI] ❌ Failed to start development server:`, error.message);
				console.error('Stack trace:', error.stack);
				process.exit(1);
			}
		});

	/**
	 * Build command - supports targeting different platforms
	 */
	program
		.command("build <entrypoint>")
		.description("Build app for deployment")
		.option(
			"--platform <platform>",
			"Target platform (node, bun, cloudflare, vercel)",
		)
		.option("--out-dir <dir>", "Output directory", DEFAULTS.PATHS.OUTPUT_DIR)
		.option(
			"-w, --workers <count>",
			"Number of worker threads (default: CPU count in prod)",
		)
		.option("--cache <adapter>", "Cache adapter (memory, redis, kv)")
		.option("--filesystem <adapter>", "Filesystem adapter (memory, fs, s3, r2, bun-s3)")
		.option("--verbose", "Verbose logging")
		.action(async (entrypoint, options) => {
			try {
				const platform = await import("@b9g/platform");
				const platformName = platform.resolvePlatform(options);

				if (options.verbose) {
					platform.displayPlatformInfo(platformName);
				}

				console.info(`[CLI] 🔄 Building for ${platformName}...`);

				// Import build functionality
				const {buildForProduction} = await import("./commands/build.js");

				// Build ServiceWorker app for target platform
				const workerCount = getWorkerCount(options);
				await buildForProduction({
					entrypoint,
					outDir: options.outDir,
					verbose: options.verbose,
					platform: platformName,
					workerCount,
				});

				console.info(`[CLI] ✅ Build complete`);
				console.info(`[CLI] ➡️  Output: ${options.outDir}`);
			} catch (error) {
				console.error(`[CLI] ❌ Build failed:`, error.message);
				if (options.verbose) {
					console.error(error.stack);
				}
				process.exit(1);
			}
		});

	/**
	 * Activate ServiceWorker - run install/activate lifecycle for self-generation
	 */
	program
		.command("activate <entrypoint>")
		.description("Run ServiceWorker install/activate lifecycle with self-generation")
		.option(
			"--platform <platform>",
			"Target platform for hosting (node, bun, cloudflare)",
		)
		.option(
			"-w, --workers <count>",
			"Number of worker threads (default: CPU count)",
		)
		.option("--cache <adapter>", "Cache adapter (memory, redis, kv)")
		.option("--filesystem <adapter>", "Filesystem adapter (memory, fs, s3, r2, bun-s3)")
		.option("--verbose", "Verbose logging")
		.action(async (entrypoint, options) => {
			try {
				const platform = await import("@b9g/platform");
				const platformName = platform.resolvePlatform(options);
				const workerCount = getWorkerCount(options);

				if (options.verbose) {
					platform.displayPlatformInfo(platformName);
					console.info(`[CLI] ✅ Worker configuration: ${workerCount} workers`);
				}

				const platformConfig = {
					hotReload: false,
				};

				// Convert CLI flags to platform config format
				if (options.cache) {
					platformConfig.caches = {
						pages: { type: options.cache },
						api: { type: options.cache },
						static: { type: options.cache },
					};
				}

				if (options.filesystem) {
					platformConfig.filesystem = { type: options.filesystem };
				}

				const platformInstance = await platform.createPlatform(platformName, platformConfig);

				console.info(`[CLI] ▶️  Activating ServiceWorker...`);

				// Load ServiceWorker app
				const serviceWorker = await platformInstance.loadServiceWorker(entrypoint, {
					hotReload: false,
					workerCount,
				});

				// The ServiceWorker install/activate lifecycle will handle any self-generation
				// Apps can use self.dirs.open("static") in their activate event to pre-render
				console.info(`[CLI] ✅ ServiceWorker activated - check dist/ for generated content`);

				await serviceWorker.dispose();
				await platformInstance.dispose();
			} catch (error) {
				console.error(`[CLI] ❌ ServiceWorker activation failed:`, error.message);
				if (options.verbose) {
					console.error(error.stack);
				}
				process.exit(1);
			}
		});

	/**
	 * Platform info command
	 */
	program
		.command("info")
		.description("Display platform and runtime information")
		.action(async () => {
			const {detectRuntime, detectDevelopmentPlatform} = await import(
				"@b9g/platform"
			);

			console.info("🔍 Shovel Platform Information");
			console.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
			console.info(`Current Runtime: ${detectRuntime()}`);
			console.info(`Default Platform: ${detectDevelopmentPlatform()}`);
			console.info(`Available Platforms: node, bun, cloudflare`);
			console.info(`Shovel Version: ${pkg.version}`);
			console.info("");
			console.info("💡 Usage Examples:");
			console.info(
				"   shovel develop app.js                         # Auto-detect platform",
			);
			console.info(
				"   shovel develop app.js --platform=bun          # Explicit platform",
			);
			console.info(
				"   shovel develop app.js --cache=redis           # Redis cache adapter",
			);
			console.info(
				"   shovel develop app.js --filesystem=s3         # S3 filesystem adapter",
			);
			console.info(
				"   shovel build app.js --platform=cloudflare     # Target deployment",
			);
			console.info(
				"   shovel wrangler app.js --cache=kv --filesystem=r2  # Generate wrangler.toml",
			);
		});

	await program.parseAsync(process.argv);
}
