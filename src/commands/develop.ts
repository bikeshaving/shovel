import {DEFAULTS, parseOrigin, type ParsedOrigin} from "../utils/config.js";
import {getLogger} from "@logtape/logtape";
import {resolvePlatform, type TLSConfig} from "@b9g/platform";
import type {ProcessedShovelConfig} from "../utils/config.js";
import {ServerBundler} from "../utils/bundler.js";
import {createPlatform} from "../utils/platform.js";
import {networkInterfaces} from "os";
import {ensureCerts} from "../utils/certs.js";
import {
	VirtualHost,
	VirtualHostClient,
	isVirtualHostRunningAsync,
} from "../utils/virtualhost.js";

const logger = getLogger(["shovel", "develop"]);

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
	let virtualHost: VirtualHost | undefined;
	let virtualHostClient: VirtualHostClient | undefined;

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
			// --port is shorthand for http://<host>:<port>
			const portHost = options.host ?? "localhost";
			origin = parseOrigin(`http://${portHost}:${options.port}`);
		}

		// Derive port and host from origin or use defaults
		// Note: origin.host is the hostname for routing (e.g., shovel.localhost)
		// The bind host is the interface to listen on (default 0.0.0.0)
		let port = origin?.port ?? config.port ?? DEFAULTS.SERVER.PORT;
		const host = options.host ?? config.host ?? DEFAULTS.SERVER.HOST;
		const isHttps = origin?.protocol === "https";

		// Validate host when origin is specified
		// Origin-based routing only works with localhost bindings
		const localhostHosts = ["0.0.0.0", "127.0.0.1", "localhost", "::1", "::"];
		if (origin && !localhostHosts.includes(host)) {
			throw new Error(
				`Cannot use --origin with --host ${host}. ` +
					`Origin-based routing requires binding to localhost (0.0.0.0, 127.0.0.1, or localhost).`,
			);
		}

		// For HTTPS origins, we need to:
		// 1. Ensure certificates are available
		// 2. Handle privileged port access (443)
		// 3. Potentially coordinate with virtualHost for multi-app support
		let tls: TLSConfig | undefined;

		if (isHttps && origin) {
			logger.info("Setting up HTTPS for {origin}", {origin: origin.origin});

			// Step 1: Ensure certificates for the origin host
			const certs = await ensureCerts(origin.host);
			tls = {cert: certs.cert, key: certs.key};

			// Step 2: Handle privileged ports (any port < 1024)
			if (port < 1024) {
				// Check if virtualHost is already running
				const virtualHostRunning = await isVirtualHostRunningAsync();

				if (virtualHostRunning) {
					// Register with existing virtualHost
					// Use port 0 to let OS assign an available port
					// Note: We don't use TLS here - the virtualHost terminates TLS and proxies plain HTTP to us
					// Use 127.0.0.1 for registration - 0.0.0.0 is for binding, not proxying
					virtualHostClient = new VirtualHostClient({
						origin: origin.origin,
						host: "127.0.0.1",
						port: 0, // Will be updated after server starts
					});

					// Clear TLS - virtualHost handles TLS termination, we serve plain HTTP
					port = 0; // Let OS assign port, virtualHost will get actual port after listen
					tls = undefined;
				} else {
					// Become the virtualHost
					logger.debug("Starting virtualHost on {host}:{port}", {host, port});
					virtualHost = new VirtualHost({
						port,
						host,
						tls,
					});
					await virtualHost.start();

					// Register ourselves with the virtualHost
					// Use a different port for the actual app server
					// Use 127.0.0.1 for proxy target - 0.0.0.0 is for binding, not proxying
					const appPort = port + 1000;
					virtualHost.registerApp({
						origin: origin.origin,
						host: "127.0.0.1",
						port: appPort,
						socket: null as any, // Self-registration doesn't need socket
					});

					// Our server binds to appPort without TLS
					// VirtualHost handles TLS termination and proxies plain HTTP to us
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
			host,
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
				const server = await platformInstance.listen();
				serverStarted = true;

				// Connect to virtualHost if we're a client (pass actual port from server)
				if (virtualHostClient) {
					const actualPort = server.address().port;
					logger.info("Registering with virtualHost (local port: {port})", {
						port: actualPort,
					});
					await virtualHostClient.connect(actualPort);
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

			// Disconnect from virtualHost or stop our virtualHost
			if (virtualHostClient) {
				await virtualHostClient.disconnect();
			}
			if (virtualHost) {
				await virtualHost.stop();
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
		if (virtualHostClient) {
			try {
				await virtualHostClient.disconnect();
			} catch (cleanupError) {
				logger.debug("VirtualHost client cleanup error: {error}", {
					error: cleanupError,
				});
			}
		}
		if (virtualHost) {
			try {
				await virtualHost.stop();
			} catch (cleanupError) {
				logger.debug("VirtualHost cleanup error: {error}", {
					error: cleanupError,
				});
			}
		}

		logger.error("Failed to start development server: {error}", {error});
		process.exit(1);
	}
}
