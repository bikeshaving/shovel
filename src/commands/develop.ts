import {DEFAULTS} from "../esbuild/config.js";
import {configure, getConsoleSink, getLogger} from "@logtape/logtape";
import {AsyncContext} from "@b9g/async-context";
import * as Platform from "@b9g/platform";
import {Watcher} from "../esbuild/watcher.js";

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
		const platformName = Platform.resolvePlatform(options);
		const workerCount = getWorkerCount(options);

		if (options.verbose) {
			Platform.displayPlatformInfo(platformName);
			logger.info("Worker configuration", {workerCount});
		}

		// Create platform with smart defaults
		const platformConfig = {
			hotReload: true,
			port: parseInt(options.port) || DEFAULTS.SERVER.PORT,
			host: options.host || DEFAULTS.SERVER.HOST,
		};

		const platformInstance = await Platform.createPlatform(
			platformName,
			platformConfig,
		);

		logger.info("Starting development server", {});
		logger.info("Workers", {workerCount});

		// Set up file watching and building for development
		let serviceWorker;

		const outDir = "dist";
		const watcher = new Watcher({
			entrypoint,
			outDir,
			onBuild: async (success, builtEntrypoint) => {
				if (success && serviceWorker) {
					logger.info("Reloading Workers", {entrypoint: builtEntrypoint});
					// The reloadWorkers method is on the platform instance, not the ServiceWorker runtime
					if (
						platformInstance &&
						typeof platformInstance.reloadWorkers === "function"
					) {
						await platformInstance.reloadWorkers(builtEntrypoint);
					}
					logger.info("Workers reloaded", {});
				}
			},
		});

		// Initial build and start watching
		const {success: buildSuccess, entrypoint: builtEntrypoint} =
			await watcher.start();
		if (!buildSuccess) {
			logger.error("Initial build failed, watching for changes to retry", {});
		}
		serviceWorker = await platformInstance.loadServiceWorker(builtEntrypoint, {
			hotReload: true,
			workerCount,
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

		// Graceful shutdown handler for both SIGINT (Ctrl+C) and SIGTERM (docker stop, systemd, k8s)
		const shutdown = async (signal: string) => {
			logger.info("Shutting down gracefully", {signal});
			await watcher.stop();
			await serviceWorker.dispose();
			await platformInstance.dispose();
			await server.close();
			logger.info("Shutdown complete", {});
			process.exit(0);
		};

		process.on("SIGINT", () => shutdown("SIGINT"));
		process.on("SIGTERM", () => shutdown("SIGTERM"));
	} catch (error) {
		logger.error("Failed to start development server:\n{stack}", {
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
