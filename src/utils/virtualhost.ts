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
import {existsSync, unlinkSync, mkdirSync} from "fs";
import {getLogger} from "@logtape/logtape";
import {SHOVEL_DIR, VIRTUALHOST_SOCKET_PATH} from "./paths.js";
import type {TLSConfig} from "@b9g/platform";

const logger = getLogger(["shovel", "virtualhost"]);

/**
 * Normalize a hostname by stripping IPv6 brackets.
 * Examples:
 *   "[::1]" → "::1"
 *   "localhost" → "localhost"
 *   "::1" → "::1"
 */
function normalizeHostname(hostname: string): string {
	if (hostname.startsWith("[") && hostname.endsWith("]")) {
		return hostname.slice(1, -1);
	}
	return hostname;
}

/**
 * Format a host for use in URLs. IPv6 addresses need brackets.
 * Examples:
 *   "::1" → "[::1]"
 *   "localhost" → "localhost"
 *   "127.0.0.1" → "127.0.0.1"
 */
function formatHostForUrl(host: string): string {
	// If it contains a colon and doesn't already have brackets, it's IPv6
	if (host.includes(":") && !host.startsWith("[")) {
		return `[${host}]`;
	}
	return host;
}

/**
 * Parse a Host header to extract the hostname, handling IPv6 addresses.
 * Examples:
 *   "localhost:8080" → "localhost"
 *   "example.com" → "example.com"
 *   "[::1]:8080" → "::1"
 *   "[::1]" → "::1"
 */
function parseHostHeader(host: string): string {
	// IPv6 addresses are wrapped in brackets: [::1] or [::1]:port
	if (host.startsWith("[")) {
		const closeBracket = host.indexOf("]");
		if (closeBracket !== -1) {
			return host.slice(1, closeBracket);
		}
	}
	// IPv4 or hostname: split on first colon for port
	const colonIndex = host.indexOf(":");
	return colonIndex !== -1 ? host.slice(0, colonIndex) : host;
}

// Re-export for backwards compatibility
export {VIRTUALHOST_SOCKET_PATH};

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
	socket: Socket;
}

/**
 * VirtualHost class - manages multiple apps on a single port
 */
export class VirtualHost {
	#apps: Map<string, RegisteredApp>;
	#ipcServer?: NetServer;
	#httpServer?: ReturnType<typeof createHttpServer>;
	#httpsServer?: ReturnType<typeof createHttpsServer>;
	#httpRedirectServer?: ReturnType<typeof createHttpServer>;
	#tls?: TLSConfig;
	#port: number;
	#host: string;

	constructor(options: {port: number; host: string; tls?: TLSConfig}) {
		this.#apps = new Map();
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

		// Clean up stale socket file
		if (existsSync(VIRTUALHOST_SOCKET_PATH)) {
			try {
				unlinkSync(VIRTUALHOST_SOCKET_PATH);
			} catch (error) {
				logger.debug("Could not remove stale socket: {error}", {error});
			}
		}

		// Start IPC server
		await this.#startIPCServer();

		// Start HTTP/HTTPS server
		await this.#startProxyServer();

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
		if (existsSync(VIRTUALHOST_SOCKET_PATH)) {
			try {
				unlinkSync(VIRTUALHOST_SOCKET_PATH);
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
		// Normalize hostname to handle IPv6 brackets consistently
		const hostname = normalizeHostname(new URL(app.origin).hostname);
		this.#apps.set(hostname, app);
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
		// Normalize hostname to handle IPv6 brackets consistently
		const hostname = normalizeHostname(new URL(origin).hostname);
		this.#apps.delete(hostname);
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
				if (error.code === "EADDRINUSE") {
					reject(new Error("VirtualHost socket already in use"));
				} else {
					reject(error);
				}
			});

			this.#ipcServer.listen(VIRTUALHOST_SOCKET_PATH, () => {
				logger.debug("IPC server listening on {path}", {
					path: VIRTUALHOST_SOCKET_PATH,
				});
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
			this.#httpsServer = createHttpsServer(
				{cert: this.#tls.cert, key: this.#tls.key},
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

				// Extract hostname (without port) and redirect to HTTPS
				const hostname = parseHostHeader(host);
				const redirectUrl = `https://${hostname}${req.url || "/"}`;

				logger.debug("Redirecting HTTP → HTTPS: {url}", {url: redirectUrl});
				res.writeHead(301, {Location: redirectUrl});
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
			logger.error("{method} {host}{url} 502 (no app registered)", {
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
		const protocol = this.#tls ? "https:" : "http:";
		// Format host for URL (IPv6 needs brackets)
		const urlHost = formatHostForUrl(app.host);
		const url = new URL(req.url || "/", `${protocol}//${urlHost}:${app.port}`);

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
	#actualPort?: number;
	#onDisconnect?: () => void;

	constructor(options: {
		origin: string;
		host: string;
		port: number;
		onDisconnect?: () => void;
	}) {
		this.#origin = options.origin;
		this.#host = options.host;
		this.#port = options.port;
		this.#onDisconnect = options.onDisconnect;
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
				if (registered && this.#onDisconnect) {
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

			this.#socket.connect(VIRTUALHOST_SOCKET_PATH);
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
 * Check if a virtualhost is already running.
 * If a stale socket file exists (from a crashed process), it will be cleaned up.
 */
export async function isVirtualHostRunningAsync(): Promise<boolean> {
	if (!existsSync(VIRTUALHOST_SOCKET_PATH)) {
		return false;
	}

	return new Promise<boolean>((resolve) => {
		const socket = new Socket();

		const cleanupStaleSocket = () => {
			// Socket exists but connection failed - it's stale, clean it up
			try {
				unlinkSync(VIRTUALHOST_SOCKET_PATH);
				logger.debug("Cleaned up stale VirtualHost socket");
			} catch (err) {
				logger.debug("Could not clean up stale socket: {error}", {error: err});
			}
		};

		const timeout = setTimeout(() => {
			socket.destroy();
			cleanupStaleSocket();
			resolve(false);
		}, 1000);

		socket.on("connect", () => {
			clearTimeout(timeout);
			socket.destroy();
			resolve(true);
		});

		socket.on("error", () => {
			clearTimeout(timeout);
			cleanupStaleSocket();
			resolve(false);
		});

		socket.connect(VIRTUALHOST_SOCKET_PATH);
	});
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
		// Check if a VirtualHost is already running
		const isRunning = await isVirtualHostRunningAsync();

		if (isRunning) {
			// Try to connect as a client
			try {
				const client = new VirtualHostClient({
					origin,
					host: "127.0.0.1",
					port: 0, // Will be set when registering
					onDisconnect,
				});
				await onNeedRegistration(client);
				return {role: "client", client};
			} catch (err) {
				logger.debug("Failed to connect as client: {error}", {error: err});
				// Fall through to try becoming leader
			}
		}

		// Try to become the leader
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
				// Someone else won the race, wait with backoff and retry
				const backoff = Math.min(
					100 * Math.pow(1.5, attempt) + Math.random() * 100,
					1000,
				);
				logger.debug("Port {port} in use, retrying in {ms}ms", {
					port,
					ms: Math.round(backoff),
				});
				await new Promise((resolve) => setTimeout(resolve, backoff));
				continue;
			}
			throw err; // Other error, propagate
		}
	}

	throw new Error(
		`Failed to establish VirtualHost connection after ${maxAttempts} attempts`,
	);
}
