/**
 * VirtualHost coordination for multi-app local HTTPS development
 *
 * When running multiple `shovel develop` instances with different origins
 * (e.g., myapp.localhost, blog.localhost), they need to share port 443.
 *
 * Architecture:
 * - First app becomes the "virtual host" and owns port 443/80
 * - Additional apps register with the virtual host via IPC (Unix socket)
 * - VirtualHost proxies requests by Host header to the correct app
 * - When virtual host exits, another app can take over
 */

import {
	createServer as createNetServer,
	Socket,
	Server as NetServer,
} from "net";
import {
	createServer as createHttpServer,
	IncomingMessage,
	ServerResponse,
} from "http";
import {createServer as createHttpsServer} from "https";
import {createSecureContext, type SecureContext} from "tls";
import {existsSync, unlinkSync, mkdirSync} from "fs";
import {getLogger} from "@logtape/logtape";
import {SHOVEL_DIR, getVirtualHostSocketPath} from "./paths.js";
import type {TLSConfig} from "@b9g/platform";

const logger = getLogger(["shovel", "virtualhost"]);

/**
 * Parse a Host header to extract the hostname.
 * Uses URL API to handle IPv4, IPv6, and port parsing correctly.
 * Returns lowercase hostname since DNS is case-insensitive.
 * Examples:
 *   "localhost:8080" → "localhost"
 *   "Example.COM" → "example.com"
 *   "[::1]:8080" → "[::1]"
 *   "[::1]" → "[::1]"
 */
function parseHostHeader(host: string): string {
	try {
		// URL API handles IPv6 brackets, ports, and normalization
		const url = new URL(`http://${host}`);
		return url.hostname.toLowerCase();
	} catch (err) {
		// Fallback for malformed hosts (URL parsing can fail with unusual input)
		logger.debug("Could not parse host header: {host} - {error}", {
			host,
			error: err,
		});
		return host.toLowerCase();
	}
}

/**
 * Wrap IPv6 addresses in brackets for use in URLs.
 * IPv4 and hostnames are returned unchanged.
 */
function wrapIPv6(host: string): string {
	// Already has brackets or is not IPv6
	if (host.startsWith("[") || !host.includes(":")) {
		return host;
	}
	return `[${host}]`;
}

/**
 * Message types for IPC communication
 */
interface IPCMessage {
	type: string;
	[key: string]: unknown;
}

interface RegisterMessage extends IPCMessage {
	type: "register";
	/** Origin this app handles (e.g., "https://myapp.localhost") */
	origin: string;
	/** Port where this app is actually listening */
	port: number;
	/** Host where this app is listening */
	host: string;
	/** TLS certificate (PEM) for this origin */
	cert?: string;
	/** TLS private key (PEM) for this origin */
	key?: string;
}

interface UnregisterMessage extends IPCMessage {
	type: "unregister";
	origin: string;
}

interface AckMessage extends IPCMessage {
	type: "ack";
	success: boolean;
	error?: string;
}

/**
 * Registered app information
 */
interface RegisteredApp {
	origin: string;
	host: string;
	port: number;
	/** Socket connection to the client (null for self-registration by leader) */
	socket: Socket | null;
	/** TLS certificate (PEM) for this origin */
	cert?: string;
	/** TLS private key (PEM) for this origin */
	key?: string;
}

/**
 * VirtualHost class - manages multiple apps on a single port
 */
export class VirtualHost {
	#apps: Map<string, RegisteredApp>;
	#secureContexts: Map<string, SecureContext>;
	#ipcServer?: NetServer;
	#httpServer?: ReturnType<typeof createHttpServer>;
	#httpsServer?: ReturnType<typeof createHttpsServer>;
	#httpRedirectServer?: ReturnType<typeof createHttpServer>;
	#tls?: TLSConfig;
	#port: number;
	#host: string;

	constructor(options: {port: number; host: string; tls?: TLSConfig}) {
		this.#apps = new Map();
		this.#secureContexts = new Map();
		this.#port = options.port;
		this.#host = options.host;
		this.#tls = options.tls;
	}

	/**
	 * Start the virtualhost
	 *
	 * This creates:
	 * 1. An IPC server for app registration
	 * 2. An HTTP/HTTPS server for proxying requests
	 */
	async start(): Promise<void> {
		// Ensure shovel directory exists
		if (!existsSync(SHOVEL_DIR)) {
			mkdirSync(SHOVEL_DIR, {recursive: true});
		}

		// Start HTTP/HTTPS server first - this is the real "lock"
		// If port is in use, this will throw EADDRINUSE
		await this.#startProxyServer();

		// Port bound successfully, we're the leader. Start IPC server.
		// Any existing socket file is stale (since we own the port now)
		await this.#startIPCServer();

		// Start HTTP→HTTPS redirect server if TLS is enabled
		if (this.#tls) {
			await this.#startHttpRedirectServer();
		}

		logger.info("VirtualHost started on port {port}", {port: this.#port});
	}

	/**
	 * Stop the virtualhost and clean up
	 */
	async stop(): Promise<void> {
		// Close all app connections (skip self-registered apps with null socket)
		for (const app of this.#apps.values()) {
			app.socket?.destroy();
		}
		this.#apps.clear();
		this.#secureContexts.clear();

		// Close servers
		await Promise.all([
			new Promise<void>((resolve) => {
				this.#ipcServer?.close(() => resolve());
				if (!this.#ipcServer) resolve();
			}),
			new Promise<void>((resolve) => {
				this.#httpServer?.close(() => resolve());
				if (!this.#httpServer) resolve();
			}),
			new Promise<void>((resolve) => {
				this.#httpsServer?.close(() => resolve());
				if (!this.#httpsServer) resolve();
			}),
			new Promise<void>((resolve) => {
				this.#httpRedirectServer?.close(() => resolve());
				if (!this.#httpRedirectServer) resolve();
			}),
		]);

		// Clean up socket file
		const socketPath = getVirtualHostSocketPath(this.#port);
		if (existsSync(socketPath)) {
			try {
				unlinkSync(socketPath);
			} catch (error) {
				logger.debug("Could not remove socket on stop: {error}", {error});
			}
		}

		logger.info("VirtualHost stopped");
	}

	/**
	 * Register a local app
	 */
	registerApp(app: RegisteredApp): void {
		const hostname = new URL(app.origin).hostname;
		this.#apps.set(hostname, app);

		// Create secure context for SNI if cert provided
		if (app.cert && app.key) {
			const ctx = createSecureContext({cert: app.cert, key: app.key});
			this.#secureContexts.set(hostname, ctx);
			logger.debug("Secure context created for {hostname}", {hostname});
		}

		logger.info("App registered: {origin} → {host}:{port}", {
			origin: app.origin,
			host: app.host,
			port: app.port,
		});
	}

	/**
	 * Unregister an app
	 */
	unregisterApp(origin: string): void {
		const hostname = new URL(origin).hostname;
		this.#apps.delete(hostname);
		this.#secureContexts.delete(hostname);
		logger.info("App unregistered: {origin}", {origin});
	}

	/**
	 * Get the app for a given hostname
	 */
	getApp(hostname: string): RegisteredApp | undefined {
		return this.#apps.get(hostname);
	}

	/**
	 * Check if any apps are registered
	 */
	hasApps(): boolean {
		return this.#apps.size > 0;
	}

	/**
	 * Start IPC server for app registration
	 */
	async #startIPCServer(): Promise<void> {
		const socketPath = getVirtualHostSocketPath(this.#port);

		// Remove any stale socket file. This is safe because we already own the port,
		// so any existing socket must be from a crashed process.
		if (existsSync(socketPath)) {
			unlinkSync(socketPath);
		}

		return new Promise((resolve, reject) => {
			this.#ipcServer = createNetServer((socket) => {
				let buffer = "";

				socket.on("data", (data) => {
					buffer += data.toString();

					// Try to parse complete messages (newline-delimited JSON)
					const lines = buffer.split("\n");
					buffer = lines.pop() || ""; // Keep incomplete line

					for (const line of lines) {
						if (!line.trim()) continue;
						try {
							const message = JSON.parse(line) as IPCMessage;
							this.#handleIPCMessage(socket, message);
						} catch (error) {
							logger.error("Invalid IPC message: {error}", {error});
						}
					}
				});

				socket.on("close", () => {
					// Find and unregister the app that disconnected
					for (const [hostname, app] of this.#apps.entries()) {
						if (app.socket === socket) {
							this.#apps.delete(hostname);
							this.#secureContexts.delete(hostname);
							logger.info("App disconnected: {hostname}", {hostname});
							break;
						}
					}
				});

				socket.on("error", (error) => {
					logger.error("IPC socket error: {error}", {error});
				});
			});

			this.#ipcServer.on("error", (error: NodeJS.ErrnoException) => {
				reject(error);
			});

			this.#ipcServer.listen(socketPath, () => {
				logger.debug("IPC server listening on {path}", {path: socketPath});
				resolve();
			});
		});
	}

	/**
	 * Handle IPC messages from apps
	 */
	#handleIPCMessage(socket: Socket, message: IPCMessage): void {
		switch (message.type) {
			case "register": {
				const msg = message as RegisterMessage;
				this.registerApp({
					origin: msg.origin,
					host: msg.host,
					port: msg.port,
					socket,
					cert: msg.cert,
					key: msg.key,
				});
				this.#sendAck(socket, true);
				break;
			}
			case "unregister": {
				const msg = message as UnregisterMessage;
				this.unregisterApp(msg.origin);
				this.#sendAck(socket, true);
				break;
			}
			default:
				logger.warn("Unknown IPC message type: {type}", {type: message.type});
				this.#sendAck(socket, false, "Unknown message type");
		}
	}

	/**
	 * Send acknowledgment to app
	 */
	#sendAck(socket: Socket, success: boolean, error?: string): void {
		const ack: AckMessage = {type: "ack", success, error};
		socket.write(JSON.stringify(ack) + "\n");
	}

	/**
	 * Start the HTTP/HTTPS proxy server
	 */
	async #startProxyServer(): Promise<void> {
		const handler = (req: IncomingMessage, res: ServerResponse) => {
			this.#handleProxyRequest(req, res);
		};

		// Create appropriate server based on TLS config
		if (this.#tls) {
			// SNI callback to serve different certs per hostname
			const SNICallback = (
				servername: string,
				cb: (err: Error | null, ctx?: SecureContext) => void,
			) => {
				const hostname = servername.toLowerCase();
				const ctx = this.#secureContexts.get(hostname);
				if (ctx) {
					cb(null, ctx);
				} else {
					// Fall back to default cert
					cb(null);
				}
			};

			this.#httpsServer = createHttpsServer(
				{
					cert: this.#tls.cert,
					key: this.#tls.key,
					SNICallback,
				},
				handler,
			);
		} else {
			this.#httpServer = createHttpServer(handler);
		}

		const server = this.#httpsServer || this.#httpServer;

		return new Promise((resolve, reject) => {
			server!.on("error", (error: NodeJS.ErrnoException) => {
				logger.error(
					"Server bind error: {code} {message} (host={host}, port={port})",
					{
						code: error.code,
						message: error.message,
						host: this.#host,
						port: this.#port,
					},
				);
				if (error.code === "EADDRINUSE") {
					reject(new Error(`Port ${this.#port} already in use`));
				} else if (error.code === "EACCES") {
					reject(
						new Error(
							`Permission denied to bind to port ${this.#port}. ` +
								"Privileged port setup may be required.",
						),
					);
				} else {
					reject(error);
				}
			});

			server!.listen(this.#port, this.#host, () => {
				logger.debug("Proxy server listening on {host}:{port}", {
					host: this.#host,
					port: this.#port,
				});
				resolve();
			});
		});
	}

	/**
	 * Start the HTTP→HTTPS redirect server on port 80
	 */
	async #startHttpRedirectServer(): Promise<void> {
		return new Promise((resolve, reject) => {
			this.#httpRedirectServer = createHttpServer((req, res) => {
				const host = req.headers.host;
				if (!host) {
					res.writeHead(400, {"Content-Type": "text/plain"});
					res.end("Bad Request: Missing Host header");
					return;
				}

				// Redirect to HTTPS - strip any port from Host header (e.g., :80)
				// Wrap IPv6 addresses in brackets for valid URL construction
				const hostname = wrapIPv6(parseHostHeader(host));
				const redirectUrl = new URL(req.url || "/", `https://${hostname}`);
				// Use VirtualHost's HTTPS port if not standard 443
				if (this.#port !== 443) {
					redirectUrl.port = String(this.#port);
				}

				logger.debug("Redirecting HTTP → HTTPS: {url}", {
					url: redirectUrl.href,
				});
				res.writeHead(301, {Location: redirectUrl.href});
				res.end();
			});

			this.#httpRedirectServer.on("error", (error: NodeJS.ErrnoException) => {
				if (error.code === "EADDRINUSE") {
					// Port 80 already in use - not critical, just log and continue
					logger.debug("Port 80 already in use, HTTP redirect not available");
					resolve();
				} else if (error.code === "EACCES") {
					// Permission denied - not critical for redirect server
					logger.debug(
						"Permission denied for port 80, HTTP redirect not available",
					);
					resolve();
				} else {
					reject(error);
				}
			});

			this.#httpRedirectServer.listen(80, this.#host, () => {
				logger.debug("HTTP redirect server listening on {host}:80", {
					host: this.#host,
				});
				resolve();
			});
		});
	}

	/**
	 * Handle an incoming proxy request
	 */
	#handleProxyRequest(req: IncomingMessage, res: ServerResponse): void {
		const host = req.headers.host;
		if (!host) {
			logger.error("{method} {url} 400 (missing Host header)", {
				method: req.method,
				url: req.url,
			});
			res.writeHead(400, {"Content-Type": "text/plain"});
			res.end("Bad Request: Missing Host header");
			return;
		}

		// Extract hostname (without port)
		const hostname = parseHostHeader(host);

		// Find the app for this hostname
		const app = this.getApp(hostname);
		if (!app) {
			logger.debug("{method} {host}{url} 502 (no app registered)", {
				method: req.method,
				host,
				url: req.url,
			});
			res.writeHead(502, {"Content-Type": "text/plain"});
			res.end(`No app registered for ${hostname}`);
			return;
		}

		// Proxy the request to the app
		this.#proxyRequest(req, res, app);
	}

	/**
	 * Proxy a request to a registered app
	 */
	#proxyRequest(
		req: IncomingMessage,
		res: ServerResponse,
		app: RegisteredApp,
	): void {
		const url = new URL(
			req.url || "/",
			`http://${wrapIPv6(app.host)}:${app.port}`,
		);

		// Use dynamic import to avoid issues with ESM/CJS
		import("http").then(({request: httpRequest}) => {
			const proxyReq = httpRequest(
				{
					hostname: app.host,
					port: app.port,
					path: url.pathname + url.search,
					method: req.method,
					headers: {
						...req.headers,
						// Preserve original host and protocol for downstream apps
						"X-Forwarded-Host": req.headers.host,
						"X-Forwarded-Proto": this.#tls ? "https" : "http",
					},
				},
				(proxyRes) => {
					res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
					proxyRes.pipe(res);
				},
			);

			proxyReq.on("error", (error) => {
				logger.error("Proxy error: {error}", {error});
				if (!res.headersSent) {
					res.writeHead(502, {"Content-Type": "text/plain"});
				}
				res.end(`Proxy Error: ${error.message}`);
			});

			// Pipe request body
			req.pipe(proxyReq);
		});
	}
}

/**
 * VirtualHost client - connects to an existing virtualhost
 */
export class VirtualHostClient {
	#socket?: Socket;
	#origin: string;
	#host: string;
	#port: number;
	#vhostPort: number;
	#actualPort?: number;
	#cert?: string;
	#key?: string;
	#onDisconnect?: () => void;
	#intentionalDisconnect: boolean;

	constructor(options: {
		origin: string;
		host: string;
		port: number;
		/** The VirtualHost port (for socket path) */
		vhostPort: number;
		cert?: string;
		key?: string;
		onDisconnect?: () => void;
	}) {
		this.#origin = options.origin;
		this.#host = options.host;
		this.#port = options.port;
		this.#vhostPort = options.vhostPort;
		this.#cert = options.cert;
		this.#key = options.key;
		this.#onDisconnect = options.onDisconnect;
		this.#intentionalDisconnect = false;
	}

	/**
	 * Connect to the virtualhost and register this app
	 * @param actualPort - The actual port the server is listening on (overrides constructor port)
	 */
	async connect(actualPort?: number): Promise<void> {
		const port = actualPort ?? this.#port;
		this.#actualPort = port;
		return new Promise((resolve, reject) => {
			this.#socket = new Socket();

			this.#socket.on("connect", () => {
				// Send registration message
				const message: RegisterMessage = {
					type: "register",
					origin: this.#origin,
					host: this.#host,
					port,
					cert: this.#cert,
					key: this.#key,
				};
				this.#socket!.write(JSON.stringify(message) + "\n");
			});

			let buffer = "";
			let registered = false;
			this.#socket.on("data", (data) => {
				buffer += data.toString();

				// Process complete newline-delimited messages
				const lines = buffer.split("\n");
				buffer = lines.pop() || ""; // Keep incomplete line in buffer

				for (const line of lines) {
					if (!line.trim()) continue;
					try {
						const message = JSON.parse(line) as AckMessage;
						if (message.type === "ack") {
							if (message.success) {
								logger.info("Registered with virtualhost: {origin}", {
									origin: this.#origin,
								});
								registered = true;
								resolve();
							} else {
								reject(new Error(message.error || "Registration failed"));
							}
						}
					} catch (error) {
						logger.error("Invalid virtualhost response: {error}", {error});
					}
				}
			});

			this.#socket.on("close", () => {
				// Only trigger onDisconnect if we were successfully registered
				// and this wasn't an intentional disconnect (e.g., during shutdown)
				if (registered && this.#onDisconnect && !this.#intentionalDisconnect) {
					logger.info("VirtualHost connection lost, triggering reconnect");
					this.#onDisconnect();
				}
			});

			this.#socket.on("error", (error: NodeJS.ErrnoException) => {
				if (error.code === "ENOENT" || error.code === "ECONNREFUSED") {
					reject(new Error("VirtualHost not available"));
				} else {
					reject(error);
				}
			});

			this.#socket.connect(getVirtualHostSocketPath(this.#vhostPort));
		});
	}

	/**
	 * Get the actual port this client registered with
	 */
	get actualPort(): number | undefined {
		return this.#actualPort;
	}

	/**
	 * Disconnect from the virtualhost
	 */
	async disconnect(): Promise<void> {
		if (this.#socket) {
			// Mark as intentional so onDisconnect doesn't fire
			this.#intentionalDisconnect = true;
			// Send unregister message
			const message: UnregisterMessage = {
				type: "unregister",
				origin: this.#origin,
			};
			this.#socket.write(JSON.stringify(message) + "\n");
			this.#socket.destroy();
			this.#socket = undefined;
		}
	}
}

/**
 * Result of attempting to establish a VirtualHost role
 */
export type VirtualHostRole =
	| {role: "leader"; virtualHost: VirtualHost}
	| {role: "client"; client: VirtualHostClient};

/**
 * Options for establishing a VirtualHost role
 */
export interface EstablishVirtualHostOptions {
	origin: string;
	port: number;
	host: string;
	tls?: TLSConfig;
	/** Called when client needs to register with the leader after server starts */
	onNeedRegistration: (client: VirtualHostClient) => Promise<void>;
	/** Called when a client loses connection to the leader */
	onDisconnect: () => void;
}

/**
 * Attempt to become the VirtualHost leader or connect as a client.
 * Uses the port as a natural lock - only one process can bind to it.
 *
 * @param options - Configuration for the VirtualHost
 * @param maxAttempts - Maximum number of attempts before giving up
 * @returns The role this process took (leader or client)
 */
export async function establishVirtualHostRole(
	options: EstablishVirtualHostOptions,
	maxAttempts = 5,
): Promise<VirtualHostRole> {
	const {origin, port, host, tls, onNeedRegistration, onDisconnect} = options;

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		// Try to become the leader by binding the port
		try {
			const virtualHost = new VirtualHost({port, host, tls});
			await virtualHost.start();
			return {role: "leader", virtualHost};
		} catch (err) {
			const error = err as NodeJS.ErrnoException;
			if (
				error.message?.includes("already in use") ||
				error.code === "EADDRINUSE"
			) {
				// Port is in use, try to connect as a client
				// Normalize bind host to loopback for local proxying
				// 0.0.0.0 → 127.0.0.1, :: → ::1, others stay as-is
				const proxyHost =
					host === "0.0.0.0" ? "127.0.0.1" : host === "::" ? "::1" : host;
				try {
					const client = new VirtualHostClient({
						origin,
						host: proxyHost,
						port: 0, // Will be set when registering
						vhostPort: port,
						cert: tls?.cert,
						key: tls?.key,
						onDisconnect,
					});
					await onNeedRegistration(client);
					return {role: "client", client};
				} catch (clientErr) {
					// Client connection failed, maybe leader died. Retry with backoff.
					logger.debug("Failed to connect as client: {error}", {
						error: clientErr,
					});
					const backoff = Math.min(
						100 * Math.pow(1.5, attempt) + Math.random() * 100,
						1000,
					);
					logger.debug("Retrying in {ms}ms", {ms: Math.round(backoff)});
					await new Promise((resolve) => setTimeout(resolve, backoff));
					continue;
				}
			}
			throw err; // Other error, propagate
		}
	}

	throw new Error(
		`Failed to establish VirtualHost connection after ${maxAttempts} attempts`,
	);
}
