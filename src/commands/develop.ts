import {DEFAULTS, parseOrigin, type ParsedOrigin} from "../utils/config.js";
import {getLogger} from "@logtape/logtape";
import {resolvePlatform, type TLSConfig} from "@b9g/platform";
import type {ProcessedShovelConfig} from "../utils/config.js";
import {ServerBundler} from "../utils/bundler.js";
import {createPlatform} from "../utils/platform.js";
import {networkInterfaces} from "os";
import {ensureCerts} from "../utils/certs.js";
import {
	establishVirtualHostRole,
	type VirtualHostRole,
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
	let virtualHostRole: VirtualHostRole | undefined;

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
		// 3. Potentially coordinate with VirtualHost for multi-app support
		let tls: TLSConfig | undefined;

		// Track the actual port our server is listening on (for re-registration after failover)
		let actualServerPort: number | undefined;

		// Save the original VirtualHost port (443) since `port` gets mutated
		// Allow overriding for testing via environment variable
		// eslint-disable-next-line no-restricted-properties
		const vhostPort = process.env.SHOVEL_TEST_VIRTUALHOST_PORT
			? // eslint-disable-next-line no-restricted-properties
				parseInt(process.env.SHOVEL_TEST_VIRTUALHOST_PORT, 10)
			: port;
		// eslint-disable-next-line no-restricted-properties
		const forceVirtualHost = !!process.env.SHOVEL_TEST_VIRTUALHOST_PORT;

		// Function to establish/re-establish VirtualHost role (used for initial setup and failover)
		const establishRole = async (): Promise<void> => {
			if (!isHttps || !origin || (vhostPort >= 1024 && !forceVirtualHost)) {
				return; // No VirtualHost needed for non-HTTPS or high ports (unless forced)
			}

			const certs = await ensureCerts(origin.host);
			const vhostTls = {cert: certs.cert, key: certs.key};

			virtualHostRole = await establishVirtualHostRole({
				origin: origin.origin,
				port: vhostPort,
				host,
				tls: vhostTls,
				onNeedRegistration: async (client) => {
					// This is called when we're a client and need to register
					// We need the actual server port, which may not be available yet on first run
					if (actualServerPort !== undefined) {
						await client.connect(actualServerPort);
					}
					// If actualServerPort is undefined, we'll register later in startOrReloadServer
				},
				onDisconnect: () => {
					// VirtualHost died, try to become the new leader
					logger.info(
						"VirtualHost connection lost, attempting to take over...",
					);
					establishRole().catch((err) => {
						logger.error("Failed to re-establish VirtualHost role: {error}", {
							error: err,
						});
					});
				},
			});

			if (virtualHostRole.role === "leader") {
				logger.debug("Became VirtualHost leader");
				// Register ourselves with our own VirtualHost
				// Use actualServerPort if available (succession case), otherwise vhostPort+1000 (initial startup)
				const appPort = actualServerPort ?? vhostPort + 1000;
				virtualHostRole.virtualHost.registerApp({
					origin: origin.origin,
					host: "127.0.0.1",
					port: appPort,
					socket: null as any, // Self-registration doesn't need socket
				});
				logger.info("Registered self as leader (app port: {port})", {
					port: appPort,
				});
			} else {
				logger.debug("Connected as VirtualHost client");
			}
		};

		// Setup for HTTPS with privileged ports (or forced VirtualHost for testing)
		if (isHttps && origin) {
			logger.info("Setting up HTTPS for {origin}", {origin: origin.origin});

			if (port < 1024 || forceVirtualHost) {
				await establishRole();

				// Adjust port and TLS based on our role
				if (virtualHostRole?.role === "leader") {
					// Leader: app runs on vhostPort+1000, VirtualHost handles TLS
					port = vhostPort + 1000;
					tls = undefined;
				} else if (virtualHostRole?.role === "client") {
					// Client: app runs on ephemeral port, VirtualHost handles TLS
					port = 0;
					tls = undefined;
				}
			} else {
				// High port HTTPS - no VirtualHost needed, just use TLS directly
				const certs = await ensureCerts(origin.host);
				tls = {cert: certs.cert, key: certs.key};
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

				// Store the actual port for potential re-registration after failover
				actualServerPort = server.address().port;

				// Connect to VirtualHost if we're a client (pass actual port from server)
				if (virtualHostRole?.role === "client") {
					logger.info("Registering with VirtualHost (local port: {port})", {
						port: actualServerPort,
					});
					await virtualHostRole.client.connect(actualServerPort);
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

			// Disconnect from VirtualHost or stop our VirtualHost
			if (virtualHostRole?.role === "client") {
				await virtualHostRole.client.disconnect();
			} else if (virtualHostRole?.role === "leader") {
				await virtualHostRole.virtualHost.stop();
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
		if (virtualHostRole?.role === "client") {
			try {
				await virtualHostRole.client.disconnect();
			} catch (cleanupError) {
				logger.debug("VirtualHost client cleanup error: {error}", {
					error: cleanupError,
				});
			}
		} else if (virtualHostRole?.role === "leader") {
			try {
				await virtualHostRole.virtualHost.stop();
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
