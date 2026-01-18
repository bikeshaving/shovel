import {DEFAULTS} from "../utils/config.js";
import {getLogger} from "@logtape/logtape";
import {resolvePlatform} from "@b9g/platform";
import type {ProcessedShovelConfig} from "../utils/config.js";
import {ServerBundler} from "../utils/bundler.js";
import {createPlatform} from "../utils/platform.js";
import pc from "picocolors";
import {networkInterfaces} from "os";

const logger = getLogger(["shovel", "develop"]);

/**
 * Server URLs for display.
 */
interface DisplayUrls {
	local: string;
	network?: string;
}

/**
 * Get display URLs for the server.
 * Returns localhost URLs for local access plus optional LAN URL.
 */
function getDisplayUrls(host: string, port: number): DisplayUrls {
	const urls: DisplayUrls = {
		local: `http://localhost:${port}`,
	};

	// If bound to all interfaces (0.0.0.0), show LAN access info
	if (host === "0.0.0.0") {
		// Get LAN address
		const lanAddress = getLanAddress();
		if (lanAddress) {
			urls.network = `http://${lanAddress}:${port}`;
		}
	} else if (host !== "localhost" && host !== "127.0.0.1") {
		// Specific host binding
		urls.network = `http://${host}:${port}`;
	}

	return urls;
}

/**
 * Get the machine's LAN IP address.
 */
function getLanAddress(): string | null {
	try {
		const nets = networkInterfaces();

		for (const name of Object.keys(nets)) {
			const interfaces = nets[name];
			if (!interfaces) continue;

			for (const net of interfaces) {
				// Skip internal (loopback) addresses
				// Only return IPv4 addresses for simplicity
				if (!net.internal && net.family === "IPv4") {
					return net.address;
				}
			}
		}
	} catch (err) {
		logger.debug("Failed to get LAN address: {error}", {error: err});
	}
	return null;
}

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

				// Display server URLs (formatted output, not logging)
				const urls = getDisplayUrls(host, port);
				/* eslint-disable no-console */
				console.log();
				console.log(pc.bold("  Server running:"));
				console.log();
				console.log(`  ${pc.dim("Local:".padEnd(10))} ${pc.cyan(urls.local)}`);
				if (urls.network) {
					console.log(
						`  ${pc.dim("Network:".padEnd(10))} ${pc.cyan(urls.network)}`,
					);
				}
				console.log();
				console.log(
					pc.dim(
						`  Tip: Use subdomains like ${pc.reset("app.localhost:" + port)} for routing`,
					),
				);
				console.log();
				/* eslint-enable no-console */
			} else {
				// Subsequent builds - hot reload workers
				await platformInstance.serviceWorker.reloadWorkers(workerPath);
			}
		};

		const outDir = "dist";
		const bundler = new ServerBundler({
			entrypoint,
			outDir,
			platform: platformInstance,
			platformESBuildConfig,
			userBuildConfig: config.build,
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
