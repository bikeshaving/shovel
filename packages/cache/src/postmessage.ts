import {Cache, type CacheQueryOptions} from "./index.js";

// Get parentPort dynamically to handle cases where self is set after module load
function getParentPort(): typeof self | null {
	return typeof self !== "undefined" ? self : null;
}

/**
 * Configuration options for PostMessageCache
 */
export interface PostMessageCacheOptions {
	/** Maximum number of entries to store */
	maxEntries?: number;
	/** Maximum age of entries in milliseconds */
	maxAge?: number;
}

/**
 * Worker-side cache that forwards operations to main thread via postMessage
 * Only used for MemoryCache in multi-worker environments
 */
export class PostMessageCache extends Cache {
	#requestId: number;
	#pendingRequests: Map<
		number,
		{resolve: (value: any) => void; reject: (error: Error) => void}
	>;
	#name: string;

	constructor(name: string, _options: PostMessageCacheOptions = {}) {
		super();

		this.#requestId = 0;
		this.#pendingRequests = new Map<
			number,
			{resolve: (value: any) => void; reject: (error: Error) => void}
		>();
		this.#name = name;

		// Standard Web Worker detection using WorkerGlobalScope
		// WorkerGlobalScope is only defined in worker contexts (installed by ShovelGlobalScope.install())
		const isMainThread = typeof (globalThis as any).WorkerGlobalScope === "undefined";

		if (isMainThread) {
			throw new Error("PostMessageCache should only be used in worker threads");
		}

		// Listen for responses from main thread using Web Workers API
		// Use addEventListener to be compatible with other message handlers
		const parentPort = getParentPort();
		if (parentPort && parentPort.addEventListener) {
			parentPort.addEventListener("message", (event: MessageEvent) => {
				const message = event.data;
				if (
					message.type === "cache:response" ||
					message.type === "cache:error"
				) {
					this.#handleResponse(message);
				}
			});
		}
	}

	#handleResponse(message: any) {
		const pending = this.#pendingRequests.get(message.requestId);
		if (pending) {
			this.#pendingRequests.delete(message.requestId);

			if (message.type === "cache:error") {
				pending.reject(new Error(message.error));
			} else {
				pending.resolve(message.result);
			}
		}
	}

	async #sendRequest(type: string, data: any): Promise<any> {
		const parentPort = getParentPort();
		if (!parentPort) {
			throw new Error("PostMessageCache can only be used in worker threads");
		}

		const requestId = ++this.#requestId;

		return new Promise((resolve, reject) => {
			this.#pendingRequests.set(requestId, {resolve, reject});

			parentPort.postMessage({
				type,
				requestId,
				cacheName: this.#name,
				...data,
			});

			// Timeout after 30 seconds
			setTimeout(() => {
				if (this.#pendingRequests.has(requestId)) {
					this.#pendingRequests.delete(requestId);
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
