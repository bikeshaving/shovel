/**
 * Worker Entry Point for MultiThreadedRuntime
 *
 * This is the explicit entry point for worker threads spawned by MultiThreadedRuntime.
 * It sets up message handling and initializes the ServiceWorker runtime.
 *
 * This file is loaded directly as a Worker script - no detection needed.
 *
 * BOOTSTRAP ORDER:
 * 1. Create placeholder caches/buckets with deferred factories
 * 2. Create and install ServiceWorkerGlobals (provides `self`, `addEventListener`, etc.)
 * 3. Set up message handlers using `self.addEventListener`
 * 4. Wait for "init" message to configure factories with real config
 * 5. Wait for "load" message to load and activate ServiceWorker
 */

import {configure, getConsoleSink, getLogger} from "@logtape/logtape";
import {createBucketFactory, createCacheFactory} from "./storage-factories.js";
import {CustomBucketStorage, type BucketFactory} from "@b9g/filesystem";
import {CustomCacheStorage, type CacheFactory} from "@b9g/cache";
import {handleCacheResponse} from "@b9g/cache/postmessage";
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

// ============================================================================
// Worker State
// ============================================================================

const workerId = Math.random().toString(36).substring(2, 8);

// Deferred factory initialization - resolved when initializeRuntime receives config
let resolveCacheFactory: (factory: CacheFactory) => void;
let resolveBucketFactory: (factory: BucketFactory) => void;
const cacheFactoryPromise = new Promise<CacheFactory>((resolve) => {
	resolveCacheFactory = resolve;
});
const bucketFactoryPromise = new Promise<BucketFactory>((resolve) => {
	resolveBucketFactory = resolve;
});

// Create storage with async deferred factories (open() waits for init)
const caches = new CustomCacheStorage(async (name) => {
	const factory = await cacheFactoryPromise;
	return factory(name);
});
const buckets = new CustomBucketStorage(async (name) => {
	const factory = await bucketFactoryPromise;
	return factory(name);
});

// Create and install ServiceWorkerGlobals immediately to provide `self`
// Registration is mutable for hot reload support
let registration = new ShovelServiceWorkerRegistration();
let scope: ServiceWorkerGlobals | null = new ServiceWorkerGlobals({
	registration,
	caches,
	buckets,
});
scope.install();

// Logger is configured in initializeRuntime when we receive the config
const logger = getLogger(["server"]);

// Runtime state
let sendMessage: (message: WorkerMessage, transfer?: Transferable[]) => void;
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

			// Create a completely new runtime instance with fresh registration
			registration = new ShovelServiceWorkerRegistration();
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
		// Reconfigure logging if config specifies logging options
		const loggingConfig = config?.logging;
		if (loggingConfig) {
			type LogLevel =
				| "trace"
				| "debug"
				| "info"
				| "warning"
				| "error"
				| "fatal";
			const defaultLevel = (loggingConfig.level || "info") as LogLevel;
			const categories = loggingConfig.categories || {};

			// Build logger configs: start with catch-all, then add per-category overrides
			const loggers: Array<{
				category: string[];
				lowestLevel: LogLevel;
				sinks: string[];
			}> = [
				{category: [], lowestLevel: defaultLevel, sinks: ["console"]},
				{category: ["logtape", "meta"], lowestLevel: "warning", sinks: []},
			];

			// Add per-category overrides
			for (const [categoryName, categoryConfig] of Object.entries(categories)) {
				if (categoryConfig && typeof categoryConfig === "object") {
					const catConfig = categoryConfig as {level?: string};
					loggers.push({
						category: [categoryName],
						lowestLevel: (catConfig.level || defaultLevel) as LogLevel,
						sinks: ["console"],
					});
				}
			}

			await configure({
				reset: true,
				sinks: {console: getConsoleSink()},
				loggers,
			});
		}

		logger.info(`[Worker-${workerId}] Initializing runtime`, {config, baseDir});

		// Resolve the deferred factories - this unblocks any pending caches.open() / buckets.open() calls
		logger.info(`[Worker-${workerId}] Configuring cache factory`);
		resolveCacheFactory(createCacheFactory({config, usePostMessage: true}));

		logger.info(`[Worker-${workerId}] Configuring bucket factory`);
		resolveBucketFactory(createBucketFactory({baseDir, config}));

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

// Set up message handling via addEventListener
// ServiceWorkerGlobals delegates non-ServiceWorker events (like "message") to the native handler
self.addEventListener("message", (event: MessageEvent) => {
	const msg = event.data;
	// Forward cache responses directly to PostMessageCache handler
	if (msg?.type === "cache:response" || msg?.type === "cache:error") {
		logger.debug(`[Worker-${workerId}] Forwarding cache message`, {
			type: msg.type,
			requestID: msg.requestID,
		});
		handleCacheResponse(msg);
		return;
	}
	void handleMessage(event.data);
});

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
