import {DEFAULTS} from "../esbuild/config.js";
import {getLogger} from "@logtape/logtape";
import * as Platform from "@b9g/platform";

const logger = getLogger(["cli"]);

export async function activateCommand(entrypoint, options) {
	try {
		const platformName = Platform.resolvePlatform(options);
		const workerCount = getWorkerCount(options);

		if (options.verbose) {
			Platform.displayPlatformInfo(platformName);
			logger.info("Worker configuration", {workerCount});
		}

		const platformConfig = {
			hotReload: false,
		};

		const platformInstance = await Platform.createPlatform(
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
		logger.error("ServiceWorker activation failed: {error}", {error});
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
