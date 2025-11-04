/**
 * Static Worker template for ServiceWorker execution
 * Uses Node.js Worker threads with ServiceWorker simulation
 */

import {createServiceWorkerGlobals, ServiceWorkerRuntime, createBucketStorage} from "@b9g/platform";
import {WorkerAwareCacheStorage} from "@b9g/cache/worker-aware-cache-storage";
import {parentPort} from "worker_threads";
import * as Path from "path";

// Create worker-aware cache storage for this Worker
const caches = new WorkerAwareCacheStorage();

// Create bucket storage for dist/ folder
const buckets = createBucketStorage(Path.join(process.cwd(), "dist"));

// Create ServiceWorker runtime
const runtime = new ServiceWorkerRuntime();

// Set up ServiceWorker globals with platform resources
createServiceWorkerGlobals(runtime, {caches, buckets});
// Don't pollute globalThis - keep ServiceWorker context isolated per worker
let workerSelf = runtime;

let currentApp = null;
let serviceWorkerReady = false;
let loadedVersion = null;

/**
 * Handle ServiceWorker fetch events
 */
async function handleFetchEvent(request) {
	if (!currentApp || !serviceWorkerReady) {
		throw new Error("ServiceWorker not ready");
	}

	// Use platform ServiceWorker runtime to handle request
	try {
		const response = await runtime.handleRequest(request);
		return response;
	} catch (error) {
		console.error("[Worker] ServiceWorker request failed:", error);
		const response = new Response("ServiceWorker request failed", {
			status: 500,
		});
		return response;
	}
}

/**
 * Load and activate ServiceWorker with proper lifecycle
 */
async function loadServiceWorker(version, entrypoint) {
	try {
		console.info("[Worker] loadServiceWorker called with:", {
			version,
			entrypoint,
		});
		const entrypointPath = entrypoint || `${process.cwd()}/dist/app.js`;
		console.info("[Worker] Loading from:", entrypointPath);

		// Handle hot reload by creating fresh ServiceWorker context
		if (loadedVersion !== null && loadedVersion !== version) {
			console.info(
				`[Worker] Hot reload detected: ${loadedVersion} -> ${version}`,
			);
			console.info("[Worker] Creating completely fresh ServiceWorker context");

			// Reset the runtime for fresh context
			runtime.reset();
			
			// Re-attach platform resources
			createServiceWorkerGlobals(runtime, {caches, buckets});
			workerSelf = runtime;

			currentApp = null;
			serviceWorkerReady = false;
		}

		if (loadedVersion === version) {
			console.info(
				"[Worker] ServiceWorker already loaded for version",
				version,
			);
			return;
		}

		// Set up globals for module loading
		globalThis.self = runtime;
		globalThis.addEventListener = runtime.addEventListener.bind(runtime);
		globalThis.removeEventListener = runtime.removeEventListener.bind(runtime);
		globalThis.dispatchEvent = runtime.dispatchEvent.bind(runtime);

		// Simple cache busting with version timestamp
		const appModule = await import(`${entrypointPath}?v=${version}`);
		loadedVersion = version; // Track the version to prevent reloading
		currentApp = appModule;

		// ServiceWorker lifecycle using platform runtime
		await runtime.install();
		await runtime.activate();

		serviceWorkerReady = true;
		console.info(
			`[Worker] ServiceWorker loaded and activated (v${version}) from ${entrypointPath}`,
		);
	} catch (error) {
		console.error("[Worker] Failed to load ServiceWorker:", error);
		serviceWorkerReady = false;
		throw error;
	}
}

const workerId = Math.random().toString(36).substring(2, 8);

// Node.js Worker thread message handling
parentPort.on("message", async (message) => {
	try {
		if (message.type === "load") {
			await loadServiceWorker(message.version, message.entrypoint);
			parentPort.postMessage({type: "ready", version: message.version});
		} else if (message.type === "request") {
			console.log(
				`[Worker-${workerId}] Handling request:`,
				message.request.url,
			);
			// Reconstruct Request object from serialized data
			const request = new Request(message.request.url, {
				method: message.request.method,
				headers: message.request.headers,
				body: message.request.body,
			});

			const response = await handleFetchEvent(request);

			// Serialize response for Worker thread (can't clone Response objects)
			parentPort.postMessage({
				type: "response",
				response: {
					status: response.status,
					statusText: response.statusText,
					headers: Object.fromEntries(response.headers.entries()),
					body: await response.text(),
				},
				requestId: message.requestId,
			});
		} else if (
			message.type.startsWith("cache:") ||
			message.type.startsWith("cachestorage:")
		) {
			// Cache operations are handled by the WorkerCacheStorage and WorkerCache instances
			// They listen to parentPort messages directly, so we don't need to handle them here
		} else {
			console.warn("[Worker] Unknown message type:", message.type);
		}
	} catch (error) {
		parentPort.postMessage({
			type: "error",
			error: error.message,
			stack: error.stack,
			requestId: message.requestId,
		});
	}
});

// Signal that Worker is ready to receive messages
parentPort.postMessage({type: "worker-ready"});
