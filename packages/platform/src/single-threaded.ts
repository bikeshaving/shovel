/**
 * @b9g/platform/single-threaded - Single-threaded ServiceWorker runtime
 *
 * Runs ServiceWorker code directly in the main thread without spawning workers.
 * Used when workerCount === 1 for maximum performance (no postMessage overhead).
 */

import {getLogger} from "@logtape/logtape";
import {ShovelGlobalScope, ShovelServiceWorkerRegistration} from "./runtime.js";
import {CustomBucketStorage} from "@b9g/filesystem";
import {CustomCacheStorage} from "@b9g/cache";
import {
	configureLogging,
	createBucketFactory,
	createCacheFactory,
	type ProcessedShovelConfig,
} from "./config.js";

const logger = getLogger(["single-threaded"]);

export interface SingleThreadedRuntimeOptions {
	/** Base directory for bucket path resolution (entrypoint directory) - REQUIRED */
	baseDir: string;
	/** Optional pre-created cache storage (for sharing across reloads) */
	cacheStorage?: CacheStorage;
	/** Optional pre-created bucket storage */
	bucketStorage?: CustomBucketStorage;
	/** Shovel configuration for bucket/cache settings */
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
	#ready: boolean;
	#entrypoint?: string;
	#config?: ProcessedShovelConfig;

	constructor(options: SingleThreadedRuntimeOptions) {
		this.#ready = false;
		this.#config = options.config;

		// Create cache storage using factory if not provided
		const cacheStorage =
			options.cacheStorage ||
			new CustomCacheStorage(createCacheFactory({config: options.config}));

		// Create bucket storage using factory if not provided
		const bucketStorage =
			options.bucketStorage ||
			new CustomBucketStorage(
				createBucketFactory({baseDir: options.baseDir, config: options.config}),
			);

		// Create registration and scope
		this.#registration = new ShovelServiceWorkerRegistration();
		this.#scope = new ShovelGlobalScope({
			registration: this.#registration,
			caches: cacheStorage,
			buckets: bucketStorage,
		});

		logger.info("SingleThreadedRuntime created", {baseDir: options.baseDir});
	}

	/**
	 * Initialize the runtime (install scope as globalThis.self)
	 */
	async init(): Promise<void> {
		// Configure LogTape for this runtime using the shared config
		if (this.#config?.logging) {
			await configureLogging(this.#config.logging);
		}

		// Install scope as globalThis.self, addEventListener, etc.
		this.#scope.install();
		logger.info("SingleThreadedRuntime initialized - scope installed");
	}

	/**
	 * Load and run a ServiceWorker entrypoint
	 * @param entrypoint - Path to the new entrypoint (hashed filename for cache busting)
	 */
	async reloadWorkers(entrypoint: string): Promise<void> {
		logger.info("Reloading ServiceWorker", {
			oldEntrypoint: this.#entrypoint,
			newEntrypoint: entrypoint,
		});

		// Update the entrypoint to the new hashed filename
		this.#entrypoint = entrypoint;

		// Reset registration state for reload
		this.#registration._serviceWorker._setState("parsed");
		this.#ready = false;

		// Import the user's ServiceWorker code - filename is content-hashed
		// so the new file is guaranteed to be a fresh import (no cache issues)
		await import(entrypoint);

		// Run lifecycle events
		await this.#registration.install();
		await this.#registration.activate();

		this.#ready = true;
		logger.info("ServiceWorker loaded and activated", {entrypoint});
	}

	/**
	 * Load a ServiceWorker entrypoint for the first time
	 * @param entrypoint - Path to the entrypoint file (content-hashed filename)
	 */
	async loadEntrypoint(entrypoint: string): Promise<void> {
		this.#entrypoint = entrypoint;

		logger.info("Loading ServiceWorker entrypoint", {entrypoint});

		// Import the user's ServiceWorker code
		// The import will call self.addEventListener("fetch", ...) which registers on our scope
		// Filename is content-hashed, so no query string needed for cache busting
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
