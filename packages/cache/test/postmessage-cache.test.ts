import {test, expect, describe, beforeEach, afterEach} from "bun:test";
import {Worker} from "worker_threads";
import {fileURLToPath} from "url";
import {dirname, join} from "path";

describe("PostMessageCache", () => {
	let worker: Worker;
	let requestCounter = 0;
	const pendingRequests = new Map<
		number,
		{resolve: (value: any) => void; reject: (error: Error) => void}
	>();

	// Helper to send command to worker and wait for response
	const sendCommand = (command: string, data: any = {}): Promise<any> => {
		return new Promise((resolve, reject) => {
			const requestID = ++requestCounter;
			pendingRequests.set(requestID, {resolve, reject});
			worker.postMessage({command, requestID, ...data});

			// Timeout after 5 seconds
			setTimeout(() => {
				if (pendingRequests.has(requestID)) {
					pendingRequests.delete(requestID);
					reject(new Error(`Request ${requestID} (${command}) timed out`));
				}
			}, 5000);
		});
	};

	beforeEach(async () => {
		// Get the test worker path
		const __filename = fileURLToPath(import.meta.url);
		const __dirname = dirname(__filename);
		const workerPath = join(__dirname, "postmessage-cache-worker.ts");

		// Create worker
		worker = new Worker(workerPath);

		// Handle responses from worker
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
			console.error("[PostMessageCache test] Worker error:", error);
		});

		// Initialize cache in worker
		await sendCommand("init", {cacheName: "test-cache"});
	});

	afterEach(async () => {
		await worker.terminate();
		pendingRequests.clear();
		requestCounter = 0;
	});

	test("can store and retrieve responses", async () => {
		// Store a response
		await sendCommand("put", {
			request: {
				url: "http://example.com/test",
				method: "GET",
				headers: {},
			},
			response: {
				body: "Hello World",
				status: 200,
				statusText: "OK",
				headers: {"Content-Type": "text/plain"},
			},
		});

		// Retrieve it
		const retrieved = await sendCommand("match", {
			request: {
				url: "http://example.com/test",
				method: "GET",
				headers: {},
			},
		});

		expect(retrieved).toBeDefined();
		expect(retrieved.status).toBe(200);
		expect(retrieved.body).toBe("Hello World");
	});

	test("returns undefined for cache miss", async () => {
		const result = await sendCommand("match", {
			request: {
				url: "http://example.com/missing",
				method: "GET",
				headers: {},
			},
		});

		expect(result).toBeUndefined();
	});

	test("can delete cached entries", async () => {
		// First store something
		await sendCommand("put", {
			request: {
				url: "http://example.com/test",
				method: "GET",
				headers: {},
			},
			response: {
				body: "Test",
				status: 200,
				statusText: "OK",
				headers: {},
			},
		});

		// Delete it
		const deleted = await sendCommand("delete", {
			request: {
				url: "http://example.com/test",
				method: "GET",
				headers: {},
			},
		});

		expect(deleted).toBe(true);
	});

	test("can retrieve cache keys", async () => {
		// Store two entries
		await sendCommand("put", {
			request: {
				url: "http://example.com/1",
				method: "GET",
				headers: {},
			},
			response: {
				body: "Test 1",
				status: 200,
				statusText: "OK",
				headers: {},
			},
		});

		await sendCommand("put", {
			request: {
				url: "http://example.com/2",
				method: "GET",
				headers: {},
			},
			response: {
				body: "Test 2",
				status: 200,
				statusText: "OK",
				headers: {},
			},
		});

		// Get keys
		const keys = await sendCommand("keys");

		expect(keys.length).toBe(2);
		expect(keys[0].url).toBe("http://example.com/1");
		expect(keys[1].url).toBe("http://example.com/2");
	});

	test("supports cache query options", async () => {
		// Store with query string
		await sendCommand("put", {
			request: {
				url: "http://example.com/test",
				method: "GET",
				headers: {},
			},
			response: {
				body: "Test",
				status: 200,
				statusText: "OK",
				headers: {},
			},
		});

		// Match with query string but ignoreSearch option
		const result = await sendCommand("match", {
			request: {
				url: "http://example.com/test?query=1",
				method: "GET",
				headers: {},
			},
			options: {ignoreSearch: true},
		});

		expect(result).toBeDefined();
	});

	test("handles POST requests", async () => {
		// Store POST request
		await sendCommand("put", {
			request: {
				url: "http://example.com/api",
				method: "POST",
				headers: {"Content-Type": "application/json"},
			},
			response: {
				body: JSON.stringify({success: true}),
				status: 200,
				statusText: "OK",
				headers: {"Content-Type": "application/json"},
			},
		});

		// Retrieve it
		const retrieved = await sendCommand("match", {
			request: {
				url: "http://example.com/api",
				method: "POST",
				headers: {"Content-Type": "application/json"},
			},
		});

		expect(retrieved).toBeDefined();
		expect(retrieved.status).toBe(200);
		expect(JSON.parse(retrieved.body)).toEqual({success: true});
	});

	test("handles concurrent requests", async () => {
		// Send multiple concurrent requests
		const promises = [
			sendCommand("match", {
				request: {url: "http://example.com/1", method: "GET", headers: {}},
			}),
			sendCommand("match", {
				request: {url: "http://example.com/2", method: "GET", headers: {}},
			}),
			sendCommand("match", {
				request: {url: "http://example.com/3", method: "GET", headers: {}},
			}),
			sendCommand("match", {
				request: {url: "http://example.com/4", method: "GET", headers: {}},
			}),
			sendCommand("match", {
				request: {url: "http://example.com/5", method: "GET", headers: {}},
			}),
		];

		const results = await Promise.all(promises);

		// All should complete without errors
		expect(results.length).toBe(5);
		results.forEach((result) => expect(result).toBeUndefined()); // All cache misses
	});

	test("serializes request headers correctly", async () => {
		// Store with custom headers
		await sendCommand("put", {
			request: {
				url: "http://example.com/test",
				method: "GET",
				headers: {
					"X-Custom-Header": "value",
					Authorization: "Bearer token123",
				},
			},
			response: {
				body: "Test",
				status: 200,
				statusText: "OK",
				headers: {},
			},
		});

		// Retrieve with same headers
		const retrieved = await sendCommand("match", {
			request: {
				url: "http://example.com/test",
				method: "GET",
				headers: {
					"X-Custom-Header": "value",
					Authorization: "Bearer token123",
				},
			},
		});

		expect(retrieved).toBeDefined();
	});
});
