/**
 * @b9g/platform/single-threaded - Single-threaded ServiceWorker runtime
 *
 * Runs ServiceWorker code directly in the main thread without spawning workers.
 * Used when workerCount === 1 for maximum performance (no postMessage overhead).
 *
 * This module is BROWSER-SAFE - no fs/path/config imports.
 */

import {getLogger} from "@logtape/logtape";
import {
	ServiceWorkerGlobals,
	ShovelServiceWorkerRegistration,
} from "./runtime.js";
import type {BucketStorage} from "@b9g/filesystem";

const logger = getLogger(["single-threaded"]);

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

export interface SingleThreadedRuntimeOptions {
	/** Cache storage for the runtime */
	caches: CacheStorage;
	/** Bucket storage for the runtime */
	buckets: BucketStorage;
}

/**
 * Single-threaded ServiceWorker runtime
 *
 * Runs ServiceWorker code directly in the main thread.
 * Implements ServiceWorkerRuntime interface for interchangeability with MultiThreadedRuntime.
 */
export class SingleThreadedRuntime implements ServiceWorkerRuntime {
	#registration: ShovelServiceWorkerRegistration;
	#scope: ServiceWorkerGlobals;
	#ready: boolean;
	#entrypoint?: string;

	constructor(options: SingleThreadedRuntimeOptions) {
		this.#ready = false;

		// Create registration and scope
		this.#registration = new ShovelServiceWorkerRegistration();
		this.#scope = new ServiceWorkerGlobals({
			registration: this.#registration,
			caches: options.caches,
			buckets: options.buckets,
		});

		logger.info("SingleThreadedRuntime created");
	}

	/**
	 * Initialize the runtime (install ServiceWorker globals)
	 */
	async init(): Promise<void> {
		// Install ServiceWorker globals (caches, buckets, fetch, addEventListener, etc.)
		this.#scope.install();
		logger.info("SingleThreadedRuntime initialized - globals installed");
	}

	/**
	 * Load (or reload) a ServiceWorker entrypoint
	 * @param entrypoint - Path to the entrypoint file (content-hashed filename)
	 */
	async load(entrypoint: string): Promise<void> {
		const isReload = this.#entrypoint !== undefined;

		if (isReload) {
			logger.info("Reloading ServiceWorker", {
				oldEntrypoint: this.#entrypoint,
				newEntrypoint: entrypoint,
			});
			// Reset registration state for reload
			this.#registration._serviceWorker._setState("parsed");
		} else {
			logger.info("Loading ServiceWorker entrypoint", {entrypoint});
		}

		this.#entrypoint = entrypoint;
		this.#ready = false;

		// Import the user's ServiceWorker code
		// Filename is content-hashed, so fresh import is guaranteed on reload
		await import(entrypoint);

		// Run lifecycle events
		await this.#registration.install();
		await this.#registration.activate();

		this.#ready = true;
		logger.info("ServiceWorker loaded and activated", {entrypoint});
	}

	/**
	 * Handle an HTTP request
	 * This is the key method - direct call, no postMessage!
	 */
	async handleRequest(request: Request): Promise<Response> {
		if (!this.#ready) {
			throw new Error(
				"SingleThreadedRuntime not ready - ServiceWorker not loaded",
			);
		}

		// Direct call to registration.handleRequest - no serialization, no postMessage
		return this.#registration.handleRequest(request);
	}

	/**
	 * Graceful shutdown
	 */
	async terminate(): Promise<void> {
		this.#ready = false;
		logger.info("SingleThreadedRuntime terminated");
	}

	/**
	 * Get the number of workers (always 1 for single-threaded)
	 */
	get workerCount(): number {
		return 1;
	}

	/**
	 * Check if ready to handle requests
	 */
	get ready(): boolean {
		return this.#ready;
	}
}
