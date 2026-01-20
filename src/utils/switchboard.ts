/**
 * Switchboard coordination for multi-app local HTTPS development
 *
 * When running multiple `shovel develop` instances with different origins
 * (e.g., myapp.localhost, blog.localhost), they need to share port 443.
 *
 * Architecture:
 * - First app becomes the "switchboard" and owns port 443/80
 * - Additional apps register with the switchboard via IPC (Unix socket)
 * - Switchboard proxies requests by Host header to the correct app
 * - When switchboard exits, another app can take over
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
import {join} from "path";
import {getLogger} from "@logtape/logtape";
import {SHOVEL_DIR} from "./certs.js";
import type {TLSConfig} from "@b9g/platform";

const logger = getLogger(["shovel", "switchboard"]);

/**
 * Path to the switchboard's IPC socket
 */
export const SWITCHBOARD_SOCKET_PATH = join(SHOVEL_DIR, "switchboard.sock");

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
 * Switchboard class - manages multiple apps on a single port
 */
export class Switchboard {
	#apps: Map<string, RegisteredApp>;
	#ipcServer?: NetServer;
	#httpServer?: ReturnType<typeof createHttpServer>;
	#httpsServer?: ReturnType<typeof createHttpsServer>;
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
	 * Start the switchboard
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
		if (existsSync(SWITCHBOARD_SOCKET_PATH)) {
			try {
				unlinkSync(SWITCHBOARD_SOCKET_PATH);
			} catch (error) {
				logger.debug("Could not remove stale socket: {error}", {error});
			}
		}

		// Start IPC server
		await this.#startIPCServer();

		// Start HTTP/HTTPS server
		await this.#startProxyServer();

		logger.info("Switchboard started on port {port}", {port: this.#port});
	}

	/**
	 * Stop the switchboard and clean up
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
		]);

		// Clean up socket file
		if (existsSync(SWITCHBOARD_SOCKET_PATH)) {
			try {
				unlinkSync(SWITCHBOARD_SOCKET_PATH);
			} catch (error) {
				logger.debug("Could not remove socket on stop: {error}", {error});
			}
		}

		logger.info("Switchboard stopped");
	}

	/**
	 * Register a local app
	 */
	registerApp(app: RegisteredApp): void {
		const hostname = new URL(app.origin).hostname;
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
		const hostname = new URL(origin).hostname;
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
					reject(new Error("Switchboard socket already in use"));
				} else {
					reject(error);
				}
			});

			this.#ipcServer.listen(SWITCHBOARD_SOCKET_PATH, () => {
				logger.debug("IPC server listening on {path}", {
					path: SWITCHBOARD_SOCKET_PATH,
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
				logger.error("Server bind error: {code} {message} (host={host}, port={port})", {
					code: error.code,
					message: error.message,
					host: this.#host,
					port: this.#port,
				});
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
		const hostname = host.split(":")[0];

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
		const url = new URL(req.url || "/", `${protocol}//${app.host}:${app.port}`);

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
 * Switchboard client - connects to an existing switchboard
 */
export class SwitchboardClient {
	#socket?: Socket;
	#origin: string;
	#host: string;
	#port: number;

	constructor(options: {origin: string; host: string; port: number}) {
		this.#origin = options.origin;
		this.#host = options.host;
		this.#port = options.port;
	}

	/**
	 * Connect to the switchboard and register this app
	 * @param actualPort - The actual port the server is listening on (overrides constructor port)
	 */
	async connect(actualPort?: number): Promise<void> {
		const port = actualPort ?? this.#port;
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
								logger.info("Registered with switchboard: {origin}", {
									origin: this.#origin,
								});
								resolve();
							} else {
								reject(new Error(message.error || "Registration failed"));
							}
						}
					} catch (error) {
						logger.error("Invalid switchboard response: {error}", {error});
					}
				}
			});

			this.#socket.on("error", (error: NodeJS.ErrnoException) => {
				if (error.code === "ENOENT" || error.code === "ECONNREFUSED") {
					reject(new Error("Switchboard not available"));
				} else {
					reject(error);
				}
			});

			this.#socket.connect(SWITCHBOARD_SOCKET_PATH);
		});
	}

	/**
	 * Disconnect from the switchboard
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
 * Check if a switchboard is already running
 */
export async function isSwitchboardRunningAsync(): Promise<boolean> {
	if (!existsSync(SWITCHBOARD_SOCKET_PATH)) {
		return false;
	}

	return new Promise<boolean>((resolve) => {
		const socket = new Socket();

		const timeout = setTimeout(() => {
			socket.destroy();
			resolve(false);
		}, 1000);

		socket.on("connect", () => {
			clearTimeout(timeout);
			socket.destroy();
			resolve(true);
		});

		socket.on("error", () => {
			clearTimeout(timeout);
			resolve(false);
		});

		socket.connect(SWITCHBOARD_SOCKET_PATH);
	});
}
