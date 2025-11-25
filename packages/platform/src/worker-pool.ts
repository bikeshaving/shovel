/**
 * @b9g/platform/worker-pool - ServiceWorker pool implementation
 *
 * Manages a pool of workers that run the ServiceWorker runtime.
 * Handles worker lifecycle, message passing, and request routing.
 */

import * as Path from "path";
import {existsSync} from "fs";
import {getLogger} from "@logtape/logtape";

// Runtime global declarations
declare const Deno: any;

const logger = getLogger(["worker"]);

// ============================================================================
// Worker Message Types
// ============================================================================

// NOTE: WorkerPoolOptions is exported for platform implementations
// Message types are exported for use by runtime.ts
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

export interface WorkerLoadMessage extends WorkerMessage {
	type: "load";
	version: number | string;
	entrypoint?: string;
}

export interface WorkerReadyMessage extends WorkerMessage {
	type: "ready" | "worker-ready";
	version?: number | string;
}

export interface WorkerErrorMessage extends WorkerMessage {
	type: "error";
	error: string;
	stack?: string;
	requestID?: number;
}

export interface WorkerInitMessage extends WorkerMessage {
	type: "init";
	config: any; // ShovelConfig from config.ts
}

export interface WorkerInitializedMessage extends WorkerMessage {
	type: "initialized";
}

/**
 * Resolve the worker script path for the current platform
 */
function resolveWorkerScript(entrypoint?: string): string {
	// Try to find bundled worker.js relative to app entrypoint first
	if (entrypoint) {
		const entryDir = Path.dirname(entrypoint);
		const bundledWorker = Path.join(entryDir, "worker.js");

		// Check if bundled worker exists (production)
		try {
			// Use platform-specific file existence check
			if (typeof Bun !== "undefined") {
				// Bun has synchronous file operations
				const file = Bun.file(bundledWorker);
				if (file.size > 0) {
					logger.info("Using bundled worker", {bundledWorker});
					return bundledWorker;
				}
			} else if (typeof require !== "undefined") {
				// Node.js - use existsSync
				if (existsSync(bundledWorker)) {
					logger.info("Using bundled worker", {bundledWorker});
					return bundledWorker;
				}
			}
		} catch {
			// Fall through to package resolution
		}
	}

	// Fallback to package resolution for development
	try {
		// Use import.meta.resolve for runtime script (contains bootstrap code)
		const workerURL = import.meta.resolve("@b9g/platform/runtime.js");
		let workerScript: string;

		if (workerURL.startsWith("file://")) {
			// Convert file:// URL to path for Worker constructor
			workerScript = workerURL.slice(7); // Remove 'file://' prefix
		} else {
			workerScript = workerURL;
		}

		logger.info("Using worker runtime script", {workerScript});
		return workerScript;
	} catch (error) {
		const bundledPath = entrypoint
			? Path.join(Path.dirname(entrypoint), "runtime.js")
			: "runtime.js";
		throw new Error(
			`Could not resolve runtime.js. Checked bundled path: ${bundledPath} and package: @b9g/platform/runtime.js. Error: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
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
 * Handles HTTP request/response routing, cache coordination, and hot reloading
 */
export class ServiceWorkerPool {
	#workers: Worker[];
	#currentWorker: number;
	#requestID: number;
	#pendingRequests: Map<
		number,
		{resolve: (response: Response) => void; reject: (error: Error) => void}
	>;
	#pendingWorkerInit: Map<
		Worker,
		{
			workerReady?: () => void;
			initialized?: () => void;
		}
	>;
	#options: Required<Omit<WorkerPoolOptions, "cwd">> & {cwd?: string};
	#appEntrypoint?: string;
	#cacheStorage?: CacheStorage & {
		handleMessage?: (worker: Worker, message: any) => Promise<void>;
	}; // CustomCacheStorage for cache coordination
	#config: any; // ShovelConfig from config.ts

	constructor(
		options: WorkerPoolOptions = {},
		appEntrypoint?: string,
		cacheStorage?: CacheStorage,
		config?: any,
	) {
		this.#workers = [];
		this.#currentWorker = 0;
		this.#requestID = 0;
		this.#pendingRequests = new Map();
		this.#pendingWorkerInit = new Map();
		this.#appEntrypoint = appEntrypoint;
		this.#cacheStorage = cacheStorage;
		this.#config = config || {};
		this.#options = {
			workerCount: 1,
			requestTimeout: 30000,
			...options,
		};

		// Workers will be initialized by calling init() after construction
	}

	/**
	 * Initialize workers (must be called after construction)
	 */
	async init(): Promise<void> {
		await this.#initWorkers();
	}

	async #initWorkers() {
		for (let i = 0; i < this.#options.workerCount; i++) {
			await this.#createWorker();
		}
	}

	async #createWorker(): Promise<Worker> {
		const workerScript = resolveWorkerScript(this.#appEntrypoint);
		const worker = await createWebWorker(workerScript);

		// Create promises for worker initialization steps
		const workerReadyPromise = new Promise<void>((resolve) => {
			this.#pendingWorkerInit.set(worker, {
				workerReady: resolve,
			});
		});

		// Set up event listeners using web standards
		worker.addEventListener("message", (event) => {
			this.#handleWorkerMessage(worker, event.data || event);
		});

		worker.addEventListener("error", (event: any) => {
			logger.error("Worker error", {
				message: event.message || event.error?.message,
				filename: event.filename,
				lineno: event.lineno,
				colno: event.colno,
				error: event.error,
				stack: event.error?.stack,
			});
		});

		this.#workers.push(worker);

		// Wait for worker-ready signal
		logger.info("Waiting for worker-ready signal");
		await workerReadyPromise;
		logger.info("Received worker-ready signal");

		// Create promise for initialized response
		const initializedPromise = new Promise<void>((resolve) => {
			const pending = this.#pendingWorkerInit.get(worker) || {};
			pending.initialized = resolve;
			this.#pendingWorkerInit.set(worker, pending);
		});

		// Send init message with config
		const initMessage: WorkerInitMessage = {
			type: "init",
			config: this.#config,
		};
		logger.info("Sending init message", {config: this.#config});
		worker.postMessage(initMessage);
		logger.info("Sent init message, waiting for initialized response");

		// Wait for initialized response
		await initializedPromise;
		logger.info("Received initialized response");

		// Clean up pending init promises
		this.#pendingWorkerInit.delete(worker);

		return worker;
	}

	#handleWorkerMessage(worker: Worker, message: WorkerMessage) {
		logger.debug("Worker message received", {type: message.type});

		// Handle worker initialization messages
		const pending = this.#pendingWorkerInit.get(worker);
		if (message.type === "worker-ready" && pending?.workerReady) {
			pending.workerReady();
			// Don't return - also pass to #handleReady
		} else if (message.type === "initialized" && pending?.initialized) {
			pending.initialized();
			return; // Early return for initialized
		}

		switch (message.type) {
			case "response":
				this.#handleResponse(message as WorkerResponse);
				break;
			case "error":
				this.#handleError(message as WorkerErrorMessage);
				break;
			case "ready":
			case "worker-ready":
				this.#handleReady(message as WorkerReadyMessage);
				break;
			case "initialized":
				// Already handled above
				break;
			default:
				// Handle cache messages from PostMessageCache
				if (message.type?.startsWith("cache:")) {
					logger.debug("Cache message detected", {
						type: message.type,
						hasStorage: !!this.#cacheStorage,
					});

					if (this.#cacheStorage) {
						// CustomCacheStorage has handleMessage method for PostMessage coordination
						const handleMessage = (this.#cacheStorage as any).handleMessage;
						logger.debug("handleMessage check", {
							hasMethod: typeof handleMessage === "function",
						});

						if (typeof handleMessage === "function") {
							logger.debug("Calling handleMessage");
							void handleMessage.call(this.#cacheStorage, worker, message);
						}
					}
				}
				break;
		}
	}

	#handleResponse(message: WorkerResponse) {
		const pending = this.#pendingRequests.get(message.requestID);
		if (pending) {
			// Reconstruct Response object from transferred ArrayBuffer (zero-copy)
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
		// Always log error details for debugging
		logger.error("Worker error message received", {
			error: message.error,
			stack: message.stack,
			requestID: message.requestID,
		});

		if (message.requestID) {
			const pending = this.#pendingRequests.get(message.requestID);
			if (pending) {
				pending.reject(new Error(message.error));
				this.#pendingRequests.delete(message.requestID);
			}
		} else {
			logger.error("Worker error", {error: message.error});
		}
	}

	#handleReady(message: WorkerReadyMessage) {
		if (message.type === "ready") {
			logger.info("ServiceWorker ready", {version: message.version});
		} else if (message.type === "worker-ready") {
			logger.info("Worker initialized", {});
		}
	}

	/**
	 * Handle HTTP request using round-robin worker selection
	 */
	async handleRequest(request: Request): Promise<Response> {
		// Round-robin worker selection
		const worker = this.#workers[this.#currentWorker];
		logger.info("Dispatching to worker", {
			workerIndex: this.#currentWorker + 1,
			totalWorkers: this.#workers.length,
		});
		this.#currentWorker = (this.#currentWorker + 1) % this.#workers.length;

		const requestID = ++this.#requestID;

		return new Promise((resolve, reject) => {
			// Track pending request
			this.#pendingRequests.set(requestID, {resolve, reject});

			// Start async work without blocking promise executor
			this.#sendRequest(worker, request, requestID).catch(reject);

			// Timeout handling
			setTimeout(() => {
				if (this.#pendingRequests.has(requestID)) {
					this.#pendingRequests.delete(requestID);
					reject(new Error("Request timeout"));
				}
			}, this.#options.requestTimeout);
		});
	}

	/**
	 * Send request to worker (async helper to avoid async promise executor)
	 */
	async #sendRequest(
		worker: Worker,
		request: Request,
		requestID: number,
	): Promise<void> {
		// Read request body as ArrayBuffer for zero-copy transfer
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

		// Transfer the body ArrayBuffer if present (zero-copy)
		if (body) {
			worker.postMessage(workerRequest, [body]);
		} else {
			worker.postMessage(workerRequest);
		}
	}

	/**
	 * Reload ServiceWorker with new version (hot reload simulation)
	 */
	async reloadWorkers(version: number | string = Date.now()): Promise<void> {
		logger.info("Reloading ServiceWorker", {version});

		const loadPromises = this.#workers.map((worker) => {
			return new Promise<void>((resolve, reject) => {
				let timeoutId: NodeJS.Timeout | undefined;

				const cleanup = () => {
					worker.removeEventListener("message", handleReady);
					worker.removeEventListener("error", handleError);
					if (timeoutId) {
						clearTimeout(timeoutId);
					}
				};

				const handleReady = (event: any) => {
					const message = event.data || event;
					if (message.type === "ready" && message.version === version) {
						cleanup();
						resolve();
					}
				};

				const handleError = (error: any) => {
					cleanup();
					// Extract error message from ErrorEvent or Error object
					const errorMsg =
						error?.error?.message || error?.message || JSON.stringify(error);
					reject(new Error(`Worker failed to load ServiceWorker: ${errorMsg}`));
				};

				// Timeout after 30 seconds if worker doesn't respond (allows time for activate event processing)
				timeoutId = setTimeout(() => {
					cleanup();
					reject(
						new Error(
							`Worker failed to load ServiceWorker within 30000ms (version ${version})`,
						),
					);
				}, 30000);

				logger.info("Sending load message", {
					version,
					entrypoint: this.#appEntrypoint,
				});

				worker.addEventListener("message", handleReady);
				worker.addEventListener("error", handleError);

				const loadMessage: WorkerLoadMessage = {
					type: "load",
					version,
					entrypoint: this.#appEntrypoint,
				};

				logger.debug("[WorkerPool] Sending load message", {
					entrypoint: this.#appEntrypoint,
					version,
				});
				worker.postMessage(loadMessage);
			});
		});

		await Promise.all(loadPromises);
		logger.info("All workers reloaded", {version});
	}

	/**
	 * Graceful shutdown of all workers
	 */
	async terminate(): Promise<void> {
		const terminatePromises = this.#workers.map((worker) => worker.terminate());
		// allSettled won't hang - it waits for all promises to settle (resolve or reject)
		await Promise.allSettled(terminatePromises);
		this.#workers = [];
		this.#pendingRequests.clear();
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
