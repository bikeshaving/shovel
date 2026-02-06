/**
 * WPT cache tests for PostMessageCache
 *
 * Runs the same WPT-based cache tests against PostMessageCache to verify
 * the PostMessage serialization round-trip preserves Cache API compliance.
 *
 * Architecture:
 *   Main thread (this file)         Worker thread
 *   ─────────────────────           ─────────────
 *   PostMessageCacheProxy  ──cmd──▶ PostMessageCache
 *                                       │
 *                                   self.postMessage (mocked)
 *                                       │
 *                                   handleCacheOperation
 *                                       │
 *                                   MemoryCache
 *                                       │
 *                                   handleCacheResponse
 *                                       │
 *   PostMessageCacheProxy  ◀──res── parentPort.postMessage
 */

import {Worker} from "worker_threads";
import {fileURLToPath} from "url";
import {dirname, join} from "path";
import {afterAll, beforeAll} from "bun:test";
import {runCacheTests} from "../src/runners/cache.js";

let worker: Worker;
let requestCounter = 0;
const pendingRequests = new Map<
	number,
	{resolve: (value: any) => void; reject: (error: Error) => void}
>();

const sendCommand = (command: string, data: any = {}): Promise<any> => {
	return new Promise((resolve, reject) => {
		const requestID = ++requestCounter;
		pendingRequests.set(requestID, {resolve, reject});
		worker.postMessage({command, requestID, ...data});

		setTimeout(() => {
			if (pendingRequests.has(requestID)) {
				pendingRequests.delete(requestID);
				reject(new Error(`Request ${requestID} (${command}) timed out`));
			}
		}, 5000);
	});
};

/**
 * Main-thread proxy implementing Cache by forwarding to PostMessageCache
 * running in the worker thread.
 */
class PostMessageCacheProxy {
	#cacheName: string;

	constructor(cacheName: string) {
		this.#cacheName = cacheName;
	}

	async match(
		request: RequestInfo | URL,
		options?: CacheQueryOptions,
	): Promise<Response | undefined> {
		const req = toRequestInit(request);
		const result = await sendCommand("match", {
			cacheName: this.#cacheName,
			request: req,
			options,
		});
		if (!result) return undefined;
		return new Response(result.body, {
			status: result.status,
			statusText: result.statusText,
			headers: result.headers,
		});
	}

	async matchAll(
		request?: RequestInfo | URL,
		options?: CacheQueryOptions,
	): Promise<readonly Response[]> {
		const req = request ? toRequestInit(request) : undefined;
		const results = await sendCommand("matchAll", {
			cacheName: this.#cacheName,
			request: req,
			options,
		});
		return (results || []).map(
			(r: any) =>
				new Response(r.body, {
					status: r.status,
					statusText: r.statusText,
					headers: r.headers,
				}),
		);
	}

	async put(request: RequestInfo | URL, response: Response): Promise<void> {
		const req = toRequestInit(request);
		const body = await response.text();
		await sendCommand("put", {
			cacheName: this.#cacheName,
			request: req,
			response: {
				body,
				status: response.status,
				statusText: response.statusText,
				headers: Object.fromEntries(response.headers),
			},
		});
	}

	async delete(
		request: RequestInfo | URL,
		options?: CacheQueryOptions,
	): Promise<boolean> {
		const req = toRequestInit(request);
		return await sendCommand("delete", {
			cacheName: this.#cacheName,
			request: req,
			options,
		});
	}

	async keys(
		request?: RequestInfo | URL,
		options?: CacheQueryOptions,
	): Promise<readonly Request[]> {
		const req = request ? toRequestInit(request) : undefined;
		const keys = await sendCommand("keys", {
			cacheName: this.#cacheName,
			request: req,
			options,
		});
		return (keys || []).map(
			(k: any) =>
				new Request(k.url, {
					method: k.method,
					headers: k.headers,
				}),
		);
	}

	async add(_request: RequestInfo | URL): Promise<void> {
		throw new Error("add() not supported through PostMessage proxy");
	}

	async addAll(_requests: RequestInfo[]): Promise<void> {
		throw new Error("addAll() not supported through PostMessage proxy");
	}
}

function toRequestInit(request: RequestInfo | URL): {
	url: string;
	method: string;
	headers: Record<string, string>;
} {
	if (typeof request === "string") {
		return {url: request, method: "GET", headers: {}};
	}
	if (request instanceof URL) {
		return {url: request.href, method: "GET", headers: {}};
	}
	return {
		url: request.url,
		method: request.method,
		headers: Object.fromEntries(request.headers),
	};
}

beforeAll(async () => {
	const __filename = fileURLToPath(import.meta.url);
	const __dirname = dirname(__filename);
	const workerPath = join(__dirname, "postmessage-wpt-worker.ts");

	worker = new Worker(workerPath);

	worker.on("message", (message: any) => {
		const {requestID, result, error} = message;
		const pending = pendingRequests.get(requestID);
		if (pending) {
			pendingRequests.delete(requestID);
			if (error) {
				pending.reject(new Error(error));
			} else {
				pending.resolve(result);
			}
		}
	});

	worker.on("error", (error) => {
		throw error;
	});

	await sendCommand("init", {cacheName: "wpt-init"});
});

afterAll(async () => {
	await worker?.terminate();
	pendingRequests.clear();
});

runCacheTests("PostMessageCache", {
	createCache: (name) =>
		Promise.resolve(new PostMessageCacheProxy(name) as any),
	cleanup: async () => {},
});
