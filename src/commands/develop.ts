import {DEFAULTS} from "../utils/config.js";
import {getLogger} from "@logtape/logtape";
import {dirname, join} from "path";
import * as Platform from "@b9g/platform";
import type {ProcessedShovelConfig} from "../utils/config.js";
import {ServerBundler} from "../utils/bundler.js";

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
		const platformName = Platform.resolvePlatform({...options, config});
		const workerCount = getWorkerCount(options, config);
		const port = parseInt(options.port || String(DEFAULTS.SERVER.PORT), 10);
		const host = options.host || DEFAULTS.SERVER.HOST;

		logger.debug("Platform: {platform}", {platform: platformName});
		logger.debug("Worker count: {workerCount}", {workerCount});

		// Create platform with server defaults
		const platformInstance = await Platform.createPlatform(platformName, {
			port,
			host,
		});
		const platformESBuildConfig = platformInstance.getESBuildConfig();

		logger.info("Starting development server");

		// Track state for hot reload recovery
		let serviceWorker:
			| Awaited<ReturnType<typeof platformInstance.loadServiceWorker>>
			| undefined;
		let server: ReturnType<typeof platformInstance.createServer> | undefined;
		let serverStarted = false;

		// Helper to get worker entrypoint from build output
		const getWorkerPath = (builtEntrypoint: string) =>
			builtEntrypoint.endsWith("index.js")
				? join(dirname(builtEntrypoint), "worker.js")
				: builtEntrypoint;

		// Helper to start or reload the server
		const startOrReloadServer = async (workerPath: string) => {
			if (!serverStarted) {
				// First successful build - start the server
				serviceWorker = await platformInstance.loadServiceWorker(workerPath, {
					hotReload: true,
					workerCount,
				});

				server = platformInstance.createServer(serviceWorker.handleRequest, {
					port,
					host,
				});

				await server.listen();
				serverStarted = true;
				logger.info("Server running at http://{host}:{port}", {host, port});
			} else if (
				platformInstance &&
				typeof platformInstance.reloadWorkers === "function"
			) {
				// Subsequent builds - hot reload workers
				await platformInstance.reloadWorkers(workerPath);
				logger.info("Reloaded");
			}
		};

		const outDir = "dist";
		const bundler = new ServerBundler({
			entrypoint,
			outDir,
			platform: platformInstance,
			platformESBuildConfig,
			onBuild: async (success, builtEntrypoint) => {
				if (success && builtEntrypoint) {
					const workerPath = getWorkerPath(builtEntrypoint);
					await startOrReloadServer(workerPath);
				}
			},
		});

		// Initial build and start watching
		const {success: buildSuccess, entrypoint: builtEntrypoint} =
			await bundler.watch();

		if (buildSuccess && builtEntrypoint) {
			// Initial build succeeded - start server immediately
			const workerPath = getWorkerPath(builtEntrypoint);
			await startOrReloadServer(workerPath);
		} else {
			// Initial build failed - server will start on first successful rebuild
			logger.error("Initial build failed, watching for changes to retry");
		}

		// Graceful shutdown handler for both SIGINT (Ctrl+C) and SIGTERM (docker stop, systemd, k8s)
		const shutdown = async (signal: string) => {
			logger.debug("Shutting down ({signal})", {signal});
			await bundler.stop();
			await serviceWorker?.dispose();
			await platformInstance.dispose();
			await server?.close();
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
