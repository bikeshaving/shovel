#!/usr/bin/env node
/**
 * Shovel CLI - The obsessively web platform-based web framework
 *
 * Smart defaults: Detect current runtime for development
 * Override: Explicit targeting for deployment
 */

import {Command} from "commander";
import {cpus} from "os";
import pkg from "../package.json" with {type: "json"};
import {
	resolvePlatform,
	createPlatform,
	getPlatformDefaults,
	displayPlatformInfo,
} from "@b9g/platform";

/**
 * Determine worker count based on environment and options
 */
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

	// Environment-based defaults
	const isProduction = process.env.NODE_ENV === "production";
	if (isProduction) {
		// Production: use CPU count for maximum throughput
		return cpus().length;
	} else {
		// Development: use 2 workers to encourage concurrency thinking
		return 2;
	}
}

// Main CLI execution starts here
{
	// Main CLI execution
	process.title = "shovel";
	const program = new Command();

	program
		.name("shovel")
		.version(pkg.version)
		.description("The obsessively web platform-based web framework");

	/**
	 * Development command - auto-detects platform
	 */
	program
		.command("develop <entrypoint>")
		.description("Start development server with hot reloading")
		.option("-p, --port <port>", "Port to listen on", "3000")
		.option(
			"--platform <platform>",
			"Explicit platform (node, bun, cloudflare)",
		)
		.option("--host <host>", "Host to bind to", "localhost")
		.option(
			"-w, --workers <count>",
			"Number of worker threads (default: 2 in dev, CPU count in prod)",
		)
		.option("--cache <adapter>", "Cache adapter (memory, redis, kv)")
		.option("--filesystem <adapter>", "Filesystem adapter (memory, fs, s3, r2, bun-s3)")
		.option("--verbose", "Verbose logging")
		.action(async (entrypoint, options) => {
			try {
				const platformName = resolvePlatform(options);
				const platformDefaults = getPlatformDefaults(platformName);
				const workerCount = getWorkerCount(options);

				if (options.verbose) {
					displayPlatformInfo(platformName);
					console.info(`🔧 Worker configuration: ${workerCount} workers`);
				}

				// Create platform with smart defaults
				const platformConfig = {
					hotReload: true,
					port: parseInt(options.port) || platformDefaults.port,
					host: options.host,
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

				const platform = await createPlatform(platformName, platformConfig);

				console.info(`🔥 Starting development server...`);
				console.info(`⚙️  Workers: ${workerCount}`);

				// Set up file watching and building for development
				const {SimpleWatcher} = await import("./simple-watcher.ts");
				let serviceWorker;

				const outDir = "dist";
				const watcher = new SimpleWatcher({
					entrypoint,
					outDir,
					onBuild: async (success, version) => {
						if (success && serviceWorker) {
							console.info(`🔄 Reloading Workers (v${version})...`);
							await serviceWorker.runtime.reloadWorkers(version);
							console.info(`✅ Workers reloaded`);
						}
					},
				});

				// Initial build and start watching
				console.info(`📦 Building ${entrypoint}...`);
				await watcher.start();
				console.info(`✅ Build complete, watching for changes...`);

				// Load ServiceWorker app from built output
				const builtEntrypoint = `${outDir}/app.js`;
				serviceWorker = await platform.loadServiceWorker(builtEntrypoint, {
					hotReload: true,
					workerCount,
					caches: {
						pages: {type: "memory", maxEntries: 100},
						api: {type: "memory", ttl: 300000},
						static: {type: "memory"},
					},
				});

				// Create development server
				const server = platform.createServer(serviceWorker.handleRequest, {
					port: parseInt(options.port) || platformDefaults.port,
					host: options.host,
				});

				await server.listen();
				console.info(
					`🚀 Server running at http://${options.host}:${options.port}`,
				);
				console.info(`📁 Serving: ${entrypoint}`);

				// Graceful shutdown
				process.on("SIGINT", async () => {
					console.info("\n🛑 Shutting down...");
					await watcher.stop();
					await serviceWorker.dispose();
					await platform.dispose();
					await server.close();
					process.exit(0);
				});
			} catch (error) {
				console.error(`❌ Failed to start development server:`, error.message);
				if (options.verbose) {
					console.error(error.stack);
				}
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
			"--target <platform>",
			"Target platform (node, bun, cloudflare, vercel)",
		)
		.option("--out-dir <dir>", "Output directory", "dist")
		.option(
			"-w, --workers <count>",
			"Number of worker threads (default: CPU count in prod)",
		)
		.option("--cache <adapter>", "Cache adapter (memory, redis, kv)")
		.option("--filesystem <adapter>", "Filesystem adapter (memory, fs, s3, r2, bun-s3)")
		.option("--verbose", "Verbose logging")
		.action(async (entrypoint, options) => {
			try {
				const platformName = resolvePlatform(options);

				if (options.verbose) {
					displayPlatformInfo(platformName);
				}

				console.info(`📦 Building for ${platformName}...`);

				// Import build functionality
				const {buildForProduction} = await import("./_build.js");

				// Build ServiceWorker app to plain JavaScript (Bun-focused)
				await buildForProduction({
					entrypoint,
					outDir: options.outDir,
					verbose: options.verbose,
				});

				console.info(`✅ Build complete`);
				console.info(`📁 Output: ${options.outDir}`);
			} catch (error) {
				console.error(`❌ Build failed:`, error.message);
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
			"--target <platform>",
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
				const platformName = resolvePlatform(options);
				const workerCount = getWorkerCount(options);

				if (options.verbose) {
					displayPlatformInfo(platformName);
					console.info(`🔧 Worker configuration: ${workerCount} workers`);
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

				const platform = await createPlatform(platformName, platformConfig);

				console.info(`🚀 Activating ServiceWorker...`);

				// Load ServiceWorker app
				const serviceWorker = await platform.loadServiceWorker(entrypoint, {
					hotReload: false,
					workerCount,
				});

				// The ServiceWorker install/activate lifecycle will handle any self-generation
				// Apps can use self.dirs.open("static") in their activate event to pre-render
				console.info(`✅ ServiceWorker activated - check dist/ for generated content`);

				await serviceWorker.dispose();
				await platform.dispose();
			} catch (error) {
				console.error(`❌ ServiceWorker activation failed:`, error.message);
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
				"   shovel build app.js --target=cloudflare       # Target deployment",
			);
			console.info(
				"   shovel wrangler app.js --cache=kv --filesystem=r2  # Generate wrangler.toml",
			);
		});

	await program.parseAsync(process.argv);
}
