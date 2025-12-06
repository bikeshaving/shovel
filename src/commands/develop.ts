import {DEFAULTS} from "../utils/config.js";
import {getLogger} from "@logtape/logtape";
import * as Platform from "@b9g/platform";
import type {ProcessedShovelConfig} from "../utils/config.js";
import {Watcher} from "../utils/watcher.js";

const logger = getLogger(["cli"]);

export async function developCommand(
	entrypoint: string,
	options: {
		port?: string;
		host?: string;
		workers?: string;
		verbose?: boolean;
		platform?: string;
	},
	config: ProcessedShovelConfig,
) {
	try {
		const platformName = Platform.resolvePlatform({...options, config});
		const workerCount = getWorkerCount(options, config);

		if (options.verbose) {
			logger.info("Platform: {platform}", {platform: platformName});
			logger.info("Worker count: {workerCount}", {workerCount});
		}

		// Create platform with server defaults
		const platformInstance = await Platform.createPlatform(platformName, {
			port: parseInt(options.port || String(DEFAULTS.SERVER.PORT), 10),
			host: options.host || DEFAULTS.SERVER.HOST,
		});
		const platformESBuildConfig = platformInstance.getESBuildConfig();

		logger.info("Starting development server");
		logger.info("Workers: {workerCount}", {workerCount});

		// Set up file watching and building for development
		let serviceWorker:
			| Awaited<ReturnType<typeof platformInstance.loadServiceWorker>>
			| undefined;

		const outDir = "dist";
		const watcher = new Watcher({
			entrypoint,
			outDir,
			platformESBuildConfig: platformESBuildConfig,
			onBuild: async (success, builtEntrypoint) => {
				if (success && serviceWorker) {
					logger.info("Reloading Workers with {entrypoint}", {
						entrypoint: builtEntrypoint,
					});
					// The reloadWorkers method is on the platform instance, not the ServiceWorker runtime
					if (
						platformInstance &&
						typeof platformInstance.reloadWorkers === "function"
					) {
						await platformInstance.reloadWorkers(builtEntrypoint);
					}
					logger.info("Workers reloaded");
				}
			},
		});

		// Initial build and start watching
		const {success: buildSuccess, entrypoint: builtEntrypoint} =
			await watcher.start();
		if (!buildSuccess) {
			logger.error("Initial build failed, watching for changes to retry");
		}
		serviceWorker = await platformInstance.loadServiceWorker(builtEntrypoint, {
			hotReload: true,
			workerCount,
		});

		// Create development server
		const server = platformInstance.createServer(serviceWorker.handleRequest, {
			port: parseInt(options.port || String(DEFAULTS.SERVER.PORT), 10),
			host: options.host || DEFAULTS.SERVER.HOST,
		});

		await server.listen();
		logger.info("Server running at {url}", {
			url: `http://${options.host}:${options.port}`,
		});
		logger.info("Serving {entrypoint}", {entrypoint});

		// Graceful shutdown handler for both SIGINT (Ctrl+C) and SIGTERM (docker stop, systemd, k8s)
		const shutdown = async (signal: string) => {
			logger.info("Shutting down gracefully ({signal})", {signal});
			await watcher.stop();
			await serviceWorker?.dispose();
			await platformInstance.dispose();
			await server.close();
			logger.info("Shutdown complete");
			process.exit(0);
		};

		process.on("SIGINT", () => shutdown("SIGINT"));
		process.on("SIGTERM", () => shutdown("SIGTERM"));
	} catch (error) {
		logger.error("Failed to start development server: {error}", {error});
		process.exit(1);
	}
}

function getWorkerCount(
	options: {workers?: string},
	config: {workers?: number} | null,
) {
	// CLI option overrides everything (explicit user intent)
	if (options.workers) {
		return parseInt(options.workers, 10);
	}
	// Config already handles: json value > WORKERS env > default
	return config?.workers ?? DEFAULTS.WORKERS;
}
