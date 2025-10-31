/**
 * Memory Cache Manager for Main Thread
 *
 * Coordinates MemoryCache operations across Worker threads by managing
 * shared MemoryCache instances and handling postMessage requests.
 *
 * Only MemoryCache needs coordination since it stores data in process memory.
 * Other cache types (FilesystemCache, SQLiteCache, etc.) can be used directly
 * by workers without coordination.
 */

import type { Worker } from "worker_threads";
import { MemoryCache } from "./memory-cache.js";

interface CacheMessage {
	type: string;
	requestId: string;
	cacheName: string;
	request?: SerializedRequest;
	response?: SerializedResponse;
	options?: any;
}

interface SerializedRequest {
	url: string;
	method: string;
	headers: Record<string, string>;
	body?: string;
}

interface SerializedResponse {
	status: number;
	statusText: string;
	headers: Record<string, string>;
	body: string;
}

export class MemoryCacheManager {
	private memoryCaches = new Map<string, MemoryCache>();

	/**
	 * Handle memory cache-related message from a Worker
	 */
	async handleMessage(worker: Worker, message: CacheMessage): Promise<void> {
		const { type, requestId } = message;

		try {
			let result: any;

			switch (type) {
				case "cache:match":
					result = await this.handleMatch(message);
					break;

				case "cache:put":
					result = await this.handlePut(message);
					break;

				case "cache:delete":
					result = await this.handleDelete(message);
					break;

				case "cache:keys":
					result = await this.handleKeys(message);
					break;

				case "cache:clear":
					result = await this.handleClear(message);
					break;

				default:
					// Not a memory cache operation, ignore
					return;
			}

			// Send success response
			worker.postMessage({
				type: "cache:response",
				requestId,
				result,
			});
		} catch (error) {
			// Send error response
			worker.postMessage({
				type: "cache:error",
				requestId,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	/**
	 * Get or create a MemoryCache instance
	 */
	getMemoryCache(name: string, options: any = {}): MemoryCache {
		if (!this.memoryCaches.has(name)) {
			this.memoryCaches.set(name, new MemoryCache(name, options));
		}
		return this.memoryCaches.get(name)!;
	}

	private async handleMatch(message: CacheMessage): Promise<SerializedResponse | undefined> {
		const { cacheName, request, options } = message;
		if (!request) throw new Error("Request is required for match operation");

		const cache = this.getMemoryCache(cacheName);

		// Reconstruct Request object from serialized data
		const req = new Request(request.url, {
			method: request.method,
			headers: request.headers,
			body: request.body,
		});

		const response = await cache.match(req, options);

		if (!response) {
			return undefined;
		}

		// Serialize response for transmission
		return {
			status: response.status,
			statusText: response.statusText,
			headers: Object.fromEntries(response.headers.entries()),
			body: await response.text(),
		};
	}

	private async handlePut(message: CacheMessage): Promise<boolean> {
		const { cacheName, request, response } = message;
		if (!request || !response) throw new Error("Request and response are required for put operation");

		const cache = this.getMemoryCache(cacheName);

		// Reconstruct Request and Response objects
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
		return true;
	}

	private async handleDelete(message: CacheMessage): Promise<boolean> {
		const { cacheName, request, options } = message;
		if (!request) throw new Error("Request is required for delete operation");

		const cache = this.getMemoryCache(cacheName);

		const req = new Request(request.url, {
			method: request.method,
			headers: request.headers,
			body: request.body,
		});

		return await cache.delete(req, options);
	}

	private async handleKeys(message: CacheMessage): Promise<SerializedRequest[]> {
		const { cacheName, request, options } = message;
		const cache = this.getMemoryCache(cacheName);

		let req: Request | undefined;
		if (request) {
			req = new Request(request.url, {
				method: request.method,
				headers: request.headers,
				body: request.body,
			});
		}

		const keys = await cache.keys(req, options);

		// Serialize Request objects for transmission
		return keys.map((key) => ({
			url: key.url,
			method: key.method,
			headers: Object.fromEntries(key.headers.entries()),
			body: undefined, // Keys don't include bodies
		}));
	}

	private async handleClear(message: CacheMessage): Promise<boolean> {
		const { cacheName } = message;
		const cache = this.getMemoryCache(cacheName);
		await cache.clear();
		return true;
	}

	/**
	 * Dispose of all memory caches
	 */
	async dispose(): Promise<void> {
		const disposePromises = Array.from(this.memoryCaches.values()).map(
			(cache) => cache.dispose(),
		);
		await Promise.all(disposePromises);
		this.memoryCaches.clear();
	}
}