/**
 * Common WorkerPool abstraction based on web standards
 * Provides platform-agnostic worker management for ServiceWorker execution
 */

import {CustomCacheStorage} from "@b9g/cache";
import * as Path from "path";

export interface WorkerPoolOptions {
	/** Number of workers in the pool (default: 1) */
	workerCount?: number;
	/** Request timeout in milliseconds (default: 30000) */
	requestTimeout?: number;
	/** Enable hot reloading (default: true in development) */
	hotReload?: boolean;
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
		body?: any;
	};
	requestId: number;
}

export interface WorkerResponse extends WorkerMessage {
	type: "response";
	response: {
		status: number;
		statusText: string;
		headers: Record<string, string>;
		body: string;
	};
	requestId: number;
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
	requestId?: number;
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
					console.debug(`[WorkerPool] Using bundled worker: ${bundledWorker}`);
					return bundledWorker;
				}
			} else if (typeof require !== "undefined") {
				// Node.js - use fs.existsSync
				const fs = require("fs");
				if (fs.existsSync(bundledWorker)) {
					console.debug(`[WorkerPool] Using bundled worker: ${bundledWorker}`);
					return bundledWorker;
				}
			}
		} catch {
			// Fall through to package resolution
		}
	}

	// Fallback to package resolution for development
	try {
		// Use import.meta.resolve for web-worker compatible script
		const workerUrl = import.meta.resolve("@b9g/platform/worker-web.js");
		let workerScript: string;

		if (workerUrl.startsWith("file://")) {
			// Convert file:// URL to path for Worker constructor
			workerScript = workerUrl.slice(7); // Remove 'file://' prefix
		} else {
			workerScript = workerUrl;
		}

		console.debug(
			`[WorkerPool] Using Web Worker-compatible script: ${workerScript}`,
		);
		return workerScript;
	} catch (error) {
		const bundledPath = entrypoint
			? Path.join(Path.dirname(entrypoint), "worker-web.js")
			: "worker-web.js";
		throw new Error(
			`Could not resolve worker-web.js. Checked bundled path: ${bundledPath} and package: @b9g/platform/worker-web.js. Error: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

/**
 * Create a web-standard Worker with targeted Node.js fallback
 */
async function createWebWorker(workerScript: string): Promise<Worker> {
	// Try native Web Worker API first (works in Bun, Deno, browsers)
	if (typeof Worker !== "undefined") {
		return new Worker(workerScript, {type: "module"});
	}

	// Only try shim for Node.js (which lacks native Worker support)
	const isNodeJs = typeof process !== "undefined" && process.versions?.node;

	if (isNodeJs) {
		// Try to dynamically import our own Node.js shim
		try {
			const {Worker: NodeWebWorker} = await import("@b9g/node-webworker");
			console.debug("[WorkerPool] Using @b9g/node-webworker shim for Node.js");
			return new NodeWebWorker(workerScript, {type: "module"});
		} catch (shimError) {
			console.error(
				"\n❌ MISSING WEB STANDARD: Node.js lacks native Web Worker support",
			);
			console.error(
				"🔗 CANONICAL ISSUE: https://github.com/nodejs/node/issues/43583",
			);
			console.error(
				"💬 This is a basic web standard from 2009 - help push for implementation!",
			);
			console.error(
				"🗳️  Please 👍 react and comment on the issue to show demand\n",
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
 * Common WorkerPool implementation based on web standards
 * Provides round-robin request handling, hot reloading, and cache coordination
 */
export class WorkerPool {
	private workers: Worker[] = [];
	private currentWorker = 0;
	private requestId = 0;
	private pendingRequests = new Map<
		number,
		{resolve: (response: Response) => void; reject: (error: Error) => void}
	>();
	private options: Required<WorkerPoolOptions>;
	private cacheStorage: CustomCacheStorage;
	private appEntrypoint?: string;

	constructor(
		cacheStorage: CustomCacheStorage,
		options: WorkerPoolOptions = {},
		appEntrypoint?: string,
	) {
		this.cacheStorage = cacheStorage;
		this.appEntrypoint = appEntrypoint;
		this.options = {
			workerCount: 1,
			requestTimeout: 30000,
			hotReload: process.env.NODE_ENV !== "production",
			cwd: process.cwd(),
			...options,
		};

		// Workers will be initialized by calling init() after construction
	}

	/**
	 * Initialize workers (must be called after construction)
	 */
	async init(): Promise<void> {
		await this.initWorkers();
	}

	private async initWorkers() {
		for (let i = 0; i < this.options.workerCount; i++) {
			await this.createWorker();
		}
	}

	private async createWorker(): Promise<Worker> {
		const workerScript = resolveWorkerScript(this.appEntrypoint);
		const worker = await createWebWorker(workerScript);

		// Set up event listeners using web standards
		worker.addEventListener("message", (event) => {
			this.handleWorkerMessage(event.data || event);
		});

		worker.addEventListener("error", (error) => {
			console.error("[WorkerPool] Worker error:", error);
		});

		this.workers.push(worker);
		return worker;
	}

	private handleWorkerMessage(message: WorkerMessage) {
		// Handle cache operations (delegated to cache storage)
		if (message.type?.startsWith("cache:")) {
			// Cache operations are handled by platform-specific cache managers
			// This provides a hook for platforms to handle cache coordination
			this.handleCacheMessage(message);
			return;
		}

		// Handle standard worker messages
		switch (message.type) {
			case "response":
				this.handleResponse(message as WorkerResponse);
				break;
			case "error":
				this.handleError(message as WorkerErrorMessage);
				break;
			case "ready":
			case "worker-ready":
				this.handleReady(message as WorkerReadyMessage);
				break;
			default:
				console.warn("[WorkerPool] Unknown message type:", message.type);
		}
	}

	private handleResponse(message: WorkerResponse) {
		const pending = this.pendingRequests.get(message.requestId);
		if (pending) {
			// Reconstruct Response object from serialized data
			const response = new Response(message.response.body, {
				status: message.response.status,
				statusText: message.response.statusText,
				headers: message.response.headers,
			});
			pending.resolve(response);
			this.pendingRequests.delete(message.requestId);
		}
	}

	private handleError(message: WorkerErrorMessage) {
		if (message.requestId) {
			const pending = this.pendingRequests.get(message.requestId);
			if (pending) {
				pending.reject(new Error(message.error));
				this.pendingRequests.delete(message.requestId);
			}
		} else {
			console.error("[WorkerPool] Worker error:", message.error);
		}
	}

	private handleReady(message: WorkerReadyMessage) {
		if (message.type === "ready") {
			console.info(`[WorkerPool] ServiceWorker ready (v${message.version})`);
		} else if (message.type === "worker-ready") {
			console.info("[WorkerPool] Worker initialized");
		}
	}

	/**
	 * Platform-specific cache message handling
	 * Override this method in platform implementations for custom cache coordination
	 */
	protected handleCacheMessage(message: WorkerMessage): void {
		// Default implementation - no-op
		// Platform implementations can override this for cache coordination
	}

	/**
	 * Handle HTTP request using round-robin worker selection
	 */
	async handleRequest(request: Request): Promise<Response> {
		// Round-robin worker selection
		const worker = this.workers[this.currentWorker];
		console.info(
			`[WorkerPool] Dispatching to worker ${this.currentWorker + 1} of ${this.workers.length}`,
		);
		this.currentWorker = (this.currentWorker + 1) % this.workers.length;

		const requestId = ++this.requestId;

		return new Promise((resolve, reject) => {
			// Track pending request
			this.pendingRequests.set(requestId, {resolve, reject});

			// Serialize request for worker (can't clone Request objects across threads)
			const workerRequest: WorkerRequest = {
				type: "request",
				request: {
					url: request.url,
					method: request.method,
					headers: Object.fromEntries(request.headers.entries()),
					body: request.body,
				},
				requestId,
			};

			worker.postMessage(workerRequest);

			// Timeout handling
			setTimeout(() => {
				if (this.pendingRequests.has(requestId)) {
					this.pendingRequests.delete(requestId);
					reject(new Error("Request timeout"));
				}
			}, this.options.requestTimeout);
		});
	}

	/**
	 * Reload ServiceWorker with new version (hot reload simulation)
	 */
	async reloadWorkers(version: number | string = Date.now()): Promise<void> {
		console.info(`[WorkerPool] Reloading ServiceWorker (v${version})`);

		const loadPromises = this.workers.map((worker) => {
			return new Promise<void>((resolve) => {
				const handleReady = (event: any) => {
					const message = event.data || event;
					if (message.type === "ready" && message.version === version) {
						worker.removeEventListener("message", handleReady);
						resolve();
					}
				};

				console.info("[WorkerPool] Sending load message:", {
					version,
					entrypoint: this.appEntrypoint,
				});

				worker.addEventListener("message", handleReady);

				const loadMessage: WorkerLoadMessage = {
					type: "load",
					version,
					entrypoint: this.appEntrypoint,
				};

				worker.postMessage(loadMessage);
			});
		});

		await Promise.all(loadPromises);
		console.info(`[WorkerPool] All workers reloaded (v${version})`);
	}

	/**
	 * Graceful shutdown of all workers
	 */
	async terminate(): Promise<void> {
		const terminatePromises = this.workers.map((worker) => worker.terminate());
		await Promise.allSettled(terminatePromises);
		this.workers = [];
		this.pendingRequests.clear();
	}

	/**
	 * Get the number of active workers
	 */
	get workerCount(): number {
		return this.workers.length;
	}

	/**
	 * Check if the pool is ready to handle requests
	 */
	get ready(): boolean {
		return this.workers.length > 0;
	}
}
