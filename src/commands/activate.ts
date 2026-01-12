import {getLogger} from "@logtape/logtape";
import * as Platform from "@b9g/platform";
import type {ProcessedShovelConfig} from "../utils/config.js";
import {ServerBundler} from "../utils/bundler.js";

const logger = getLogger(["shovel"]);

export async function activateCommand(
	entrypoint: string,
	options: {platform?: string},
	config: ProcessedShovelConfig,
) {
	try {
		const platformName = Platform.resolvePlatform({...options, config});

		logger.debug("Platform: {platform}", {platform: platformName});

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

		// The worker entry (from getProductionEntryPoints) runs lifecycle on load:
		// initWorkerRuntime -> import user code -> registration.install() -> registration.activate()
		if (!outputs.worker) {
			throw new Error("No worker entry point found in build outputs");
		}

		// Load the worker via the platform (Node/Bun use ServiceWorkerPool, Cloudflare uses Miniflare)
		// Lifecycle runs at module load time - when ready, it's done
		const serviceWorker = await platformInstance.loadServiceWorker(
			outputs.worker,
		);
		await serviceWorker.dispose();

		// The ServiceWorker install/activate lifecycle will have completed
		// Apps can use self.directories.open("public") in their activate event to pre-render
		logger.debug("ServiceWorker activated - check dist/ for generated content");

		await platformInstance.dispose();
	} catch (error) {
		logger.error("ServiceWorker activation failed: {error}", {error});
		process.exit(1);
	}
}
