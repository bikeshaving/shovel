import {DEFAULTS} from "../esbuild/config.js";

export async function developCommand(entrypoint, options) {
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
				pages: {type: options.cache},
				api: {type: options.cache},
				static: {type: options.cache},
			};
		}

		if (options.filesystem) {
			platformConfig.filesystem = {type: options.filesystem};
		}

		const platformInstance = await platform.createPlatform(
			platformName,
			platformConfig,
		);

		console.info(`[CLI] ▶️  Starting development server...`);
		console.info(`[CLI] ✅ Workers: ${workerCount}`);

		// Set up file watching and building for development
		const {Watcher} = await import("../esbuild/watcher.js");
		let serviceWorker;

		const outDir = "dist";
		const watcher = new Watcher({
			entrypoint,
			outDir,
			onBuild: async (success, version) => {
				if (success && serviceWorker) {
					console.info(`[CLI] 🔄 Reloading Workers (v${version})...`);
					// The reloadWorkers method is on the platform instance, not the ServiceWorker runtime
					if (
						platformInstance &&
						typeof platformInstance.reloadWorkers === "function"
					) {
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
		console.error(
			`[CLI] ❌ Failed to start development server:`,
			error.message,
		);
		console.error("Stack trace:", error.stack);
		process.exit(1);
	}
}

function getWorkerCount(options) {
	// Explicit CLI option takes precedence
	if (options.workers) {
		return parseInt(options.workers);
	}
	// Environment variable second
	if (process.env.WORKER_COUNT) {
		return parseInt(process.env.WORKER_COUNT);
	}
	// Default from config
	return DEFAULTS.WORKERS;
}
