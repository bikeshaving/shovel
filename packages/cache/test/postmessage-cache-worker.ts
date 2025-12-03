/**
 * Test worker for PostMessageCache
 * Mimics the ServiceWorkerPool environment with cache coordinator
 */

import {parentPort} from "worker_threads";
import {MemoryCache} from "../src/memory.js";

// Create main thread cache coordinator
const caches = new Map<string, MemoryCache>();

// Set up message handlers for self
const messageHandlers: Array<(event: MessageEvent) => void> = [];

// Set up WorkerGlobalScope classes (for compatibility)
// This simulates what ServiceWorkerGlobals.install() does
class WorkerGlobalScope {}
class DedicatedWorkerGlobalScope extends WorkerGlobalScope {}
(globalThis as any).WorkerGlobalScope = WorkerGlobalScope;
(globalThis as any).DedicatedWorkerGlobalScope = DedicatedWorkerGlobalScope;

// Set up Web Worker globals (must happen before PostMessageCache import is used)
globalThis.self = {
	...globalThis.self,
	postMessage: (message: any) => {
		// Handle cache operations internally
		handleCacheOperation(message).then((response) => {
			if (response) {
				// Dispatch to message handlers
				messageHandlers.forEach((handler) => {
					handler({data: response, type: "message"} as MessageEvent);
				});
			}
		});
		// Also send to parent for debugging
		if (parentPort && message.command) {
			parentPort.postMessage(message);
		}
	},
	addEventListener: (type: string, handler: any) => {
		if (type === "message") {
			messageHandlers.push(handler);
		}
	},
} as any;

async function handleCacheOperation(message: any) {
	const {type, requestID, cacheName} = message;

	if (!type || !type.startsWith("cache:")) {
		return null;
	}

	try {
		// Get or create cache
		if (!caches.has(cacheName)) {
			caches.set(cacheName, new MemoryCache(cacheName));
		}
		const cache = caches.get(cacheName)!;

		let result: any;

		switch (type) {
			case "cache:match": {
				const {request, options} = message;
				const req = new Request(request.url, {
					method: request.method,
					headers: request.headers,
					body: request.body,
				});
				const response = await cache.match(req, options);
				if (response) {
					result = {
						status: response.status,
						statusText: response.statusText,
						headers: Object.fromEntries(response.headers.entries()),
						body: await response.text(),
					};
				}
				break;
			}

			case "cache:put": {
				const {request, response} = message;
				const req = new Request(request.url, {
					method: request.method,
					headers: request.headers,
					body: request.body,
				});
				const res = new Response(response.body, {
					status: response.status,
					statusText: response.statusText,
					headers: response.headers,
				});
				await cache.put(req, res);
				result = true;
				break;
			}

			case "cache:delete": {
				const {request, options} = message;
				const req = new Request(request.url, {
					method: request.method,
					headers: request.headers,
				});
				result = await cache.delete(req, options);
				break;
			}

			case "cache:keys": {
				const keys = await cache.keys();
				result = keys.map((req) => ({
					url: req.url,
					method: req.method,
					headers: Object.fromEntries(req.headers.entries()),
				}));
				break;
			}
		}

		return {
			type: "cache:response",
			requestID,
			result,
		};
	} catch (error) {
		return {
			type: "cache:error",
			requestID,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

// Handle test commands from main thread
if (parentPort) {
	parentPort.on("message", async (message: any) => {
		const {command, requestID} = message;

		if (!command) return;

		try {
			// Import PostMessageCache dynamically after self globals are set up
			const {PostMessageCache} = await import("../src/postmessage.js");

			if (command === "init") {
				const cache = new PostMessageCache("test-cache");
				(globalThis as any).testCache = cache;
				parentPort!.postMessage({requestID, result: true});
			} else if (command === "put") {
				const cache = (globalThis as any).testCache;
				const {request, response} = message;
				await cache.put(
					new Request(request.url, request),
					new Response(response.body, response),
				);
				parentPort!.postMessage({requestID, result: true});
			} else if (command === "match") {
				const cache = (globalThis as any).testCache;
				const {request, options} = message;
				const result = await cache.match(
					new Request(request.url, request),
					options,
				);
				if (result) {
					const body = await result.text();
					parentPort!.postMessage({
						requestID,
						result: {
							status: result.status,
							statusText: result.statusText,
							headers: Object.fromEntries(result.headers.entries()),
							body,
						},
					});
				} else {
					parentPort!.postMessage({requestID, result: undefined});
				}
			} else if (command === "delete") {
				const cache = (globalThis as any).testCache;
				const {request, options} = message;
				const result = await cache.delete(
					new Request(request.url, request),
					options,
				);
				parentPort!.postMessage({requestID, result});
			} else if (command === "keys") {
				const cache = (globalThis as any).testCache;
				const keys = await cache.keys();
				const serializedKeys = keys.map((req: Request) => ({
					url: req.url,
					method: req.method,
					headers: Object.fromEntries(req.headers.entries()),
				}));
				parentPort!.postMessage({requestID, result: serializedKeys});
			}
		} catch (error) {
			parentPort!.postMessage({
				requestID,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	});
}
