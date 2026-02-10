/// <reference path="./globals.d.ts" />
/// <reference path="./shovel-config.d.ts" />
/**
 * @b9g/platform - Platform interface for ServiceWorker entrypoint loading
 *
 * Platform = "ServiceWorker entrypoint loader for JavaScript runtimes"
 * Core responsibility: Take a ServiceWorker-style app file and make it run in this environment.
 *
 * This module contains:
 * - Platform interface and base classes
 * - ServiceWorkerPool for multi-worker execution
 */

import {getLogger} from "@logtape/logtape";
import {CustomLoggerStorage, type LoggerStorage} from "./runtime.js";

// Re-export config validation utilities
export {validateConfig, ConfigValidationError} from "./config.js";

// Runtime global declarations for platform detection
declare const Deno: any;
declare const window: any;

const logger = getLogger(["shovel", "platform"]);

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Server options for platform implementations
 */
export interface ServerOptions {
	/** Port to listen on */
	port?: number;
	/** Host to bind to */
	host?: string;
	/** Enable SO_REUSEPORT for multi-worker deployments (Bun only) */
	reusePort?: boolean;
}

/**
 * WebSocket bridge for worker-mode relay.
 * Platform adapters use this to bridge the real network socket to the worker.
 */
export interface WebSocketBridge {
	/** Connect the real socket. Provide send/close callbacks for outgoing data. */
	connect(
		send: (data: string | ArrayBuffer) => void,
		close: (code?: number, reason?: string) => void,
	): void;
	/** Deliver incoming data from the real socket to the worker. */
	deliver(data: string | ArrayBuffer): void;
	/** Deliver a close event from the real socket to the worker. */
	deliverClose(code: number, reason: string): void;
}

/**
 * Result of handling a request. Either an HTTP response or a WebSocket upgrade.
 */
export type HandleResult =
	| {response: Response; webSocket?: undefined}
	| {response?: undefined; webSocket: WebSocketBridge};

/**
 * Create a WebSocketBridge from a ShovelWebSocket (direct mode).
 *
 * In direct mode, the ShovelWebSocket's peer delivery handles the bridge:
 * - clientSocket.send(data) delivers to the server socket (peer)
 * - server.send(data) delivers to clientSocket, triggering our message listener
 */
export function createWebSocketBridge(
	clientSocket: import("./websocket.js").ShovelWebSocket,
): WebSocketBridge {
	return {
		connect(send, close) {
			clientSocket.accept();

			// Server.send() → client receives → forward to real socket
			clientSocket.addEventListener("message", ((ev: MessageEvent) => {
				send(ev.data);
			}) as EventListener);

			clientSocket.addEventListener("close", ((ev: CloseEvent) => {
				close(ev.code, ev.reason);
			}) as EventListener);
		},
		deliver(data) {
			// Real socket received data → forward to server via client.send()
			clientSocket.send(data);
		},
		deliverClose(code, reason) {
			clientSocket.close(code, reason);
		},
	};
}

/**
 * Request handler function (Web Fetch API compatible)
 */
export type Handler = (
	request: Request,
	context?: any,
) => Promise<Response> | Response;

/**
 * Request handler that can return either an HTTP response or a WebSocket upgrade.
 * Used by createServer() in platform adapters.
 * Handlers may return a plain Response for convenience (auto-wrapped in HandleResult).
 */
export type RequestHandler = (
	request: Request,
	context?: any,
) => Promise<HandleResult | Response> | HandleResult | Response;

/**
 * Server instance returned by platform.createServer()
 */
export interface Server {
	/** Start listening for requests */
	listen(): Promise<void>;
	/** Stop the server */
	close(): Promise<void>;
	/** Get server address information */
	address(): {port: number; host: string};
	/** Get server URL */
	readonly url: string;
	/** Whether server is ready to accept requests */
	readonly ready: boolean;
}

/**
 * ServiceWorker entrypoint options
 */
export interface ServiceWorkerOptions {
	/** Additional context to provide */
	context?: any;
	/** Number of worker threads (Node/Bun only) */
	workerCount?: number;
	/** Enable hot reload (dev mode) - forces worker mode for reliable reloading */
	hotReload?: boolean;
}

/**
 * ServiceWorker instance returned by platform
 */
export interface ServiceWorkerInstance {
	/** The ServiceWorker runtime */
	runtime: any; // WorkerPool or ServiceWorkerRegistration
	/** Handle HTTP request */
	handleRequest(request: Request): Promise<HandleResult>;
	/** Install the ServiceWorker */
	install(): Promise<void>;
	/** Activate the ServiceWorker */
	activate(): Promise<void>;
	/** Check if ready to handle requests */
	readonly ready: boolean;
	/** Dispose of resources */
	dispose(): Promise<void>;
}

/**
 * Entry points returned by getEntryPoints().
 * Each key is the output filename (without .js), value is the code.
 *
 * Examples:
 * - Cloudflare: { "worker": "<code>" } - single worker file
 * - Node/Bun: { "index": "<supervisor>", "worker": "<worker>" } - two files
 */
export type EntryPoints = Record<string, string>;

/** @deprecated Use EntryPoints instead */
export type ProductionEntryPoints = EntryPoints;

/**
 * ESBuild configuration subset that platforms can customize
 */
export interface PlatformESBuildConfig {
	/** Target platform: "node" or "browser" */
	platform?: "node" | "browser" | "neutral";
	/** Export conditions for package.json resolution */
	conditions?: string[];
	/** External modules to exclude from bundle */
	external?: string[];
	/** Compile-time defines */
	define?: Record<string, string>;
}

/**
 * Default resource configuration for a named resource (cache, directory, etc.)
 * Used by platforms to define built-in defaults that get merged with user config.
 */
export interface ResourceDefault {
	/** Module path to import (e.g., "@b9g/cache/memory") */
	module: string;
	/** Named export to use (defaults to "default") */
	export?: string;
	/** Additional options (e.g., path for directories) */
	[key: string]: unknown;
}

/**
 * Platform-specific defaults for config generation.
 * These are merged with user config at build time to provide
 * sensible defaults for each platform.
 */
export interface PlatformDefaults {
	/** Default directory configurations (server, public, tmp, etc.) */
	directories?: Record<string, ResourceDefault>;
	/** Default cache configuration (e.g., memory cache) */
	caches?: Record<string, ResourceDefault>;
}

/**
 * Extended ServiceWorkerContainer with internal methods for hot reload
 */
export interface ShovelServiceWorkerContainer extends ServiceWorkerContainer {
	/** Internal: Get the worker pool for request handling */
	readonly pool?: {handleRequest(request: Request): Promise<HandleResult>};
	/** Internal: Terminate all workers */
	terminate(): Promise<void>;
	/** Internal: Reload workers (for hot reload) */
	reloadWorkers(entrypoint: string): Promise<void>;
}

// ============================================================================
// Platform Detection
// ============================================================================

/**
 * Detect the current JavaScript runtime
 */
export function detectRuntime(): "bun" | "deno" | "node" {
	if (typeof Bun !== "undefined" || process.versions?.bun) {
		return "bun";
	}

	if (typeof Deno !== "undefined") {
		return "deno";
	}

	// Default to Node.js
	return "node";
}

/**
 * Detect deployment platform from environment
 *
 * Supports:
 * - Cloudflare Workers
 *
 * Future platforms (Lambda, Vercel, Netlify, Deno) will be added post-launch
 */
export function detectDeploymentPlatform(): string | null {
	// Explicitly check we're NOT in Node.js/Bun first
	// (Node now has fetch/caches globals, so can't rely on them alone)
	if (
		typeof process !== "undefined" &&
		(process.versions?.node || process.versions?.bun)
	) {
		return null; // Running in Node.js or Bun, not a deployment platform
	}

	// Cloudflare Workers - has web APIs but no process global
	if (
		typeof caches !== "undefined" &&
		typeof addEventListener !== "undefined" &&
		typeof fetch !== "undefined" &&
		// Ensure we're not in a browser
		typeof window === "undefined"
	) {
		return "cloudflare";
	}

	return null;
}

/**
 * Detect platform for development based on current runtime
 */
export function detectDevelopmentPlatform(): string {
	const runtime = detectRuntime();

	switch (runtime) {
		case "bun":
			return "bun";
		case "deno":
			return "deno";
		case "node":
		default:
			return "node";
	}
}

/**
 * Resolve platform name from options, config, or auto-detect
 *
 * Priority:
 * 1. Explicit --platform or --target CLI flag
 * 2. shovel.json or package.json "shovel.platform" field
 * 3. Deployment platform detection (production environments)
 * 4. Development platform detection (local runtime)
 */
export function resolvePlatform(options: {
	platform?: string;
	target?: string;
	config?: {platform?: string};
}): string {
	// Explicit CLI platform takes precedence
	if (options.platform) {
		return options.platform;
	}

	// Target for build/deploy scenarios
	if (options.target) {
		return options.target;
	}

	// Config file platform (shovel.json or package.json)
	if (options.config?.platform) {
		return options.config.platform;
	}

	// Try to detect deployment platform (Lambda, Vercel, etc.)
	const deploymentPlatform = detectDeploymentPlatform();
	if (deploymentPlatform) {
		return deploymentPlatform;
	}

	// Fallback to development platform (bun, node, deno)
	return detectDevelopmentPlatform();
}

/**
 * Merge platform defaults with user config
 *
 * Deep merges each entry so user can override specific options without
 * losing the platform's default implementation class.
 *
 * @param defaults - Platform's runtime defaults (with actual class refs)
 * @param userConfig - User's config from shovel.json (may be partial)
 * @returns Merged config with all entries
 */
export function mergeConfigWithDefaults(
	defaults: Record<string, Record<string, unknown>>,
	userConfig: Record<string, Record<string, unknown>> | undefined,
): Record<string, Record<string, unknown>> {
	const user = userConfig ?? {};
	const allNames = new Set([...Object.keys(defaults), ...Object.keys(user)]);
	const merged: Record<string, Record<string, unknown>> = {};
	for (const name of allNames) {
		merged[name] = {...defaults[name], ...user[name]};
	}
	return merged;
}

// ============================================================================
// ServiceWorkerPool - Multi-worker ServiceWorker execution
// ============================================================================

/**
 * Worker pool options
 */
export interface WorkerPoolOptions {
	/** Number of workers in the pool (default: 1) */
	workerCount?: number;
	/** Request timeout in milliseconds (default: 30000) */
	requestTimeout?: number;
	/** Working directory for file resolution */
	cwd?: string;
	/** Custom worker factory (if not provided, uses createWebWorker) */
	createWorker?: (entrypoint: string) => Worker | Promise<Worker>;
}

interface WorkerMessage {
	type: string;
	[key: string]: any;
}

interface WorkerRequest extends WorkerMessage {
	type: "request";
	request: {
		url: string;
		method: string;
		headers: Record<string, string>;
		body?: ArrayBuffer | null; // Zero-copy transfer to worker
	};
	requestID: number;
}

interface WorkerResponse extends WorkerMessage {
	type: "response";
	response: {
		status: number;
		statusText: string;
		headers: Record<string, string>;
		body: ArrayBuffer; // Zero-copy transfer from worker
	};
	requestID: number;
}

interface WorkerErrorMessage extends WorkerMessage {
	type: "error";
	error: string;
	stack?: string;
	requestID?: number;
}

/**
 * Create a web-standard Worker with targeted Node.js fallback
 */
async function createWebWorker(workerScript: string): Promise<Worker> {
	// Try native Web Worker API first (works in Bun, Deno, browsers)
	if (typeof Worker !== "undefined") {
		return new Worker(workerScript, {type: "module"} as WorkerOptions);
	}

	// Only try shim for Node.js (which lacks native Worker support)
	const isNodeJs = typeof process !== "undefined" && process.versions?.node;

	if (isNodeJs) {
		// Try to dynamically import our own Node.js shim
		try {
			const {Worker: NodeWebWorker} = await import("@b9g/node-webworker");
			logger.info("Using @b9g/node-webworker shim for Node.js", {});
			// Our Node.js shim doesn't implement all Web Worker properties, but has the core functionality
			return new NodeWebWorker(workerScript, {
				type: "module",
			}) as unknown as Worker;
		} catch (shimError) {
			logger.error(
				"MISSING WEB STANDARD: Node.js lacks native Web Worker support",
				{
					canonicalIssue: "https://github.com/nodejs/node/issues/43583",
					message:
						"This is a basic web standard from 2009 - help push for implementation!",
				},
			);

			throw new Error(`❌ Web Worker not available on Node.js

🔗 Node.js doesn't implement the Web Worker standard yet.
   CANONICAL ISSUE: https://github.com/nodejs/node/issues/43583

🗳️  Please 👍 react and comment to show demand for this basic web standard!

💡 Immediate workaround:
   npm install @b9g/node-webworker

   This installs our minimal, reliable Web Worker shim for Node.js.

📚 Learn more: https://developer.mozilla.org/en-US/docs/Web/API/Worker`);
		}
	}

	// For other runtimes, fail with generic message
	const runtime =
		typeof Bun !== "undefined"
			? "Bun"
			: typeof Deno !== "undefined"
				? "Deno"
				: "Unknown";

	throw new Error(`❌ Web Worker not available on ${runtime}

This runtime should support Web Workers but the API is not available.
Please check your runtime version and configuration.

📚 Web Worker standard: https://developer.mozilla.org/en-US/docs/Web/API/Worker`);
}

/**
 * ServiceWorkerPool - manages a pool of ServiceWorker instances
 *
 * With the unified build model, workers are self-contained bundles that:
 * 1. Initialize their own runtime (via initWorkerRuntime)
 * 2. Import user code
 * 3. Run lifecycle events
 * 4. Start message loop (via startWorkerMessageLoop)
 *
 * Hot reload is achieved by terminating old workers and creating new ones
 * with the new bundle path.
 */
export class ServiceWorkerPool {
	#workers: Worker[];
	#currentWorker: number;
	#requestID: number;
	#pendingRequests: Map<
		number,
		{
			resolve: (result: HandleResult) => void;
			reject: (error: Error) => void;
			timeoutId?: ReturnType<typeof setTimeout>;
		}
	>;
	#pendingWorkerReady: Map<
		Worker,
		{resolve: () => void; reject: (e: Error) => void}
	>;
	#options: Required<Omit<WorkerPoolOptions, "cwd" | "createWorker">> & {
		cwd?: string;
		createWorker?: (entrypoint: string) => Worker | Promise<Worker>;
	};
	#appEntrypoint: string;
	#cacheStorage?: CacheStorage & {
		handleMessage?: (worker: Worker, message: any) => Promise<void>;
	};
	// Waiters for when workers become available (used during reload)
	#workerAvailableWaiters: Array<{
		resolve: () => void;
		reject: (error: Error) => void;
	}>;
	// WebSocket bridges: connectionID → bridge state (for worker-mode WS relay)
	#wsBridges: Map<
		number,
		{
			worker: Worker;
			send: ((data: string | ArrayBuffer) => void) | null;
			close: ((code?: number, reason?: string) => void) | null;
			pendingSends: (string | ArrayBuffer)[];
		}
	>;

	constructor(
		options: WorkerPoolOptions = {},
		appEntrypoint: string,
		cacheStorage?: CacheStorage,
	) {
		this.#workers = [];
		this.#currentWorker = 0;
		this.#requestID = 0;
		this.#pendingRequests = new Map();
		this.#pendingWorkerReady = new Map();
		this.#workerAvailableWaiters = [];
		this.#wsBridges = new Map();
		this.#appEntrypoint = appEntrypoint;
		this.#cacheStorage = cacheStorage;
		this.#options = {
			workerCount: 1,
			requestTimeout: 30000,
			...options,
		};
	}

	/**
	 * Initialize workers (must be called after construction)
	 */
	async init(): Promise<void> {
		const promises: Promise<Worker>[] = [];
		for (let i = 0; i < this.#options.workerCount; i++) {
			promises.push(this.#createWorker(this.#appEntrypoint));
		}
		await Promise.all(promises);
	}

	/**
	 * Create a worker from the unified bundle
	 * The bundle self-initializes and sends "ready" when done
	 */
	async #createWorker(entrypoint: string): Promise<Worker> {
		const worker = this.#options.createWorker
			? await this.#options.createWorker(entrypoint)
			: await createWebWorker(entrypoint);

		// Set up promise to wait for ready signal
		const readyPromise = new Promise<void>((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				this.#pendingWorkerReady.delete(worker);
				reject(
					new Error(
						`Worker failed to become ready within 30000ms (${entrypoint})`,
					),
				);
			}, 30000);

			this.#pendingWorkerReady.set(worker, {
				resolve: () => {
					clearTimeout(timeoutId);
					resolve();
				},
				reject: (error: Error) => {
					clearTimeout(timeoutId);
					reject(error);
				},
			});
		});

		// Set up message handler
		worker.addEventListener("message", (event) => {
			this.#handleWorkerMessage(worker, event.data || event);
		});

		// Set up error handler
		worker.addEventListener("error", (event: any) => {
			const errorMessage =
				event.message || event.error?.message || "Unknown worker error";
			const error = new Error(`Worker error: ${errorMessage}`);
			logger.error("Worker error: {error}", {
				error: event.error || errorMessage,
				filename: event.filename,
				lineno: event.lineno,
				colno: event.colno,
			});

			// Reject pending ready promise if exists
			const pending = this.#pendingWorkerReady.get(worker);
			if (pending) {
				this.#pendingWorkerReady.delete(worker);
				pending.reject(error);
			}
		});

		logger.debug("Waiting for worker ready signal", {entrypoint});

		await readyPromise;
		this.#pendingWorkerReady.delete(worker);

		// Yield to event loop to ensure worker's message handler is fully active.
		// This works around a timing issue in Node.js worker_threads where the
		// worker may post "ready" before its event loop is ready to receive messages.
		await new Promise((resolve) => setTimeout(resolve, 0));

		// Only add worker to the pool AFTER it's ready to handle requests
		// This prevents requests being dispatched to workers that haven't
		// finished initializing their ServiceWorker code
		this.#workers.push(worker);
		logger.debug("Worker ready", {entrypoint});

		// Notify any waiters that a worker is now available
		const waiters = this.#workerAvailableWaiters;
		this.#workerAvailableWaiters = [];
		for (const waiter of waiters) {
			waiter.resolve();
		}

		return worker;
	}

	#handleWorkerMessage(worker: Worker, message: WorkerMessage) {
		logger.debug("Worker message received", {type: message.type});

		switch (message.type) {
			case "ready": {
				// Worker finished initialization, resolve the ready promise
				const pending = this.#pendingWorkerReady.get(worker);
				if (pending) {
					pending.resolve();
				}
				logger.debug("ServiceWorker ready");
				break;
			}

			case "response":
				this.#handleResponse(message as WorkerResponse);
				break;

			case "error":
				this.#handleError(message as WorkerErrorMessage);
				break;

			default:
				// Handle cache messages from PostMessageCache
				if (message.type?.startsWith("cache:")) {
					logger.debug("Cache message received", {type: message.type});
					if (this.#cacheStorage) {
						const storage = this.#cacheStorage as any;
						if (typeof storage.handleMessage === "function") {
							storage.handleMessage(worker, message).catch((err: Error) => {
								logger.error("Cache message handling failed: {error}", {
									error: err,
								});
							});
						}
					}
				} else if (message.type?.startsWith("ws:")) {
					this.#handleWebSocketMessage(worker, message);
				}
				break;
		}
	}

	#handleWebSocketMessage(worker: Worker, message: WorkerMessage) {
		switch (message.type) {
			case "ws:upgrade": {
				// Worker called event.upgradeWebSocket() — resolve with a bridge
				// that connects the real network socket to the worker's WebSocketPair.
				const pending = this.#pendingRequests.get(message.requestID);
				if (!pending) break;
				if (pending.timeoutId) clearTimeout(pending.timeoutId);

				const connectionID = message.requestID as number;
				const bridgeState = {
					worker,
					send: null as ((data: string | ArrayBuffer) => void) | null,
					close: null as ((code?: number, reason?: string) => void) | null,
					pendingSends: [] as (string | ArrayBuffer)[],
				};
				this.#wsBridges.set(connectionID, bridgeState);

				const webSocket: WebSocketBridge = {
					// Called by adapter after real socket upgrade completes
					connect: (
						send: (data: string | ArrayBuffer) => void,
						close: (code?: number, reason?: string) => void,
					) => {
						bridgeState.send = send;
						bridgeState.close = close;
						// Flush any messages that arrived before connect
						for (const data of bridgeState.pendingSends) {
							send(data);
						}
						bridgeState.pendingSends = [];
					},
					// Called by adapter when real socket receives a message
					deliver: (data: string | ArrayBuffer) => {
						if (data instanceof ArrayBuffer) {
							worker.postMessage({type: "ws:message", connectionID, data}, [
								data,
							]);
						} else {
							worker.postMessage({
								type: "ws:message",
								connectionID,
								data,
							});
						}
					},
					// Called by adapter when real socket closes
					deliverClose: (code: number, reason: string) => {
						worker.postMessage({
							type: "ws:closed",
							connectionID,
							code,
							reason,
						});
						this.#wsBridges.delete(connectionID);
					},
				};

				pending.resolve({webSocket});
				this.#pendingRequests.delete(message.requestID);
				break;
			}

			case "ws:send": {
				// Worker's server.send() → forward to real socket via bridge
				const bridge = this.#wsBridges.get(message.connectionID);
				if (bridge) {
					if (bridge.send) {
						bridge.send(message.data);
					} else {
						bridge.pendingSends.push(message.data);
					}
				}
				break;
			}

			case "ws:close": {
				// Worker's server.close() → close real socket via bridge
				const bridge = this.#wsBridges.get(message.connectionID);
				if (bridge?.close) {
					bridge.close(message.code, message.reason);
				}
				this.#wsBridges.delete(message.connectionID);
				break;
			}
		}
	}

	#handleResponse(message: WorkerResponse) {
		const pending = this.#pendingRequests.get(message.requestID);
		if (pending) {
			if (pending.timeoutId) {
				clearTimeout(pending.timeoutId);
			}
			const response = new Response(message.response.body, {
				status: message.response.status,
				statusText: message.response.statusText,
				headers: message.response.headers,
			});
			pending.resolve({response});
			this.#pendingRequests.delete(message.requestID);
		}
	}

	#handleError(message: WorkerErrorMessage) {
		logger.error("Worker error message received: {error}", {
			error: message.error,
			stack: message.stack,
			requestID: message.requestID,
		});

		if (message.requestID) {
			const pending = this.#pendingRequests.get(message.requestID);
			if (pending) {
				if (pending.timeoutId) {
					clearTimeout(pending.timeoutId);
				}
				pending.reject(new Error(message.error));
				this.#pendingRequests.delete(message.requestID);
			}
		}
	}

	/**
	 * Handle HTTP request using round-robin worker selection
	 */
	async handleRequest(request: Request): Promise<HandleResult> {
		// Wait for workers to be available (e.g., during reload)
		if (this.#workers.length === 0) {
			logger.debug("No workers available, waiting for worker to be ready");
			await new Promise<void>((resolve, reject) => {
				const waiter = {resolve, reject};
				this.#workerAvailableWaiters.push(waiter);

				// Timeout if no worker becomes available
				const timeoutId = setTimeout(() => {
					const index = this.#workerAvailableWaiters.indexOf(waiter);
					if (index !== -1) {
						this.#workerAvailableWaiters.splice(index, 1);
						reject(new Error("Timeout waiting for worker to become available"));
					}
				}, this.#options.requestTimeout);

				// Clear timeout if resolved/rejected normally
				const originalResolve = waiter.resolve;
				const originalReject = waiter.reject;
				waiter.resolve = () => {
					clearTimeout(timeoutId);
					originalResolve();
				};
				waiter.reject = (error: Error) => {
					clearTimeout(timeoutId);
					originalReject(error);
				};
			});
		}

		const worker = this.#workers[this.#currentWorker];
		logger.debug("Dispatching to worker", {
			workerIndex: this.#currentWorker + 1,
			totalWorkers: this.#workers.length,
		});
		this.#currentWorker = (this.#currentWorker + 1) % this.#workers.length;

		const requestID = ++this.#requestID;

		return new Promise((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				if (this.#pendingRequests.has(requestID)) {
					this.#pendingRequests.delete(requestID);
					reject(new Error("Request timeout"));
				}
			}, this.#options.requestTimeout);

			this.#pendingRequests.set(requestID, {resolve, reject, timeoutId});
			this.#sendRequest(worker, request, requestID).catch(reject);
		});
	}

	async #sendRequest(
		worker: Worker,
		request: Request,
		requestID: number,
	): Promise<void> {
		let body: ArrayBuffer | null = null;
		if (request.body) {
			body = await request.arrayBuffer();
		}

		const workerRequest: WorkerRequest = {
			type: "request",
			request: {
				url: request.url,
				method: request.method,
				headers: Object.fromEntries(request.headers.entries()),
				body,
			},
			requestID,
		};

		if (body) {
			worker.postMessage(workerRequest, [body]);
		} else {
			worker.postMessage(workerRequest);
		}
	}

	/**
	 * Gracefully shutdown a worker by closing all resources first
	 */
	async #gracefulShutdown(worker: Worker, timeout = 5000): Promise<void> {
		return new Promise<void>((resolve) => {
			let resolved = false;

			// Set up listener for shutdown-complete
			const onMessage = (event: MessageEvent) => {
				const message = event.data || event;
				if (message?.type === "shutdown-complete") {
					if (!resolved) {
						resolved = true;
						worker.removeEventListener("message", onMessage);
						resolve();
					}
				}
			};
			worker.addEventListener("message", onMessage);

			// Send shutdown signal
			worker.postMessage({type: "shutdown"});

			// Timeout fallback - don't hang forever
			setTimeout(() => {
				if (!resolved) {
					resolved = true;
					worker.removeEventListener("message", onMessage);
					logger.warn("Worker shutdown timed out, forcing termination");
					resolve();
				}
			}, timeout);
		});
	}

	/**
	 * Reload workers with new entrypoint (hot reload)
	 *
	 * With unified builds, hot reload means:
	 * 1. Gracefully shutdown existing workers (close databases, etc.)
	 * 2. Terminate workers after resources are closed
	 * 3. Create new workers with the new bundle
	 */
	async reloadWorkers(entrypoint: string): Promise<void> {
		logger.debug("Reloading workers", {entrypoint});

		// Update stored entrypoint
		this.#appEntrypoint = entrypoint;

		// Gracefully shutdown existing workers - close resources before terminating
		const shutdownPromises = this.#workers.map((worker) =>
			this.#gracefulShutdown(worker),
		);
		await Promise.allSettled(shutdownPromises);

		// Now terminate the workers
		const terminatePromises = this.#workers.map((worker) => worker.terminate());
		await Promise.allSettled(terminatePromises);
		this.#workers = [];
		this.#currentWorker = 0; // Reset round-robin index

		// Create new workers with new bundle
		try {
			const createPromises: Promise<Worker>[] = [];
			for (let i = 0; i < this.#options.workerCount; i++) {
				createPromises.push(this.#createWorker(entrypoint));
			}
			await Promise.all(createPromises);
			logger.info("Reloaded {count} workers", {
				count: this.#options.workerCount,
			});
		} catch (error) {
			// If worker creation fails, reject any pending request waiters
			const waiters = this.#workerAvailableWaiters;
			this.#workerAvailableWaiters = [];
			const reloadError =
				error instanceof Error
					? error
					: new Error("Worker creation failed during reload");
			for (const waiter of waiters) {
				waiter.reject(reloadError);
			}
			throw error;
		}
	}

	/**
	 * Graceful shutdown of all workers
	 */
	async terminate(): Promise<void> {
		// Gracefully shutdown workers first (close databases, etc.)
		const shutdownPromises = this.#workers.map((worker) =>
			this.#gracefulShutdown(worker),
		);
		await Promise.allSettled(shutdownPromises);

		// Now terminate
		const terminatePromises = this.#workers.map((worker) => worker.terminate());
		await Promise.allSettled(terminatePromises);
		this.#workers = [];
		this.#currentWorker = 0; // Reset round-robin index
		this.#pendingRequests.clear();
		this.#pendingWorkerReady.clear();
		this.#wsBridges.clear();

		// Reject any pending request waiters
		const waiters = this.#workerAvailableWaiters;
		this.#workerAvailableWaiters = [];
		const terminateError = new Error("Worker pool terminated");
		for (const waiter of waiters) {
			waiter.reject(terminateError);
		}
	}

	/**
	 * Get the number of active workers
	 */
	get workerCount(): number {
		return this.#workers.length;
	}

	/**
	 * Check if the pool is ready to handle requests
	 */
	get ready(): boolean {
		return this.#workers.length > 0;
	}
}

// ============================================================================
// Re-exports from runtime.ts
// ============================================================================

export {CustomLoggerStorage, type LoggerStorage};
export type {LoggerFactory} from "./runtime.js";
export {
	CustomDatabaseStorage,
	createDatabaseFactory,
	type DatabaseStorage,
	type DatabaseConfig,
	type DatabaseFactory,
	type DatabaseUpgradeEvent,
} from "./runtime.js";
