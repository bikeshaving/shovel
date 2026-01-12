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
import type {DirectoryStorage} from "@b9g/filesystem";
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
 * Platform configuration
 * Extended by platform-specific implementations (NodePlatformOptions, etc.)
 */
export interface PlatformConfig {
	// Platform-specific configuration will be added here as needed
}

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
 * Request handler function (Web Fetch API compatible)
 */
export type Handler = (
	request: Request,
	context?: any,
) => Promise<Response> | Response;

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
	handleRequest(request: Request): Promise<Response>;
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
 * Production entry points returned by getProductionEntryPoints().
 * Each key is the output filename (without .js), value is the code.
 *
 * Examples:
 * - Cloudflare: { "worker": "<code>" } - single worker file
 * - Node/Bun: { "index": "<supervisor>", "worker": "<worker>" } - two files
 */
export type ProductionEntryPoints = Record<string, string>;

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
 * Platform interface - ServiceWorker entrypoint loader for JavaScript runtimes
 *
 * The core responsibility: "Take a ServiceWorker-style app file and make it run in this environment"
 */
export interface Platform {
	/**
	 * Platform name for identification
	 */
	readonly name: string;

	/**
	 * Load and run a ServiceWorker-style entrypoint
	 * This is where all the platform-specific complexity lives
	 */
	loadServiceWorker(
		entrypoint: string,
		options?: ServiceWorkerOptions,
	): Promise<ServiceWorkerInstance>;

	/**
	 * SUPPORTING UTILITY - Create server instance for this platform
	 */
	createServer(handler: Handler, options?: ServerOptions): Server;

	/**
	 * BUILD SUPPORT - Get production entry points for bundling
	 *
	 * Returns a map of output filenames to their source code.
	 * The build system creates one output file per entry point.
	 *
	 * Platform determines the structure:
	 * - Cloudflare: { "worker": "<code>" } - single worker file
	 * - Node/Bun: { "index": "<supervisor>", "worker": "<runtime + user code>" }
	 *
	 * The user's entrypoint code is statically imported into the appropriate file.
	 *
	 * @param userEntryPath - Path to user's entrypoint (will be imported)
	 */
	getProductionEntryPoints(userEntryPath: string): ProductionEntryPoints;

	/**
	 * BUILD SUPPORT - Get platform-specific esbuild configuration
	 *
	 * Returns partial esbuild config that the CLI merges with common settings.
	 * Includes platform target, conditions, externals, and defines.
	 */
	getESBuildConfig(): PlatformESBuildConfig;

	/**
	 * BUILD SUPPORT - Get platform-specific defaults for config generation
	 *
	 * Returns defaults for directories, caches, etc. that get merged with
	 * user config at build time. These are used by generateConfigModule()
	 * to create static imports for the default implementations.
	 */
	getDefaults(): PlatformDefaults;

	/**
	 * Create cache storage for this platform
	 * Uses platform-specific defaults, overridable via shovel.json config
	 */
	createCaches(): Promise<CacheStorage>;

	/**
	 * Create directory storage for this platform
	 * Uses platform-specific defaults, overridable via shovel.json config
	 */
	createDirectories(): Promise<DirectoryStorage>;

	/**
	 * Create logger storage for this platform
	 * Uses platform-specific defaults, overridable via shovel.json config
	 */
	createLoggers(): Promise<LoggerStorage>;
}

// ============================================================================
// Platform Detection
// ============================================================================

/**
 * Platform registry - internal implementation
 */
interface PlatformRegistry {
	/** Register a platform implementation */
	register(name: string, platform: any): void;
	/** Get platform by name */
	get(name: string): any | undefined;
	/** Get all registered platforms */
	list(): string[];
}

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
 * Create platform instance based on name
 */
export async function createPlatform(
	platformName: string,
	options: any = {},
): Promise<any> {
	switch (platformName) {
		case "node": {
			const {default: NodePlatform} = await import("@b9g/platform-node");
			return new NodePlatform(options);
		}

		case "bun": {
			const {default: BunPlatform} = await import("@b9g/platform-bun");
			return new BunPlatform(options);
		}

		case "cloudflare": {
			const {default: CloudflarePlatform} =
				await import("@b9g/platform-cloudflare");
			return new CloudflarePlatform(options);
		}

		default:
			throw new Error(
				`Unknown platform: ${platformName}. Valid platforms: node, bun, cloudflare`,
			);
	}
}

// ============================================================================
// Base Platform Class
// ============================================================================

/**
 * Base platform class with shared adapter loading logic
 * Platform implementations extend this and provide platform-specific methods
 */
export abstract class BasePlatform implements Platform {
	config: PlatformConfig;

	constructor(config: PlatformConfig = {}) {
		this.config = config;
	}

	abstract readonly name: string;
	abstract loadServiceWorker(entrypoint: string, options?: any): Promise<any>;
	abstract createServer(handler: any, options?: any): any;

	/**
	 * Get production entry points for bundling
	 * Subclasses must override to provide platform-specific entry points
	 */
	abstract getProductionEntryPoints(
		userEntryPath: string,
	): ProductionEntryPoints;

	/**
	 * Get platform-specific esbuild configuration
	 * Subclasses should override to provide platform-specific config
	 */
	abstract getESBuildConfig(): PlatformESBuildConfig;

	/**
	 * Get platform-specific defaults for config generation
	 * Subclasses should override to provide platform-specific defaults
	 */
	abstract getDefaults(): PlatformDefaults;

	/**
	 * Create cache storage for this platform
	 * Subclasses must override to provide platform-specific implementation
	 */
	abstract createCaches(): Promise<CacheStorage>;

	/**
	 * Create directory storage for this platform
	 * Subclasses must override to provide platform-specific implementation
	 */
	abstract createDirectories(): Promise<DirectoryStorage>;

	/**
	 * Create logger storage for this platform
	 * Subclasses must override to provide platform-specific implementation
	 */
	abstract createLoggers(): Promise<LoggerStorage>;
}

// ============================================================================
// Platform Registry
// ============================================================================

/**
 * Global platform registry
 */
class DefaultPlatformRegistry implements PlatformRegistry {
	#platforms: Map<string, Platform>;

	constructor() {
		this.#platforms = new Map<string, Platform>();
	}

	register(name: string, platform: Platform): void {
		this.#platforms.set(name, platform);
	}

	get(name: string): Platform | undefined {
		return this.#platforms.get(name);
	}

	list(): string[] {
		return Array.from(this.#platforms.keys());
	}
}

/**
 * Global platform registry instance
 */
export const platformRegistry = new DefaultPlatformRegistry();

/**
 * Get platform by name with error handling
 */
export function getPlatform(name?: string): Platform {
	if (name) {
		const platform = platformRegistry.get(name);
		if (!platform) {
			const available = platformRegistry.list();
			throw new Error(
				`Platform '${name}' not found. Available platforms: ${available.join(", ")}`,
			);
		}
		return platform;
	}

	// Auto-detect platform from environment
	const platformName =
		detectDeploymentPlatform() || detectDevelopmentPlatform();
	const platform = platformRegistry.get(platformName);

	if (!platform) {
		throw new Error(
			`Detected platform '${platformName}' not registered. Please register it manually or specify a platform name.`,
		);
	}

	return platform;
}

/**
 * Get platform with async auto-registration fallback
 */
export async function getPlatformAsync(name?: string): Promise<Platform> {
	if (name) {
		const platform = platformRegistry.get(name);
		if (!platform) {
			const available = platformRegistry.list();
			throw new Error(
				`Platform '${name}' not found. Available platforms: ${available.join(", ")}`,
			);
		}
		return platform;
	}

	// Auto-detect platform from environment
	const platformName =
		detectDeploymentPlatform() || detectDevelopmentPlatform();
	const platform = platformRegistry.get(platformName);

	if (!platform) {
		throw new Error(
			`Detected platform '${platformName}' not registered. Please register it manually using platformRegistry.register().`,
		);
	}

	return platform;
}

// ============================================================================
// ServiceWorkerPool - Multi-worker ServiceWorker execution
// ============================================================================

/**
 * Common interface for ServiceWorker runtimes
 */
export interface ServiceWorkerRuntime {
	init(): Promise<void>;
	load(entrypoint: string): Promise<void>;
	handleRequest(request: Request): Promise<Response>;
	terminate(): Promise<void>;
	readonly workerCount: number;
	readonly ready: boolean;
}

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
}

export interface WorkerMessage {
	type: string;
	[key: string]: any;
}

export interface WorkerRequest extends WorkerMessage {
	type: "request";
	request: {
		url: string;
		method: string;
		headers: Record<string, string>;
		body?: ArrayBuffer | null; // Zero-copy transfer to worker
	};
	requestID: number;
}

export interface WorkerResponse extends WorkerMessage {
	type: "response";
	response: {
		status: number;
		statusText: string;
		headers: Record<string, string>;
		body: ArrayBuffer; // Zero-copy transfer from worker
	};
	requestID: number;
}

export interface WorkerReadyMessage extends WorkerMessage {
	type: "ready";
}

export interface WorkerErrorMessage extends WorkerMessage {
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
			resolve: (response: Response) => void;
			reject: (error: Error) => void;
			timeoutId?: ReturnType<typeof setTimeout>;
		}
	>;
	#pendingWorkerReady: Map<
		Worker,
		{resolve: () => void; reject: (e: Error) => void}
	>;
	#options: Required<Omit<WorkerPoolOptions, "cwd">> & {cwd?: string};
	#appEntrypoint: string;
	#cacheStorage?: CacheStorage & {
		handleMessage?: (worker: Worker, message: any) => Promise<void>;
	};
	// Waiters for when workers become available (used during reload)
	#workerAvailableWaiters: Array<{
		resolve: () => void;
		reject: (error: Error) => void;
	}>;

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
		const worker = await createWebWorker(entrypoint);

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
				}
				break;
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
			pending.resolve(response);
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
	async handleRequest(request: Request): Promise<Response> {
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
			logger.debug("All workers reloaded", {entrypoint});
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
