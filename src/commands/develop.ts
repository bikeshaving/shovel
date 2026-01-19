import {DEFAULTS, parseOrigin, type ParsedOrigin} from "../utils/config.js";
import {getLogger} from "@logtape/logtape";
import {resolvePlatform, type TLSConfig} from "@b9g/platform";
import type {ProcessedShovelConfig} from "../utils/config.js";
import {ServerBundler} from "../utils/bundler.js";
import {createPlatform} from "../utils/platform.js";
import {networkInterfaces} from "os";
import {ensureCerts} from "../utils/certs.js";
import {getBindPort} from "../utils/privileges.js";
import {Router, RouterClient, isRouterRunningAsync} from "../utils/router.js";

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
function getDisplayUrls(
	host: string,
	port: number,
	origin?: ParsedOrigin,
): DisplayUrls {
	// If origin is specified, use that as the display URL
	if (origin) {
		return {
			local: origin.origin,
		};
	}

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
		origin?: string;
		port?: string;
		host?: string;
		workers?: string;
		platform?: string;
	},
	config: ProcessedShovelConfig,
) {
	let router: Router | undefined;
	let routerClient: RouterClient | undefined;

	try {
		const platformName = resolvePlatform({...options, config});
		const workerCount = getWorkerCount(options, config);

		// Resolve origin: CLI flag > config > build from port/host
		let origin: ParsedOrigin | undefined;
		if (options.origin) {
			origin = parseOrigin(options.origin);
		} else if (config.origin) {
			origin = config.origin;
		} else if (options.port) {
			// --port is shorthand for http://localhost:<port>
			origin = parseOrigin(`http://localhost:${options.port}`);
		}

		// Derive port and host from origin or use defaults
		let port = origin?.port ?? config.port ?? DEFAULTS.SERVER.PORT;
		const host = origin?.host ?? options.host ?? DEFAULTS.SERVER.HOST;
		const isHttps = origin?.protocol === "https";

		// For HTTPS origins, we need to:
		// 1. Ensure certificates are available
		// 2. Handle privileged port access (443)
		// 3. Potentially coordinate with router for multi-app support
		let tls: TLSConfig | undefined;

		if (isHttps && origin) {
			logger.info("Setting up HTTPS for {origin}", {origin: origin.origin});

			// Step 1: Ensure certificates
			// For router mode (port 443/80), use wildcard localhost cert to support multiple apps
			// Otherwise use the specific origin host
			const certHost =
				(port === 443 || port === 80) && origin.host.endsWith(".localhost")
					? "localhost"
					: origin.host;
			const certs = await ensureCerts(certHost);
			tls = {cert: certs.cert, key: certs.key};

			// Step 2: Handle privileged port (443)
			if (port === 443 || port === 80) {
				// Check if router is already running
				const routerRunning = await isRouterRunningAsync();

				if (routerRunning) {
					// Register with existing router
					// We'll use a random high port for our actual server
					// Note: We don't use TLS here - the router terminates TLS and proxies plain HTTP to us
					const actualPort = 10000 + Math.floor(Math.random() * 55000);
					logger.info(
						"Registering with existing router (local port: {actualPort})",
						{actualPort},
					);

					routerClient = new RouterClient({
						origin: origin.origin,
						host: "127.0.0.1",
						port: actualPort,
					});

					// Actual binding port is the random high port
					// Clear TLS - router handles TLS termination, we serve plain HTTP
					port = actualPort;
					tls = undefined;
				} else {
					// Become the router
					const actualBindPort = await getBindPort(port);

					if (actualBindPort !== port) {
						logger.info("Using port forwarding: {requested} → {actual}", {
							requested: port,
							actual: actualBindPort,
						});
						// We bind to the high port, but forwarding makes 443 work
						// Router will handle the forwarded traffic
					}

					router = new Router({
						port: actualBindPort,
						host: "127.0.0.1",
						tls,
					});
					await router.start();

					// Register ourselves with the router
					// Use a different port for the actual app server
					const appPort =
						actualBindPort === port ? port + 1000 : actualBindPort + 1;
					router.registerApp({
						origin: origin.origin,
						host: "127.0.0.1",
						port: appPort,
						socket: null as any, // Self-registration doesn't need socket
					});

					// Our server binds to appPort without TLS
					// Router handles TLS termination and proxies plain HTTP to us
					port = appPort;
					tls = undefined;
				}
			}
		}

		logger.info("Platform: {platform}, workers: {workerCount}", {
			platform: platformName,
			workerCount,
		});

		// Create platform with server and worker settings
		const platformInstance = await createPlatform(platformName, {
			port,
			host: isHttps ? "127.0.0.1" : host, // HTTPS always binds to localhost
			workers: workerCount,
			tls,
		});
		const platformESBuildConfig = platformInstance.getESBuildConfig();

		let serverStarted = false;

		// Helper to start or reload the server
		const startOrReloadServer = async (workerPath: string) => {
			if (!serverStarted) {
				// First successful build - register ServiceWorker and start server
				await platformInstance.serviceWorker.register(workerPath);
				await platformInstance.serviceWorker.ready;
				await platformInstance.listen();
				serverStarted = true;

				// Connect to router if we're a client
				if (routerClient) {
					await routerClient.connect();
				}

				// Display server URLs
				const urls = getDisplayUrls(host, port, origin);
				if (urls.network) {
					logger.info("Server running at {local} and {network}", {
						local: urls.local,
						network: urls.network,
					});
				} else {
					logger.info("Server running at {url}", {url: urls.local});
				}
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

			// Disconnect from router or stop our router
			if (routerClient) {
				await routerClient.disconnect();
			}
			if (router) {
				await router.stop();
			}

			await platformInstance.dispose();
			logger.debug("Shutdown complete");
			process.exit(0);
		};

		process.on("SIGINT", () => shutdown("SIGINT"));
		process.on("SIGTERM", () => shutdown("SIGTERM"));

		// Keep the process alive
		await new Promise(() => {});
	} catch (error) {
		// Clean up on error
		if (routerClient) {
			try {
				await routerClient.disconnect();
			} catch (cleanupError) {
				logger.debug("Router client cleanup error: {error}", {
					error: cleanupError,
				});
			}
		}
		if (router) {
			try {
				await router.stop();
			} catch (cleanupError) {
				logger.debug("Router cleanup error: {error}", {error: cleanupError});
			}
		}

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
