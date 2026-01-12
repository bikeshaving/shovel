import {resolve} from "path";
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

		// Spawn the worker directly - it runs lifecycle automatically and posts "ready"
		// The worker entry (from getProductionEntryPoints) already calls:
		// initWorkerRuntime -> import user code -> registration.install() -> registration.activate()
		if (!outputs.worker) {
			throw new Error("No worker entry point found in build outputs");
		}
		await spawnWorkerAndWaitForReady(platformName, resolve(outputs.worker));

		// The ServiceWorker install/activate lifecycle will have completed
		// Apps can use self.directories.open("public") in their activate event to pre-render
		logger.debug("ServiceWorker activated - check dist/ for generated content");

		await platformInstance.dispose();
	} catch (error) {
		logger.error("ServiceWorker activation failed: {error}", {error});
		process.exit(1);
	}
}

/**
 * Spawn a worker and wait for it to post "ready", then terminate it.
 * Works with both Node.js worker_threads and Bun's native Worker.
 */
async function spawnWorkerAndWaitForReady(
	platform: string,
	workerPath: string,
): Promise<void> {
	// Import Worker class based on platform
	const WorkerClass =
		platform === "bun" ? Worker : (await import("@b9g/node-webworker")).Worker;

	const worker = new WorkerClass(workerPath);

	try {
		await Promise.race([
			new Promise<void>((resolve, reject) => {
				worker.onmessage = (event: MessageEvent) => {
					if (event.data.type === "ready") {
						resolve();
					}
				};
				worker.onerror = (event: ErrorEvent | Event) => {
					reject(
						event instanceof ErrorEvent
							? event.error
							: new Error(String(event)),
					);
				};
			}),
			new Promise<never>((_, reject) =>
				setTimeout(
					() => reject(new Error("Worker activation timed out after 30s")),
					30000,
				),
			),
		]);
	} finally {
		worker.terminate();
	}
}
