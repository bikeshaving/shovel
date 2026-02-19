import {DEFAULTS} from "../utils/config.js";
import {getLogger} from "@logtape/logtape";
import {resolvePlatform} from "@b9g/platform";
import type {ProcessedShovelConfig} from "../utils/config.js";
import {ServerBundler} from "../utils/bundler.js";
import {loadPlatformModule} from "../utils/platform.js";
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

		logger.info("Platform: {platform}, workers: {workerCount}", {
			platform: platformName,
			workerCount,
		});

		// Load platform module (functions, not class)
		const platformModule = await loadPlatformModule(platformName);
		const platformESBuildConfig = platformModule.getESBuildConfig();

		// Track dev server instance
		let devServer: Awaited<
			ReturnType<typeof platformModule.createDevServer>
		> | null = null;

		const SHORTCUTS_HELP =
			"Shortcuts: Ctrl+R (reload) · Ctrl+L (clear) · Ctrl+C (quit) · ? (help)";

		// Helper to start or reload the server
		const startOrReloadServer = async (workerPath: string) => {
			if (!devServer) {
				// First successful build - create dev server
				devServer = await platformModule.createDevServer({
					port,
					host,
					workerPath,
					workers: workerCount,
				});

				// Display server URLs
				const urls = getDisplayUrls(host, port);
				if (urls.network) {
					logger.info("Server running at {local} and {network}", {
						local: urls.local,
						network: urls.network,
					});
				} else {
					logger.info("Server running at {url}", {url: urls.local});
				}

				if (process.stdin.isTTY) {
					logger.info(SHORTCUTS_HELP);
				}
			} else {
				// Subsequent builds - hot reload workers
				await devServer.reload(workerPath);
			}
		};

		const outDir = "dist";
		const bundler = new ServerBundler({
			entrypoint,
			outDir,
			platformModule,
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
			if (devServer) {
				await devServer.close();
			}
			logger.debug("Shutdown complete");
			process.exit(0);
		};

		process.on("SIGINT", () => shutdown("SIGINT"));
		process.on("SIGTERM", () => shutdown("SIGTERM"));

		// Keyboard shortcuts when running interactively
		if (process.stdin.isTTY) {
			process.stdin.setRawMode(true);
			process.stdin.resume();
			process.stdin.setEncoding("utf8");

			process.stdin.on("data", async (key: string) => {
				switch (key) {
					case "\x12": // Ctrl+R
						logger.info("Manual reload...");
						await bundler.rebuild();
						break;
					case "\x0C": // Ctrl+L
						// eslint-disable-next-line no-console
						console.clear();
						break;
					case "\x03": // Ctrl+C
						await shutdown("SIGINT");
						break;
					case "?":
						logger.info(SHORTCUTS_HELP);
						break;
					default:
						process.stdout.write(key);
						break;
				}
			});
		}

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
