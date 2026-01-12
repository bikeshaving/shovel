import {DEFAULTS} from "../utils/config.js";
import {getLogger} from "@logtape/logtape";
import * as Platform from "@b9g/platform";
import type {ProcessedShovelConfig} from "../utils/config.js";
import {ServerBundler} from "../utils/bundler.js";

const logger = getLogger(["shovel"]);

export async function activateCommand(
	entrypoint: string,
	options: {workers?: string; platform?: string},
	config: ProcessedShovelConfig,
) {
	try {
		const platformName = Platform.resolvePlatform({...options, config});
		const workerCount = getWorkerCount(options, config);

		logger.debug("Platform: {platform}", {platform: platformName});
		logger.debug("Worker count: {workerCount}", {workerCount});

		// Create platform first to get esbuild config
		const platformInstance = await Platform.createPlatform(platformName);
		const platformESBuildConfig = platformInstance.getESBuildConfig();

		// Build the entrypoint
		logger.debug("Building ServiceWorker for activation");
		const bundler = new ServerBundler({
			entrypoint,
			outDir: "dist",
			platform: platformInstance,
			platformESBuildConfig,
		});

		const {success, outputs} = await bundler.build();
		if (!success) {
			throw new Error("Build failed");
		}

		logger.debug("Activating ServiceWorker");

		// Load the worker (not the supervisor) for running lifecycle
		const serviceWorker = await platformInstance.loadServiceWorker(
			outputs.worker,
			{
				hotReload: false,
				workerCount,
			},
		);

		// The ServiceWorker install/activate lifecycle will handle any self-generation
		// Apps can use self.directories.open("public") in their activate event to pre-render
		logger.debug("ServiceWorker activated - check dist/ for generated content");

		await serviceWorker.dispose();
		await platformInstance.dispose();
	} catch (error) {
		logger.error("ServiceWorker activation failed: {error}", {error});
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
