import {DEFAULTS} from "../utils/config.js";
import {getLogger} from "@logtape/logtape";
import {resolvePlatform} from "@b9g/platform";
import type {ProcessedShovelConfig} from "../utils/config.js";
import {ServerBundler} from "../utils/bundler.js";
import {createPlatform} from "../utils/platform.js";

const logger = getLogger(["shovel"]);

export async function developCommand(
	entrypoint: string,
	options: {
		port?: string;
		host?: string;
		workers?: string;
		platform?: string;
	},
	config: ProcessedShovelConfig,
) {
	try {
		const platformName = resolvePlatform({...options, config});
		const workerCount = getWorkerCount(options, config);
		const port = parseInt(options.port || String(DEFAULTS.SERVER.PORT), 10);
		const host = options.host || DEFAULTS.SERVER.HOST;

		logger.debug("Platform: {platform}", {platform: platformName});
		logger.debug("Worker count: {workerCount}", {workerCount});

		// Create platform with server and worker settings
		const platformInstance = await createPlatform(platformName, {
			port,
			host,
			workers: workerCount,
		});
		const platformESBuildConfig = platformInstance.getESBuildConfig();

		logger.info("Starting development server");

		let serverStarted = false;

		// Helper to start or reload the server
		const startOrReloadServer = async (workerPath: string) => {
			if (!serverStarted) {
				// First successful build - register ServiceWorker and start server
				await platformInstance.serviceWorker.register(workerPath);
				await platformInstance.serviceWorker.ready;
				await platformInstance.listen();
				serverStarted = true;
				logger.info("Server running at http://{host}:{port}", {host, port});
			} else {
				// Subsequent builds - hot reload workers
				await platformInstance.serviceWorker.reloadWorkers(workerPath);
				logger.info("Reloaded");
			}
		};

		const outDir = "dist";
		const bundler = new ServerBundler({
			entrypoint,
			outDir,
			platform: platformInstance,
			platformESBuildConfig,
			development: true,
		});

		// Initial build and start watching
		const {success: buildSuccess, outputs} = await bundler.watch({
			onRebuild: async (result) => {
				if (result.success && result.outputs.worker) {
					await startOrReloadServer(result.outputs.worker);
				}
			},
		});

		if (buildSuccess && outputs.worker) {
			// Initial build succeeded - start server immediately
			await startOrReloadServer(outputs.worker);
		} else {
			// Initial build failed - server will start on first successful rebuild
			logger.error("Initial build failed, watching for changes to retry");
		}

		// Graceful shutdown handler for both SIGINT (Ctrl+C) and SIGTERM (docker stop, systemd, k8s)
		const shutdown = async (signal: string) => {
			logger.debug("Shutting down ({signal})", {signal});
			await bundler.stop();
			await platformInstance.dispose();
			logger.debug("Shutdown complete");
			process.exit(0);
		};

		process.on("SIGINT", () => shutdown("SIGINT"));
		process.on("SIGTERM", () => shutdown("SIGTERM"));

		// Keep the process alive
		await new Promise(() => {});
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
