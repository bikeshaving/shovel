/**
 * Worker Entry Point for MultiThreadedRuntime
 *
 * This is the explicit entry point for worker threads spawned by MultiThreadedRuntime.
 * It sets up message handling and initializes the ServiceWorker runtime.
 *
 * This file is loaded directly as a Worker script - no detection needed.
 */

import {getLogger} from "@logtape/logtape";
import {configureLogging, createBucketFactory, createCacheFactory} from "./config.js";
import {CustomBucketStorage} from "@b9g/filesystem";
import {CustomCacheStorage} from "@b9g/cache";
import type {BucketStorage} from "@b9g/filesystem";
import {
	ServiceWorkerGlobals,
	ShovelServiceWorkerRegistration,
} from "./runtime.js";
import type {
	WorkerMessage,
	WorkerInitMessage,
	WorkerLoadMessage,
	WorkerRequest,
	WorkerResponse,
	WorkerErrorMessage,
} from "./worker-pool.js";

const logger = getLogger(["worker"]);

// ============================================================================
// Worker State
// ============================================================================

const workerId = Math.random().toString(36).substring(2, 8);
let sendMessage: (message: WorkerMessage, transfer?: Transferable[]) => void;

// ServiceWorker runtime state - initialized via "init" message
let registration: ShovelServiceWorkerRegistration | null = null;
let scope: ServiceWorkerGlobals | null = null;
let caches: CacheStorage | undefined;
let buckets: BucketStorage | undefined;
let serviceWorkerReady = false;
let loadedEntrypoint: string | null = null;

// ============================================================================
// Message Handling
// ============================================================================

async function handleFetchEvent(request: Request): Promise<Response> {
	if (!serviceWorkerReady) {
		throw new Error("ServiceWorker not ready");
	}

	if (!registration) {
		throw new Error("ServiceWorker runtime not initialized");
	}

	try {
		const response = await registration.handleRequest(request);
		return response;
	} catch (error) {
		logger.error("[Worker] ServiceWorker request failed: {error}", {error});
		console.error("[Worker] ServiceWorker request failed:", error);
		return new Response("ServiceWorker request failed", {status: 500});
	}
}

async function loadServiceWorker(entrypoint: string): Promise<void> {
	try {
		logger.debug("loadServiceWorker called", {entrypoint, loadedEntrypoint});

		logger.info("[Worker] Loading from", {entrypoint});

		if (loadedEntrypoint !== null && loadedEntrypoint !== entrypoint) {
			logger.info(
				`[Worker] Hot reload detected: ${loadedEntrypoint} -> ${entrypoint}`,
			);
			logger.info("[Worker] Creating completely fresh ServiceWorker context");

			// Create a completely new runtime instance
			registration = new ShovelServiceWorkerRegistration();
			if (!caches || !buckets) {
				throw new Error("Runtime not initialized - missing caches or buckets");
			}
			scope = new ServiceWorkerGlobals({registration, caches, buckets});
			scope.install();
		}

		loadedEntrypoint = entrypoint;

		// Import the ServiceWorker module
		const app = await import(entrypoint);
		logger.debug("[Worker] ServiceWorker module loaded", {
			exports: Object.keys(app),
		});

		// Run lifecycle events
		if (!registration) {
			throw new Error("Registration not initialized");
		}

		logger.info("[Worker] Running install event");
		await registration.install();

		logger.info("[Worker] Running activate event");
		await registration.activate();

		serviceWorkerReady = true;
		logger.info("[Worker] ServiceWorker ready", {entrypoint});
	} catch (error) {
		logger.error("[Worker] Failed to load ServiceWorker", {
			error,
			entrypoint,
		});
		serviceWorkerReady = false;
		throw error;
	}
}

async function initializeRuntime(config: any, baseDir: string): Promise<void> {
	try {
		// Configure LogTape for this worker
		if (config?.logging) {
			await configureLogging(config.logging);
		}

		logger.info(`[Worker-${workerId}] Initializing runtime`, {config, baseDir});

		// Create cache storage
		logger.info(`[Worker-${workerId}] Creating cache storage`);
		caches = new CustomCacheStorage(createCacheFactory({config}));

		// Create bucket storage
		logger.info(`[Worker-${workerId}] Creating bucket storage`);
		buckets = new CustomBucketStorage(createBucketFactory({baseDir, config}));

		// Create and install ServiceWorker runtime
		logger.info(`[Worker-${workerId}] Creating and installing scope`);
		registration = new ShovelServiceWorkerRegistration();
		scope = new ServiceWorkerGlobals({registration, caches, buckets});
		scope.install();

		logger.info(`[Worker-${workerId}] Runtime initialized successfully`);
	} catch (error) {
		logger.error(`[Worker-${workerId}] Failed to initialize runtime`, {error});
		throw error;
	}
}

async function handleMessage(message: WorkerMessage): Promise<void> {
	try {
		logger.info(`[Worker-${workerId}] Received message`, {type: message.type});

		if (message.type === "init") {
			const initMsg = message as WorkerInitMessage;
			await initializeRuntime(initMsg.config, initMsg.baseDir);
			logger.info(`[Worker-${workerId}] Sending initialized message`);
			sendMessage({type: "initialized"});
		} else if (message.type === "load") {
			const loadMsg = message as WorkerLoadMessage;
			await loadServiceWorker(loadMsg.entrypoint);
			sendMessage({type: "ready", entrypoint: loadMsg.entrypoint});
		} else if (message.type === "request") {
			const reqMsg = message as WorkerRequest;

			const request = new Request(reqMsg.request.url, {
				method: reqMsg.request.method,
				headers: reqMsg.request.headers,
				body: reqMsg.request.body,
			});

			const response = await handleFetchEvent(request);

			// Use arrayBuffer for zero-copy transfer
			const body = await response.arrayBuffer();

			// Ensure Content-Type is preserved
			const headers = Object.fromEntries(response.headers.entries());
			if (!headers["Content-Type"] && !headers["content-type"]) {
				headers["Content-Type"] = "text/plain; charset=utf-8";
			}

			const responseMsg: WorkerResponse = {
				type: "response",
				response: {
					status: response.status,
					statusText: response.statusText,
					headers,
					body,
				},
				requestID: reqMsg.requestID,
			};
			// Transfer the ArrayBuffer (zero-copy)
			sendMessage(responseMsg, [body]);
		}
		// Ignore other message types (cache messages handled by PostMessageCache)
	} catch (error) {
		const errorMsg: WorkerErrorMessage = {
			type: "error",
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
			requestID: (message as any).requestID,
		};
		sendMessage(errorMsg);
	}
}

// ============================================================================
// Worker Initialization - Runs unconditionally when this file is loaded
// ============================================================================

// Set up message handling
onmessage = function (event: MessageEvent) {
	void handleMessage(event.data);
};

// Set up sendMessage function
sendMessage = (message: WorkerMessage, transfer?: Transferable[]) => {
	if (transfer && transfer.length > 0) {
		postMessage(message, transfer);
	} else {
		postMessage(message);
	}
};

// Signal that the worker is ready
sendMessage({type: "worker-ready"});
