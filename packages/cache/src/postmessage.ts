import {Cache, type CacheQueryOptions} from "./index.js";

// Get parentPort dynamically to handle cases where self is set after module load
function getParentPort(): typeof self | null {
	return typeof self !== "undefined" ? self : null;
}

// Global message handler setup - only set up once for all PostMessageCache instances
let messageHandlerSetup = false;
const pendingRequestsRegistry = new Map<
	number,
	{resolve: (value: any) => void; reject: (error: any) => void}
>();

function setupMessageHandler() {
	if (messageHandlerSetup) return;
	messageHandlerSetup = true;

	const parentPort = getParentPort();
	if (parentPort && parentPort.addEventListener) {
		parentPort.addEventListener("message", (event: MessageEvent) => {
			const message = event.data;
			if (message.type === "cache:response" || message.type === "cache:error") {
				handleCacheResponse(message);
			}
		});
	}
}

function handleCacheResponse(message: any) {
	const pending = pendingRequestsRegistry.get(message.requestId);
	if (pending) {
		pendingRequestsRegistry.delete(message.requestId);
		if (message.type === "cache:error") {
			pending.reject(new Error(message.error));
		} else {
			pending.resolve(message.result);
		}
	}
}

/**
 * Configuration options for PostMessageCache
 */
export interface PostMessageCacheOptions {
	/** Maximum number of entries to store */
	maxEntries?: number;
	/** Maximum age of entries in milliseconds */
	maxAge?: number;
	/** Timeout for cache operations in milliseconds (default: 30000) */
	timeout?: number;
}

// Global request ID counter shared across all PostMessageCache instances
let globalRequestId = 0;

/**
 * Worker-side cache that forwards operations to main thread via postMessage
 * Only used for MemoryCache in multi-worker environments
 */
export class PostMessageCache extends Cache {
	#name: string;

	constructor(name: string, _options: PostMessageCacheOptions = {}) {
		super();

		this.#name = name;

		// Standard Web Worker detection using WorkerGlobalScope
		// WorkerGlobalScope is only defined in worker contexts (installed by ShovelGlobalScope.install())
		const isMainThread =
			typeof (globalThis as any).WorkerGlobalScope === "undefined";

		if (isMainThread) {
			throw new Error("PostMessageCache should only be used in worker threads");
		}

		// Set up global message handler (only happens once for all instances)
		setupMessageHandler();
	}

	async #sendRequest(type: string, data: any): Promise<any> {
		const parentPort = getParentPort();
		if (!parentPort) {
			throw new Error("PostMessageCache can only be used in worker threads");
		}

		const requestId = ++globalRequestId;

		return new Promise((resolve, reject) => {
			pendingRequestsRegistry.set(requestId, {resolve, reject});

			parentPort.postMessage({
				type,
				requestId,
				cacheName: this.#name,
				...data,
			});

			// Timeout after 30 seconds
			setTimeout(() => {
				if (pendingRequestsRegistry.has(requestId)) {
					pendingRequestsRegistry.delete(requestId);
					reject(new Error("Cache operation timeout"));
				}
			}, 30000);
		});
	}

	async match(
		request: Request,
		options?: CacheQueryOptions,
	): Promise<Response | undefined> {
		// Serialize request for transmission
		const serializedRequest = {
			url: request.url,
			method: request.method,
			headers: Object.fromEntries(request.headers),
			body:
				request.method !== "GET" && request.method !== "HEAD"
					? await request.text()
					: undefined,
		};

		const response = await this.#sendRequest("cache:match", {
			request: serializedRequest,
			options,
		});

		if (!response) {
			return undefined;
		}

		// Reconstruct Response object
		return new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers,
		});
	}

	async put(request: Request, response: Response): Promise<void> {
		// Serialize request and response for transmission
		const serializedRequest = {
			url: request.url,
			method: request.method,
			headers: Object.fromEntries(request.headers),
			body:
				request.method !== "GET" && request.method !== "HEAD"
					? await request.clone().text()
					: undefined,
		};

		const serializedResponse = {
			status: response.status,
			statusText: response.statusText,
			headers: Object.fromEntries(response.headers),
			body: await response.clone().text(),
		};

		await this.#sendRequest("cache:put", {
			request: serializedRequest,
			response: serializedResponse,
		});
	}

	async delete(
		request: Request,
		options?: CacheQueryOptions,
	): Promise<boolean> {
		const serializedRequest = {
			url: request.url,
			method: request.method,
			headers: Object.fromEntries(request.headers),
			body:
				request.method !== "GET" && request.method !== "HEAD"
					? await request.text()
					: undefined,
		};

		return await this.#sendRequest("cache:delete", {
			request: serializedRequest,
			options,
		});
	}

	async keys(
		request?: Request,
		options?: CacheQueryOptions,
	): Promise<readonly Request[]> {
		let serializedRequest;
		if (request) {
			serializedRequest = {
				url: request.url,
				method: request.method,
				headers: Object.fromEntries(request.headers),
				body:
					request.method !== "GET" && request.method !== "HEAD"
						? await request.text()
						: undefined,
			};
		}

		const keys = await this.#sendRequest("cache:keys", {
			request: serializedRequest,
			options,
		});

		// Reconstruct Request objects
		return keys.map(
			(req: any) =>
				new Request(req.url, {
					method: req.method,
					headers: req.headers,
					body: req.body,
				}),
		);
	}

	async clear(): Promise<void> {
		await this.#sendRequest("cache:clear", {});
	}
}
