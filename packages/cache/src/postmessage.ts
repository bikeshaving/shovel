import {Cache, type CacheQueryOptions} from "./cache.js";

// Platform-agnostic worker communication interface
interface MessagePortLike {
	postMessage(value: any): void;
	on(event: string, listener: (data: any) => void): void;
}

// Use globalThis for platform detection instead of Node.js-specific imports
const isMainThread = typeof self === 'undefined';
const parentPort: MessagePortLike | null = typeof self !== 'undefined' ? self as any : null;

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
	private requestId = 0;
	private pendingRequests = new Map<
		number,
		{resolve: (value: any) => void; reject: (error: Error) => void}
	>();

	constructor(
		private name: string,
		private options: PostMessageCacheOptions = {},
	) {
		super();

		if (isMainThread) {
			throw new Error(
				"PostMessageCache should only be used in worker threads",
			);
		}

		// Listen for responses from main thread
		if (parentPort) {
			parentPort.on("message", (message) => {
				if (
					message.type === "cache:response" ||
					message.type === "cache:error"
				) {
					this.handleResponse(message);
				}
			});
		}
	}

	private handleResponse(message: any) {
		const pending = this.pendingRequests.get(message.requestId);
		if (pending) {
			this.pendingRequests.delete(message.requestId);

			if (message.type === "cache:error") {
				pending.reject(new Error(message.error));
			} else {
				pending.resolve(message.result);
			}
		}
	}

	private async sendRequest(type: string, data: any): Promise<any> {
		if (!parentPort) {
			throw new Error(
				"PostMessageCache can only be used in worker threads",
			);
		}

		const requestId = ++this.requestId;

		return new Promise((resolve, reject) => {
			this.pendingRequests.set(requestId, {resolve, reject});

			parentPort!.postMessage({
				type,
				requestId,
				cacheName: this.name,
				...data,
			});

			// Timeout after 30 seconds
			setTimeout(() => {
				if (this.pendingRequests.has(requestId)) {
					this.pendingRequests.delete(requestId);
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

		const response = await this.sendRequest("cache:match", {
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

		await this.sendRequest("cache:put", {
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

		return await this.sendRequest("cache:delete", {
			request: serializedRequest,
			options,
		});
	}

	async keys(
		request?: Request,
		options?: CacheQueryOptions,
	): Promise<Request[]> {
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

		const keys = await this.sendRequest("cache:keys", {
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
		await this.sendRequest("cache:clear", {});
	}

	async dispose(): Promise<void> {
		await this.clear();
		this.pendingRequests.clear();
	}
}
