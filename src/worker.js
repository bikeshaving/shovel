/**
 * Static Worker template for ServiceWorker execution
 * Uses Node.js Worker threads with ServiceWorker simulation
 */

import {createServiceWorkerGlobals} from "./serviceworker.js";
import {WorkerAwareCacheStorage} from "@b9g/cache/worker-aware-cache-storage";
import {parentPort} from "worker_threads";

// Create worker-aware cache storage for this Worker
const caches = new WorkerAwareCacheStorage();

// Set up ServiceWorker globals with coordinated cache (worker-scoped)
const serviceWorkerGlobals = createServiceWorkerGlobals({caches});
// Don't pollute globalThis - keep ServiceWorker context isolated per worker
let workerSelf = serviceWorkerGlobals.self;

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

	// Simulate fetch event dispatch using standard ServiceWorker API
	let response = null;

	if (workerSelf && workerSelf.dispatchEvent) {
		const fetchEvent = new serviceWorkerGlobals.FetchEvent("fetch", {
			request,
			clientId: "",
			isReload: false,
		});

		workerSelf.dispatchEvent(fetchEvent);

		// Get response from standard FetchEvent API
		const eventResponse = fetchEvent._getResponse();
		if (eventResponse) {
			response = await eventResponse;
		}
	}

	if (!response) {
		response = new Response("ServiceWorker did not provide a response", {
			status: 500,
		});
	}

	return response;
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

			// Create fresh ServiceWorker globals to ensure no old event listeners
			const freshGlobals = createServiceWorkerGlobals({caches});
			Object.assign(serviceWorkerGlobals, freshGlobals);
			workerSelf = freshGlobals.self;

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

		// Temporarily inject ServiceWorker globals for module loading
		const originalGlobals = {};
		Object.keys(serviceWorkerGlobals).forEach((key) => {
			originalGlobals[key] = globalThis[key];
			globalThis[key] = serviceWorkerGlobals[key];
		});

		try {
			// Simple cache busting with version timestamp
			const appModule = await import(`${entrypointPath}?v=${version}`);
			loadedVersion = version; // Track the version to prevent reloading
			currentApp = appModule;

			// ServiceWorker lifecycle simulation using standard ExtendableEvent
			if (workerSelf && workerSelf.dispatchEvent) {
				// Install event
				const installEvent = new serviceWorkerGlobals.ExtendableEvent(
					"install",
				);
				workerSelf.dispatchEvent(installEvent);
				await installEvent._waitForPromises();

				// Activate event
				const activateEvent = new serviceWorkerGlobals.ExtendableEvent(
					"activate",
				);
				workerSelf.dispatchEvent(activateEvent);
				await activateEvent._waitForPromises();
			}
		} finally {
			// Restore original globals to keep workers isolated
			Object.keys(serviceWorkerGlobals).forEach((key) => {
				if (originalGlobals[key] === undefined) {
					delete globalThis[key];
				} else {
					globalThis[key] = originalGlobals[key];
				}
			});
		}

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
