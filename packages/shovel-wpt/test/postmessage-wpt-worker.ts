/**
 * Worker for WPT PostMessageCache tests
 *
 * Creates PostMessageCache instances per cache name. The self.postMessage
 * round-trip is handled in-process: PostMessageCache posts cache:* messages,
 * which are intercepted by our mock self.postMessage, processed against
 * MemoryCache, and fed back via handleCacheResponse.
 */

import {parentPort} from "worker_threads";
import {MemoryCache} from "../../cache/src/memory.js";
import {handleCacheResponse, PostMessageCache} from "../../cache/src/postmessage.js";

// Main-thread cache coordinator (MemoryCache instances per name)
const memoryCaches = new Map<string, MemoryCache>();

function getMemoryCache(name: string): MemoryCache {
	if (!memoryCaches.has(name)) {
		memoryCaches.set(name, new MemoryCache(name));
	}
	return memoryCaches.get(name)!;
}

// PostMessageCache instances (one per cache name)
const postMessageCaches = new Map<string, PostMessageCache>();

function getPostMessageCache(name: string): PostMessageCache {
	if (!postMessageCaches.has(name)) {
		postMessageCaches.set(name, new PostMessageCache(name));
	}
	return postMessageCaches.get(name)!;
}

// Set up WorkerGlobalScope shims
class WorkerGlobalScope {}
class DedicatedWorkerGlobalScope extends WorkerGlobalScope {}
(globalThis as any).WorkerGlobalScope = WorkerGlobalScope;
(globalThis as any).DedicatedWorkerGlobalScope = DedicatedWorkerGlobalScope;

// Mock self.postMessage to intercept cache:* messages and process them
// against MemoryCache, then feed responses back to handleCacheResponse
globalThis.self = {
	...globalThis.self,
	postMessage: (message: any) => {
		const {type, requestID, cacheName} = message;

		if (!type || !type.startsWith("cache:")) return;

		// Process asynchronously
		(async () => {
			try {
				const cache = getMemoryCache(cacheName);
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
							const body = await response.arrayBuffer();
							result = {
								status: response.status,
								statusText: response.statusText,
								headers: Object.fromEntries(response.headers.entries()),
								body,
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
						const {request, options} = message;
						let keys: readonly Request[];
						if (request) {
							const req = new Request(request.url, {
								method: request.method,
								headers: request.headers,
							});
							keys = await cache.keys(req, options);
						} else {
							keys = await cache.keys();
						}
						result = keys.map((req) => ({
							url: req.url,
							method: req.method,
							headers: Object.fromEntries(req.headers.entries()),
						}));
						break;
					}

					case "cache:clear": {
						await cache.clear();
						result = true;
						break;
					}
				}

				handleCacheResponse({
					type: "cache:response",
					requestID,
					result,
				});
			} catch (error) {
				handleCacheResponse({
					type: "cache:error",
					requestID,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		})();
	},
} as any;

// Handle test commands from main thread
if (parentPort) {
	parentPort.on("message", async (message: any) => {
		const {command, requestID, cacheName} = message;
		if (!command) return;

		try {
			const cache = getPostMessageCache(cacheName);

			switch (command) {
				case "init": {
					parentPort!.postMessage({requestID, result: true});
					break;
				}

				case "put": {
					const {request, response} = message;
					await cache.put(
						new Request(request.url, request),
						new Response(response.body, response),
					);
					parentPort!.postMessage({requestID, result: true});
					break;
				}

				case "match": {
					const {request, options} = message;
					const req = request
						? new Request(request.url, request)
						: undefined;
					const result = await cache.match(req!, options);
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
					break;
				}

				case "matchAll": {
					const {request, options} = message;
					// matchAll is not on PostMessageCache, so go direct to MemoryCache
					const memCache = getMemoryCache(cacheName);
					let results: readonly Response[];
					if (request) {
						results = await memCache.matchAll(
							new Request(request.url, request),
							options,
						);
					} else {
						results = await memCache.matchAll(undefined, options);
					}
					const serialized = await Promise.all(
						results.map(async (r) => ({
							status: r.status,
							statusText: r.statusText,
							headers: Object.fromEntries(r.headers.entries()),
							body: await r.text(),
						})),
					);
					parentPort!.postMessage({requestID, result: serialized});
					break;
				}

				case "delete": {
					const {request, options} = message;
					const result = await cache.delete(
						new Request(request.url, request),
						options,
					);
					parentPort!.postMessage({requestID, result});
					break;
				}

				case "keys": {
					const {request, options} = message;
					let keys: readonly Request[];
					if (request) {
						keys = await cache.keys(
							new Request(request.url, request),
							options,
						);
					} else {
						keys = await cache.keys();
					}
					const serializedKeys = keys.map((req: Request) => ({
						url: req.url,
						method: req.method,
						headers: Object.fromEntries(req.headers.entries()),
					}));
					parentPort!.postMessage({requestID, result: serializedKeys});
					break;
				}
			}
		} catch (error) {
			parentPort!.postMessage({
				requestID,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	});
}
