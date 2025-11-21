import {DEFAULTS} from "../esbuild/config.js";
import {configure, getConsoleSink, getLogger} from "@logtape/logtape";
import {AsyncContext} from "@b9g/async-context";

// CLI logger
const logger = getLogger(["cli"]);

// Configure LogTape for structured logging
await configure({
	contextLocalStorage: new AsyncContext.Variable(),
	sinks: {
		console: getConsoleSink(),
	},
	loggers: [
		{category: ["logtape", "meta"], sinks: []},
		{category: ["platform-node"], level: "debug", sinks: ["console"]},
		{category: ["platform-bun"], level: "debug", sinks: ["console"]},
		{category: ["platform-cloudflare"], level: "debug", sinks: ["console"]},
		{category: ["cache"], level: "debug", sinks: ["console"]},
		{category: ["router"], level: "debug", sinks: ["console"]},
		{category: ["assets"], level: "debug", sinks: ["console"]},
		{category: ["cli"], level: "debug", sinks: ["console"]},
		{category: ["watcher"], level: "debug", sinks: ["console"]},
		{category: ["worker"], level: "debug", sinks: ["console"]},
	],
});

export async function developCommand(entrypoint, options) {
	try {
		const platform = await import("@b9g/platform");
		const platformName = platform.resolvePlatform(options);
		const workerCount = getWorkerCount(options);

		if (options.verbose) {
			platform.displayPlatformInfo(platformName);
			logger.info("Worker configuration", {workerCount});
		}

		// Create platform with smart defaults
		const platformConfig = {
			hotReload: true,
			port: parseInt(options.port) || DEFAULTS.SERVER.PORT,
			host: options.host || DEFAULTS.SERVER.HOST,
		};

		// Build cache configuration - prefer CLI flags, fallback to defaults
		const cacheConfig = options.cache
			? {
					pages: {type: options.cache},
					api: {type: options.cache},
					static: {type: options.cache},
				}
			: {
					pages: {type: "memory", maxEntries: DEFAULTS.CACHE.MAX_ENTRIES},
					api: {type: "memory", ttl: DEFAULTS.CACHE.TTL},
					static: {type: "memory"},
				};

		// Convert CLI flags to platform config format
		platformConfig.caches = cacheConfig;

		if (options.filesystem) {
			platformConfig.filesystem = {type: options.filesystem};
		}

		const platformInstance = await platform.createPlatform(
			platformName,
			platformConfig,
		);

		logger.info("Starting development server", {});
		logger.info("Workers", {workerCount});

		// Set up file watching and building for development
		const {Watcher} = await import("../esbuild/watcher.js");
		let serviceWorker;

		const outDir = "dist";
		const watcher = new Watcher({
			entrypoint,
			outDir,
			onBuild: async (success, version) => {
				if (success && serviceWorker) {
					logger.info("Reloading Workers", {version});
					// The reloadWorkers method is on the platform instance, not the ServiceWorker runtime
					if (
						platformInstance &&
						typeof platformInstance.reloadWorkers === "function"
					) {
						await platformInstance.reloadWorkers(version);
					}
					logger.info("Workers reloaded", {});
				}
			},
		});

		// Initial build and start watching
		logger.info("Building", {entrypoint});
		await watcher.start();
		logger.info("Build complete, watching for changes", {});

		// Load ServiceWorker app from built output
		const builtEntrypoint = `${outDir}/server/app.js`;
		serviceWorker = await platformInstance.loadServiceWorker(builtEntrypoint, {
			hotReload: true,
			workerCount,
			caches: cacheConfig,
		});

		// Create development server
		const server = platformInstance.createServer(serviceWorker.handleRequest, {
			port: parseInt(options.port) || DEFAULTS.SERVER.PORT,
			host: options.host || DEFAULTS.SERVER.HOST,
		});

		await server.listen();
		logger.info("Server running", {
			url: `http://${options.host}:${options.port}`,
		});
		logger.info("Serving", {entrypoint});

		// Graceful shutdown
		process.on("SIGINT", async () => {
			logger.info("Shutting down", {});
			await watcher.stop();
			await serviceWorker.dispose();
			await platformInstance.dispose();
			await server.close();
			process.exit(0);
		});
	} catch (error) {
		logger.error("Failed to start development server", {
			error: error.message,
			stack: error.stack,
		});
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
