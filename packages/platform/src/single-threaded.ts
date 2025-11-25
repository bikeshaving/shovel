/**
 * @b9g/platform/single-threaded - Single-threaded ServiceWorker runtime
 *
 * Runs ServiceWorker code directly in the main thread without spawning workers.
 * Used when workerCount === 1 for maximum performance (no postMessage overhead).
 */

import {getLogger} from "@logtape/logtape";
import {ShovelGlobalScope, ShovelServiceWorkerRegistration} from "./runtime.js";
import {CustomBucketStorage} from "@b9g/filesystem";
import type {ProcessedShovelConfig} from "./config.js";

const logger = getLogger(["single-threaded"]);

export interface SingleThreadedRuntimeOptions {
	/** Cache storage instance */
	cacheStorage: CacheStorage;
	/** Bucket storage instance (optional) */
	bucketStorage?: CustomBucketStorage;
	/** Shovel configuration (optional) */
	config?: ProcessedShovelConfig;
}

/**
 * Single-threaded ServiceWorker runtime
 *
 * Provides the same interface as ServiceWorkerPool but runs everything
 * in the main thread for zero postMessage overhead.
 */
export class SingleThreadedRuntime {
	#registration: ShovelServiceWorkerRegistration;
	#scope: ShovelGlobalScope;
	#ready = false;
	#entrypoint?: string;
	#config?: ProcessedShovelConfig;

	constructor(options: SingleThreadedRuntimeOptions) {
		this.#config = options.config;

		// Create registration and scope
		this.#registration = new ShovelServiceWorkerRegistration();
		this.#scope = new ShovelGlobalScope({
			registration: this.#registration,
			caches: options.cacheStorage,
			buckets: options.bucketStorage,
		});

		logger.info("SingleThreadedRuntime created");
	}

	/**
	 * Initialize the runtime (install scope as globalThis.self)
	 */
	async init(): Promise<void> {
		// Install scope as globalThis.self, addEventListener, etc.
		this.#scope.install();
		logger.info("SingleThreadedRuntime initialized - scope installed");
	}

	/**
	 * Load and run a ServiceWorker entrypoint
	 */
	async reloadWorkers(version?: number | string): Promise<void> {
		if (!this.#entrypoint) {
			throw new Error("No entrypoint set - call loadEntrypoint first");
		}

		logger.info("Reloading ServiceWorker", {version, entrypoint: this.#entrypoint});

		// For single-threaded mode, we need to re-import the module
		// ESM doesn't support cache invalidation, so use query string
		const importPath = version
			? `${this.#entrypoint}?v=${version}`
			: this.#entrypoint;

		// Reset registration state for reload
		this.#registration._serviceWorker._setState("parsed");
		this.#ready = false;

		// Import the user's ServiceWorker code
		await import(importPath);

		// Run lifecycle events
		await this.#registration.install();
		await this.#registration.activate();

		this.#ready = true;
		logger.info("ServiceWorker loaded and activated", {version});
	}

	/**
	 * Load a ServiceWorker entrypoint for the first time
	 */
	async loadEntrypoint(entrypoint: string, version?: number | string): Promise<void> {
		this.#entrypoint = entrypoint;

		logger.info("Loading ServiceWorker entrypoint", {entrypoint, version});

		// Import the user's ServiceWorker code
		// The import will call self.addEventListener("fetch", ...) which registers on our scope
		const importPath = version
			? `${entrypoint}?v=${version}`
			: entrypoint;
		await import(importPath);

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
			throw new Error("SingleThreadedRuntime not ready - ServiceWorker not loaded");
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
