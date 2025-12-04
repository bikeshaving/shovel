/**
 * @b9g/platform/multi-threaded - Multi-threaded ServiceWorker runtime
 *
 * Spawns worker threads to run ServiceWorker code in parallel.
 * Used when workerCount > 1 for CPU parallelism.
 */

import * as Path from "path";
import {existsSync} from "fs";
import {getLogger} from "@logtape/logtape";
// Config type - just needs to be passable to workers
type ShovelConfig = Record<string, unknown>;

// Runtime global declarations
declare const Deno: any;

const logger = getLogger(["multi-threaded"]);

// ============================================================================
// Common Interface
// ============================================================================

/**
 * Common interface for ServiceWorker runtimes
 * Both SingleThreadedRuntime and MultiThreadedRuntime implement this
 */
export interface ServiceWorkerRuntime {
	/** Initialize the runtime */
	init(): Promise<void>;
	/** Load (or reload) a ServiceWorker entrypoint */
	load(entrypoint: string): Promise<void>;
	/** Handle an HTTP request */
	handleRequest(request: Request): Promise<Response>;
	/** Graceful shutdown */
	terminate(): Promise<void>;
	/** Number of workers (1 for single-threaded) */
	readonly workerCount: number;
	/** Whether the runtime is ready to handle requests */
	readonly ready: boolean;
}

// ============================================================================
// Worker Message Types
// ============================================================================

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
		body?: ArrayBuffer | null;
	};
	requestID: number;
}

export interface WorkerResponse extends WorkerMessage {
	type: "response";
	response: {
		status: number;
		statusText: string;
		headers: Record<string, string>;
		body: ArrayBuffer;
	};
	requestID: number;
}

export interface WorkerLoadMessage extends WorkerMessage {
	type: "load";
	entrypoint: string;
}

export interface WorkerReadyMessage extends WorkerMessage {
	type: "ready" | "worker-ready";
	entrypoint?: string;
}

export interface WorkerErrorMessage extends WorkerMessage {
	type: "error";
	error: string;
	stack?: string;
	requestID?: number;
}

export interface WorkerInitMessage extends WorkerMessage {
	type: "init";
	config: any;
	baseDir: string;
}

export interface WorkerInitializedMessage extends WorkerMessage {
	type: "initialized";
}

// ============================================================================
// Runtime Options
// ============================================================================

export interface MultiThreadedRuntimeOptions {
	/** Number of workers in the pool (default: 1) */
	workerCount?: number;
	/** Request timeout in milliseconds (default: 30000) */
	requestTimeout?: number;
	/** Base directory for bucket path resolution (entrypoint directory) - REQUIRED */
	baseDir: string;
	/** Optional pre-created cache storage (for sharing across workers) */
	cacheStorage?: CacheStorage;
	/** Shovel configuration for bucket/cache settings */
	config?: ShovelConfig;
}

// ============================================================================
// Helper Functions
// ============================================================================

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
			if (typeof Bun !== "undefined") {
				const file = Bun.file(bundledWorker);
				if (file.size > 0) {
					logger.info("Using bundled worker", {bundledWorker});
					return bundledWorker;
				}
			} else if (typeof require !== "undefined") {
				if (existsSync(bundledWorker)) {
					logger.info("Using bundled worker", {bundledWorker});
					return bundledWorker;
				}
			}
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
				throw err;
			}
		}
	}

	// Fallback to package resolution for development
	try {
		const workerURL = import.meta.resolve("@b9g/platform/worker.js");
		let workerScript: string;

		if (workerURL.startsWith("file://")) {
			workerScript = workerURL.slice(7);
		} else {
			workerScript = workerURL;
		}

		logger.info("Using worker entry script", {workerScript});
		return workerScript;
	} catch (error) {
		const bundledPath = entrypoint
			? Path.join(Path.dirname(entrypoint), "worker.js")
			: "worker.js";
		throw new Error(
			`Could not resolve worker.js. Checked bundled path: ${bundledPath} and package: @b9g/platform/worker.js. Error: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

/**
 * Create a web-standard Worker with targeted Node.js fallback
 */
async function createWebWorker(workerScript: string): Promise<Worker> {
	if (typeof Worker !== "undefined") {
		return new Worker(workerScript, {type: "module"} as WorkerOptions);
	}

	const isNodeJs = typeof process !== "undefined" && process.versions?.node;

	if (isNodeJs) {
		try {
			const {Worker: NodeWebWorker} = await import("@b9g/node-webworker");
			logger.info("Using @b9g/node-webworker shim for Node.js", {});
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

// ============================================================================
// MultiThreadedRuntime
// ============================================================================

/**
 * Multi-threaded ServiceWorker runtime
 *
 * Spawns worker threads and routes requests using round-robin selection.
 * Implements the same interface as SingleThreadedRuntime.
 */
export class MultiThreadedRuntime implements ServiceWorkerRuntime {
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
	#options: {
		workerCount: number;
		requestTimeout: number;
		baseDir: string;
	};
	#entrypoint?: string;
	#cacheStorage?: CacheStorage & {
		handleMessage?: (worker: Worker, message: any) => Promise<void>;
	};
	#config?: ShovelConfig;
	#ready: boolean;

	constructor(options: MultiThreadedRuntimeOptions) {
		this.#workers = [];
		this.#currentWorker = 0;
		this.#requestID = 0;
		this.#pendingRequests = new Map();
		this.#pendingWorkerInit = new Map();
		this.#cacheStorage = options.cacheStorage;
		this.#config = options.config;
		this.#ready = false;
		this.#options = {
			workerCount: options.workerCount ?? 2,
			requestTimeout: options.requestTimeout ?? 30000,
			baseDir: options.baseDir,
		};

		logger.info("MultiThreadedRuntime created", {
			workerCount: this.#options.workerCount,
			baseDir: options.baseDir,
		});
	}

	/**
	 * Initialize workers (must be called after construction)
	 */
	async init(): Promise<void> {
		for (let i = 0; i < this.#options.workerCount; i++) {
			await this.#createWorker();
		}
		logger.info("MultiThreadedRuntime initialized", {
			workerCount: this.#workers.length,
		});
	}

	async #createWorker(): Promise<Worker> {
		const workerScript = resolveWorkerScript(this.#entrypoint);
		const worker = await createWebWorker(workerScript);

		const workerReadyPromise = new Promise<void>((resolve) => {
			this.#pendingWorkerInit.set(worker, {workerReady: resolve});
		});

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

		logger.info("Waiting for worker-ready signal");
		await workerReadyPromise;
		logger.info("Received worker-ready signal");

		const initializedPromise = new Promise<void>((resolve) => {
			const pending = this.#pendingWorkerInit.get(worker) || {};
			pending.initialized = resolve;
			this.#pendingWorkerInit.set(worker, pending);
		});

		const initMessage: WorkerInitMessage = {
			type: "init",
			config: this.#config,
			baseDir: this.#options.baseDir,
		};
		logger.info("Sending init message", {
			config: this.#config,
			baseDir: this.#options.baseDir,
		});
		worker.postMessage(initMessage);

		await initializedPromise;
		logger.info("Received initialized response");

		this.#pendingWorkerInit.delete(worker);
		return worker;
	}

	#handleWorkerMessage(worker: Worker, message: WorkerMessage) {
		logger.debug("Worker message received", {type: message.type});

		const pending = this.#pendingWorkerInit.get(worker);
		if (message.type === "worker-ready" && pending?.workerReady) {
			pending.workerReady();
		} else if (message.type === "initialized" && pending?.initialized) {
			pending.initialized();
			return;
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
				break;
			default:
				if (message.type?.startsWith("cache:")) {
					logger.debug("Cache message detected", {
						type: message.type,
						hasStorage: !!this.#cacheStorage,
					});

					if (this.#cacheStorage) {
						const handleMessage = (this.#cacheStorage as any).handleMessage;
						if (typeof handleMessage === "function") {
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
			logger.error("Worker error: {error}", {error: message.error});
		}
	}

	#handleReady(message: WorkerReadyMessage) {
		if (message.type === "ready") {
			logger.info("ServiceWorker ready", {entrypoint: message.entrypoint});
			this.#ready = true;
		} else if (message.type === "worker-ready") {
			logger.info("Worker initialized", {});
		}
	}

	/**
	 * Load (or reload) a ServiceWorker entrypoint
	 */
	async load(entrypoint: string): Promise<void> {
		logger.info("Loading ServiceWorker", {entrypoint});

		this.#entrypoint = entrypoint;
		this.#ready = false;

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
					if (message.type === "ready" && message.entrypoint === entrypoint) {
						cleanup();
						resolve();
					} else if (message.type === "error") {
						cleanup();
						reject(
							new Error(
								`Worker failed to load ServiceWorker: ${message.error}`,
							),
						);
					}
				};

				const handleError = (error: any) => {
					cleanup();
					const errorMsg =
						error?.error?.message || error?.message || JSON.stringify(error);
					reject(new Error(`Worker failed to load ServiceWorker: ${errorMsg}`));
				};

				timeoutId = setTimeout(() => {
					cleanup();
					reject(
						new Error(
							`Worker failed to load ServiceWorker within 30000ms (entrypoint ${entrypoint})`,
						),
					);
				}, 30000);

				worker.addEventListener("message", handleReady);
				worker.addEventListener("error", handleError);

				const loadMessage: WorkerLoadMessage = {
					type: "load",
					entrypoint,
				};
				worker.postMessage(loadMessage);
			});
		});

		await Promise.all(loadPromises);
		this.#ready = true;
		logger.info("All workers loaded", {entrypoint});
	}

	/**
	 * Handle HTTP request using round-robin worker selection
	 */
	async handleRequest(request: Request): Promise<Response> {
		if (!this.#ready) {
			throw new Error(
				"MultiThreadedRuntime not ready - ServiceWorker not loaded",
			);
		}

		const worker = this.#workers[this.#currentWorker];
		logger.debug("Dispatching to worker", {
			workerIndex: this.#currentWorker + 1,
			totalWorkers: this.#workers.length,
		});
		this.#currentWorker = (this.#currentWorker + 1) % this.#workers.length;

		const requestID = ++this.#requestID;

		return new Promise((resolve, reject) => {
			this.#pendingRequests.set(requestID, {resolve, reject});

			this.#sendRequest(worker, request, requestID).catch(reject);

			setTimeout(() => {
				if (this.#pendingRequests.has(requestID)) {
					this.#pendingRequests.delete(requestID);
					reject(new Error("Request timeout"));
				}
			}, this.#options.requestTimeout);
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
	 * Graceful shutdown of all workers
	 */
	async terminate(): Promise<void> {
		const terminatePromises = this.#workers.map((worker) => worker.terminate());
		await Promise.allSettled(terminatePromises);
		this.#workers = [];
		this.#pendingRequests.clear();
		this.#ready = false;
		logger.info("MultiThreadedRuntime terminated");
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
		return this.#ready;
	}
}
