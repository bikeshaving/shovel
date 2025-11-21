import {DEFAULTS} from "../esbuild/config.js";
import {getLogger} from "@logtape/logtape";

const logger = getLogger(["cli"]);

export async function activateCommand(entrypoint, options) {
	try {
		const platform = await import("@b9g/platform");
		const platformName = platform.resolvePlatform(options);
		const workerCount = getWorkerCount(options);

		if (options.verbose) {
			platform.displayPlatformInfo(platformName);
			logger.info("Worker configuration", {workerCount});
		}

		const platformConfig = {
			hotReload: false,
		};

		const platformInstance = await platform.createPlatform(
			platformName,
			platformConfig,
		);

		logger.info("Activating ServiceWorker", {});

		// Load ServiceWorker app
		const serviceWorker = await platformInstance.loadServiceWorker(entrypoint, {
			hotReload: false,
			workerCount,
		});

		// The ServiceWorker install/activate lifecycle will handle any self-generation
		// Apps can use self.dirs.open("static") in their activate event to pre-render
		logger.info(
			"ServiceWorker activated - check dist/ for generated content",
			{},
		);

		await serviceWorker.dispose();
		await platformInstance.dispose();
	} catch (error) {
		logger.error("ServiceWorker activation failed", {error: error.message});
		if (options.verbose) {
			logger.error("Stack trace", {stack: error.stack});
		}
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
