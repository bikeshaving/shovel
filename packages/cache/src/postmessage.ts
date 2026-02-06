import {Cache, type CacheQueryOptions, toRequest} from "./index.js";

// Shared registry for pending requests across all PostMessageCache instances
const pendingRequestsRegistry = new Map<
	number,
	{resolve: (value: any) => void; reject: (error: any) => void}
>();

/**
 * Handle cache response/error messages from main thread.
 * Called by worker.ts when receiving cache:response or cache:error messages.
 */
export function handleCacheResponse(message: any): void {
	const pending = pendingRequestsRegistry.get(message.requestID);
	if (pending) {
		pendingRequestsRegistry.delete(message.requestID);
		if (message.type === "cache:error") {
			pending.reject(new Error(message.error));
		} else {
			pending.resolve(message.result);
		}
	}
}

// Global request ID counter
let globalRequestID = 0;

/**
 * Configuration options for PostMessageCache
 */
export interface PostMessageCacheOptions {
	/** Timeout for cache operations in milliseconds (default: 30000) */
	timeout?: number;
}

/**
 * Worker-side cache that forwards operations to main thread via postMessage.
 * Used for MemoryCache in multi-worker environments so all workers share state.
 */
export class PostMessageCache extends Cache {
	#name: string;
	#timeout: number;

	constructor(name: string, options: PostMessageCacheOptions = {}) {
		super();
		this.#name = name;
		this.#timeout = options.timeout ?? 30000;
	}

	async #sendRequest(
		type: string,
		data: any,
		transfer?: Transferable[],
	): Promise<any> {
		if (typeof self === "undefined") {
			throw new Error("PostMessageCache can only be used in worker threads");
		}

		if (globalRequestID >= Number.MAX_SAFE_INTEGER) {
			throw new Error(
				"Congratulations! You've made 9 quadrillion cache requests. Please restart your server and tell us about your workload.",
			);
		}
		const requestID = ++globalRequestID;

		return new Promise((resolve, reject) => {
			pendingRequestsRegistry.set(requestID, {resolve, reject});

			const message = {
				type,
				requestID,
				cacheName: this.#name,
				...data,
			};

			if (transfer && transfer.length > 0) {
				self.postMessage(message, transfer);
			} else {
				self.postMessage(message);
			}

			setTimeout(() => {
				if (pendingRequestsRegistry.has(requestID)) {
					pendingRequestsRegistry.delete(requestID);
					reject(new Error("Cache operation timeout"));
				}
			}, this.#timeout);
		});
	}

	async match(
		request: RequestInfo | URL,
		options?: CacheQueryOptions,
	): Promise<Response | undefined> {
		const req = toRequest(request);
		let requestBody: ArrayBuffer | undefined;
		const transfer: ArrayBuffer[] = [];

		if (req.method !== "GET" && req.method !== "HEAD") {
			requestBody = await req.arrayBuffer();
			transfer.push(requestBody);
		}

		const serializedRequest = {
			url: req.url,
			method: req.method,
			headers: Object.fromEntries(req.headers),
			body: requestBody,
		};

		const response = await this.#sendRequest(
			"cache:match",
			{
				request: serializedRequest,
				options,
			},
			transfer,
		);

		if (!response) {
			return undefined;
		}

		return new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers,
		});
	}

	async put(request: RequestInfo | URL, response: Response): Promise<void> {
		const req = toRequest(request);
		const transfer: ArrayBuffer[] = [];
		let requestBody: ArrayBuffer | undefined;
		let responseBody: ArrayBuffer;

		if (req.method !== "GET" && req.method !== "HEAD") {
			requestBody = await req.clone().arrayBuffer();
			transfer.push(requestBody);
		}

		responseBody = await response.clone().arrayBuffer();
		transfer.push(responseBody);

		const serializedRequest = {
			url: req.url,
			method: req.method,
			headers: Object.fromEntries(req.headers),
			body: requestBody,
		};

		const serializedResponse = {
			status: response.status,
			statusText: response.statusText,
			headers: Object.fromEntries(response.headers),
			body: responseBody,
		};

		await this.#sendRequest(
			"cache:put",
			{
				request: serializedRequest,
				response: serializedResponse,
			},
			transfer,
		);
	}

	async delete(
		request: RequestInfo | URL,
		options?: CacheQueryOptions,
	): Promise<boolean> {
		const req = toRequest(request);
		let requestBody: ArrayBuffer | undefined;
		const transfer: ArrayBuffer[] = [];

		if (req.method !== "GET" && req.method !== "HEAD") {
			requestBody = await req.arrayBuffer();
			transfer.push(requestBody);
		}

		const serializedRequest = {
			url: req.url,
			method: req.method,
			headers: Object.fromEntries(req.headers),
			body: requestBody,
		};

		return await this.#sendRequest(
			"cache:delete",
			{
				request: serializedRequest,
				options,
			},
			transfer,
		);
	}

	async keys(
		request?: RequestInfo | URL,
		options?: CacheQueryOptions,
	): Promise<readonly Request[]> {
		let serializedRequest;
		const transfer: ArrayBuffer[] = [];

		if (request) {
			const req = toRequest(request);
			let requestBody: ArrayBuffer | undefined;
			if (req.method !== "GET" && req.method !== "HEAD") {
				requestBody = await req.arrayBuffer();
				transfer.push(requestBody);
			}

			serializedRequest = {
				url: req.url,
				method: req.method,
				headers: Object.fromEntries(req.headers),
				body: requestBody,
			};
		}

		const keys = await this.#sendRequest(
			"cache:keys",
			{
				request: serializedRequest,
				options,
			},
			transfer,
		);

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
