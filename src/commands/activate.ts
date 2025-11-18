import {DEFAULTS} from "../esbuild/config.js";

export async function activateCommand(entrypoint, options) {
	try {
		const platform = await import("@b9g/platform");
		const platformName = platform.resolvePlatform(options);
		const workerCount = getWorkerCount(options);

		if (options.verbose) {
			platform.displayPlatformInfo(platformName);
			console.info(`[CLI] ✅ Worker configuration: ${workerCount} workers`);
		}

		const platformConfig = {
			hotReload: false,
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

		console.info(`[CLI] ▶️  Activating ServiceWorker...`);

		// Load ServiceWorker app
		const serviceWorker = await platformInstance.loadServiceWorker(entrypoint, {
			hotReload: false,
			workerCount,
		});

		// The ServiceWorker install/activate lifecycle will handle any self-generation
		// Apps can use self.dirs.open("static") in their activate event to pre-render
		console.info(
			`[CLI] ✅ ServiceWorker activated - check dist/ for generated content`,
		);

		await serviceWorker.dispose();
		await platformInstance.dispose();
	} catch (error) {
		console.error(`[CLI] ❌ ServiceWorker activation failed:`, error.message);
		if (options.verbose) {
			console.error(error.stack);
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
