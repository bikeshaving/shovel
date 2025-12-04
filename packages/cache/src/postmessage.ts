import {Cache, type CacheQueryOptions} from "./index.js";

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
 * Worker-side cache that forwards operations to main thread via postMessage.
 * Used for MemoryCache in multi-worker environments so all workers share state.
 */
export class PostMessageCache extends Cache {
	#name: string;
	#timeout: number;

	constructor(name: string, timeout = 30000) {
		super();
		this.#name = name;
		this.#timeout = timeout;
	}

	async #sendRequest(type: string, data: any): Promise<any> {
		if (typeof self === "undefined") {
			throw new Error("PostMessageCache can only be used in worker threads");
		}

		const requestID = ++globalRequestID;

		return new Promise((resolve, reject) => {
			pendingRequestsRegistry.set(requestID, {resolve, reject});

			self.postMessage({
				type,
				requestID,
				cacheName: this.#name,
				...data,
			});

			setTimeout(() => {
				if (pendingRequestsRegistry.has(requestID)) {
					pendingRequestsRegistry.delete(requestID);
					reject(new Error("Cache operation timeout"));
				}
			}, this.#timeout);
		});
	}

	async match(
		request: Request,
		options?: CacheQueryOptions,
	): Promise<Response | undefined> {
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

		return new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers,
		});
	}

	async put(request: Request, response: Response): Promise<void> {
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
