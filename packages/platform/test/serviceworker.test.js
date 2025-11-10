import {test, expect} from "bun:test";

/**
 * ServiceWorker globals and lifecycle tests
 * Tests the ServiceWorker implementation, globals setup, and lifecycle events
 */

const TIMEOUT = 1000;

// Helper to create a mock platform for testing
function createMockPlatform() {
	return {
		resolvePlatform: () => "node",
		displayPlatformInfo: () => {},
		createPlatform: () => ({
			loadServiceWorker: async () => ({
				runtime: mockRuntime,
				handleRequest: (req) => mockRuntime.handleRequest(req),
				install: () => mockRuntime.install(),
				activate: () => mockRuntime.activate(),
				ready: true,
				dispose: async () => {},
			}),
		}),
	};
}

// Helper to create a mock ServiceWorker runtime
function createMockRuntime() {
	const events = new Map();
	const listeners = new Map();

	const mockRuntime = {
		addEventListener(type, listener) {
			if (!listeners.has(type)) {
				listeners.set(type, []);
			}
			listeners.get(type).push(listener);
		},
		removeEventListener(type, listener) {
			if (listeners.has(type)) {
				const list = listeners.get(type);
				const index = list.indexOf(listener);
				if (index > -1) {
					list.splice(index, 1);
				}
			}
		},
		dispatchEvent(event) {
			const type = event.type || event;
			if (listeners.has(type)) {
				listeners.get(type).forEach((listener) => {
					listener(event);
				});
			}
		},
		async handleRequest(request) {
			const fetchEvent = {
				type: "fetch",
				request,
				respondWith: (response) => {
					fetchEvent.response = response;
				},
			};

			this.dispatchEvent(fetchEvent);
			return fetchEvent.response || new Response("Not found", {status: 404});
		},
		async install() {
			this.dispatchEvent({type: "install"});
		},
		async activate() {
			this.dispatchEvent({type: "activate"});
		},
		reset() {
			listeners.clear();
		},
		ready: true,
	};

	return mockRuntime;
}

// ======================
// SERVICEWORKER GLOBALS TESTS
// ======================

test(
	"ServiceWorker globals setup",
	async () => {
		// Import ServiceWorker globals function
		const {createServiceWorkerGlobals} = await import("../src/index.js");

		const runtime = createMockRuntime();
		const mockBuckets = {
			getDirectoryHandle: async (name) => ({
				name,
				kind: "directory",
			}),
		};

		// Create ServiceWorker globals
		createServiceWorkerGlobals(runtime, {buckets: mockBuckets});

		// Test that globals are properly set
		expect(typeof globalThis.self).toBe("object");
		expect(typeof globalThis.addEventListener).toBe("function");
		expect(typeof globalThis.removeEventListener).toBe("function");
		expect(typeof globalThis.dispatchEvent).toBe("function");
		expect(typeof globalThis.skipWaiting).toBe("function");
		expect(typeof globalThis.clients).toBe("object");
		expect(typeof globalThis.buckets).toBe("object");

		// Test that self refers to the runtime
		expect(globalThis.self).toBe(runtime);
	},
	TIMEOUT,
);

test(
	"ServiceWorker event listener functionality",
	async () => {
		const {createServiceWorkerGlobals} = await import("../src/index.js");

		const runtime = createMockRuntime();
		createServiceWorkerGlobals(runtime, {});

		let installCalled = false;
		let activateCalled = false;
		let fetchCalled = false;

		// Add event listeners using globals
		globalThis.addEventListener("install", () => {
			installCalled = true;
		});

		globalThis.addEventListener("activate", () => {
			activateCalled = true;
		});

		globalThis.addEventListener("fetch", (event) => {
			fetchCalled = true;
			event.respondWith(new Response("Hello from ServiceWorker!"));
		});

		// Test install event
		await runtime.install();
		expect(installCalled).toBe(true);

		// Test activate event
		await runtime.activate();
		expect(activateCalled).toBe(true);

		// Test fetch event
		const request = new Request("http://localhost/test");
		const response = await runtime.handleRequest(request);
		expect(fetchCalled).toBe(true);
		expect(await response.text()).toBe("Hello from ServiceWorker!");
	},
	TIMEOUT,
);

test(
	"ServiceWorker skipWaiting functionality",
	async () => {
		const {createServiceWorkerGlobals} = await import("../src/index.js");

		const runtime = createMockRuntime();
		const mockOptions = {
			isDevelopment: true,
			hotReload: async () => {
				// Mock hot reload function
				return true;
			},
		};

		createServiceWorkerGlobals(runtime, {options: mockOptions});

		// Test skipWaiting in development mode
		expect(typeof globalThis.skipWaiting).toBe("function");
		const result = await globalThis.skipWaiting();
		expect(result).toBeUndefined(); // skipWaiting returns void
	},
	TIMEOUT,
);

test(
	"ServiceWorker clients API",
	async () => {
		const {createServiceWorkerGlobals} = await import("../src/index.js");

		const runtime = createMockRuntime();
		createServiceWorkerGlobals(runtime, {});

		// Test clients global
		expect(typeof globalThis.clients).toBe("object");
		expect(typeof globalThis.clients.claim).toBe("function");
		expect(typeof globalThis.clients.get).toBe("function");
		expect(typeof globalThis.clients.matchAll).toBe("function");
		expect(typeof globalThis.clients.openWindow).toBe("function");

		// Test basic clients functionality
		const allClients = await globalThis.clients.matchAll();
		expect(Array.isArray(allClients)).toBe(true);

		// Test clients.claim()
		const claimResult = await globalThis.clients.claim();
		expect(claimResult).toBeUndefined(); // claim returns void
	},
	TIMEOUT,
);

test(
	"ServiceWorker buckets API",
	async () => {
		const {createServiceWorkerGlobals} = await import("../src/index.js");

		const runtime = createMockRuntime();
		const mockBuckets = {
			getDirectoryHandle: async (name) => ({
				name,
				kind: "directory",
				entries: async function* () {
					yield ["test.txt", {kind: "file"}];
				},
			}),
		};

		createServiceWorkerGlobals(runtime, {buckets: mockBuckets});

		// Test buckets global
		expect(typeof globalThis.buckets).toBe("object");
		expect(typeof globalThis.buckets.getDirectoryHandle).toBe("function");

		// Test bucket functionality
		const distBucket = await globalThis.buckets.getDirectoryHandle("dist");
		expect(distBucket.name).toBe("dist");
		expect(distBucket.kind).toBe("directory");

		// Test bucket entries
		const entries = [];
		for await (const [name, handle] of distBucket.entries()) {
			entries.push([name, handle]);
		}
		expect(entries.length).toBe(1);
		expect(entries[0][0]).toBe("test.txt");
	},
	TIMEOUT,
);

// ======================
// SERVICEWORKER LIFECYCLE TESTS
// ======================

test(
	"ServiceWorker lifecycle - install and activate",
	async () => {
		const {ServiceWorkerRuntime} = await import("../src/index.js");

		const runtime = new ServiceWorkerRuntime();
		let installEventFired = false;
		let activateEventFired = false;

		runtime.addEventListener("install", (event) => {
			installEventFired = true;
			expect(event.type).toBe("install");
		});

		runtime.addEventListener("activate", (event) => {
			activateEventFired = true;
			expect(event.type).toBe("activate");
		});

		// Test lifecycle sequence
		await runtime.install();
		expect(installEventFired).toBe(true);

		await runtime.activate();
		expect(activateEventFired).toBe(true);
	},
	TIMEOUT,
);

test(
	"ServiceWorker fetch event handling",
	async () => {
		const {ServiceWorkerRuntime} = await import("../src/index.js");

		const runtime = new ServiceWorkerRuntime();
		let fetchEventReceived = null;

		runtime.addEventListener("fetch", (event) => {
			fetchEventReceived = event;

			const url = new URL(event.request.url);
			if (url.pathname === "/hello") {
				event.respondWith(new Response("Hello World!"));
			} else if (url.pathname === "/json") {
				event.respondWith(Response.json({message: "JSON response"}));
			}
		});

		// Install and activate before handling requests
		await runtime.install();
		await runtime.activate();

		// Test different request types
		const helloRequest = new Request("http://localhost/hello");
		const helloResponse = await runtime.handleRequest(helloRequest);
		expect(await helloResponse.text()).toBe("Hello World!");
		expect(fetchEventReceived.request.url).toBe("http://localhost/hello");

		const jsonRequest = new Request("http://localhost/json");
		const jsonResponse = await runtime.handleRequest(jsonRequest);
		const jsonData = await jsonResponse.json();
		expect(jsonData.message).toBe("JSON response");
	},
	TIMEOUT,
);

test(
	"ServiceWorker event listener removal",
	async () => {
		const {ServiceWorkerRuntime} = await import("../src/index.js");

		const runtime = new ServiceWorkerRuntime();
		let callCount = 0;

		const listener = () => {
			callCount++;
		};

		// Add listener
		runtime.addEventListener("test", listener);

		// Fire event - should be called
		runtime.dispatchEvent(new Event("test"));
		expect(callCount).toBe(1);

		// Remove listener
		runtime.removeEventListener("test", listener);

		// Fire event again - should not be called
		runtime.dispatchEvent(new Event("test"));
		expect(callCount).toBe(1); // Still 1, not 2
	},
	TIMEOUT,
);

test(
	"ServiceWorker multiple listeners for same event",
	async () => {
		const {ServiceWorkerRuntime} = await import("../src/index.js");

		const runtime = new ServiceWorkerRuntime();
		const calls = [];

		runtime.addEventListener("fetch", (event) => {
			calls.push("listener1");
			event.respondWith(new Response("Response 1"));
		});

		runtime.addEventListener("fetch", (event) => {
			calls.push("listener2");
			// Second listener doesn't call respondWith
		});

		// Install and activate before handling requests
		await runtime.install();
		await runtime.activate();

		const request = new Request("http://localhost/test");
		const response = await runtime.handleRequest(request);

		// Both listeners should be called
		expect(calls).toEqual(["listener1", "listener2"]);

		// First listener's response should be used
		expect(await response.text()).toBe("Response 1");
	},
	TIMEOUT,
);

// ======================
// ERROR HANDLING TESTS
// ======================

test(
	"ServiceWorker error handling in event listeners",
	async () => {
		const {ServiceWorkerRuntime} = await import("../src/index.js");

		const runtime = new ServiceWorkerRuntime();

		// Temporarily capture uncaught exceptions to prevent test failure
		const originalHandler = process.listeners("uncaughtException");
		let caughtError = null;

		const testHandler = (error) => {
			if (error.message === "Test error") {
				caughtError = error;
			} else {
				throw error; // Re-throw if it's not our expected error
			}
		};

		process.removeAllListeners("uncaughtException");
		process.on("uncaughtException", testHandler);

		try {
			// Add fetch listener that throws
			runtime.addEventListener("fetch", (event) => {
				throw new Error("Test error");
			});

			// Install and activate before handling requests
			await runtime.install();
			await runtime.activate();

			const request = new Request("http://localhost/error");

			// Should reject with timeout error (no response provided) due to throwing listener
			await expect(runtime.handleRequest(request)).rejects.toThrow(
				"No response provided for fetch event",
			);

			// Give some time for the uncaught exception to be handled
			await new Promise((resolve) => setTimeout(resolve, 50));

			// Verify the uncaught exception was thrown as expected
			expect(caughtError).toBeTruthy();
			expect(caughtError.message).toBe("Test error");
		} finally {
			// Restore original uncaught exception handlers
			process.removeAllListeners("uncaughtException");
			originalHandler.forEach((handler) =>
				process.on("uncaughtException", handler),
			);
		}
	},
	TIMEOUT,
);

test(
	"ServiceWorker runtime reset functionality",
	async () => {
		const {ServiceWorkerRuntime} = await import("../src/index.js");

		const runtime = new ServiceWorkerRuntime();
		let listenerCalled = false;

		// Add listener
		runtime.addEventListener("test", () => {
			listenerCalled = true;
		});

		// Verify listener works
		runtime.dispatchEvent(new Event("test"));
		expect(listenerCalled).toBe(true);

		// Reset runtime
		runtime.reset();
		listenerCalled = false;

		// Listener should be removed after reset
		runtime.dispatchEvent(new Event("test"));
		expect(listenerCalled).toBe(false);
	},
	TIMEOUT,
);

test(
	"ServiceWorker install waitUntil rejection handling",
	async () => {
		const {ServiceWorkerRuntime} = await import("../src/index.js");

		const runtime = new ServiceWorkerRuntime();

		runtime.addEventListener("install", (event) => {
			// Add a promise that will reject asynchronously
			event.waitUntil(
				new Promise((_, reject) => {
					setTimeout(() => reject(new Error("Install task failed")), 10);
				}),
			);
		});

		// Install should fail when waitUntil promise rejects
		await expect(runtime.install()).rejects.toThrow("Install task failed");

		// Runtime should not be installed
		expect(runtime.ready).toBe(false);
	},
	TIMEOUT,
);

test(
	"ServiceWorker activate waitUntil rejection handling",
	async () => {
		const {ServiceWorkerRuntime} = await import("../src/index.js");

		const runtime = new ServiceWorkerRuntime();

		// Install first without errors
		await runtime.install();

		runtime.addEventListener("activate", (event) => {
			// Add a promise that will reject asynchronously
			event.waitUntil(
				new Promise((_, reject) => {
					setTimeout(() => reject(new Error("Activation task failed")), 10);
				}),
			);
		});

		// Activate should fail when waitUntil promise rejects
		await expect(runtime.activate()).rejects.toThrow("Activation task failed");

		// Runtime should not be ready (installed but not activated)
		expect(runtime.ready).toBe(false);
	},
	TIMEOUT,
);

test(
	"ServiceWorker fetch waitUntil rejection does not block response",
	async () => {
		const {ServiceWorkerRuntime} = await import("../src/index.js");

		const runtime = new ServiceWorkerRuntime();

		runtime.addEventListener("fetch", (event) => {
			event.respondWith(new Response("Hello World"));
			// Add a background task that will reject (should not affect response)
			event.waitUntil(
				new Promise((_, reject) => {
					setTimeout(() => reject(new Error("Background task failed")), 10);
				}),
			);
		});

		await runtime.install();
		await runtime.activate();

		const request = new Request("http://localhost/test");
		// Should successfully get response despite waitUntil rejection
		const response = await runtime.handleRequest(request);
		expect(await response.text()).toBe("Hello World");
	},
	TIMEOUT,
);

// ======================
// INTEGRATION TESTS
// ======================

test(
	"ServiceWorker complete workflow",
	async () => {
		const {ServiceWorkerRuntime, createServiceWorkerGlobals} = await import(
			"../src/index.js"
		);

		const runtime = new ServiceWorkerRuntime();

		// Set up globals like production does
		createServiceWorkerGlobals(runtime, {});
		globalThis.self = runtime;
		globalThis.addEventListener = runtime.addEventListener.bind(runtime);
		globalThis.removeEventListener = runtime.removeEventListener.bind(runtime);
		globalThis.dispatchEvent = runtime.dispatchEvent.bind(runtime);

		// Simulate user ServiceWorker code
		let installed = false;
		let activated = false;

		globalThis.addEventListener("install", (event) => {
			installed = true;
		});

		globalThis.addEventListener("activate", (event) => {
			activated = true;
		});

		globalThis.addEventListener("fetch", (event) => {
			const url = new URL(event.request.url);

			if (url.pathname === "/") {
				event.respondWith(
					new Response(
						`
					<!DOCTYPE html>
					<html>
						<head><title>Test App</title></head>
						<body><h1>Hello from ServiceWorker!</h1></body>
					</html>
				`,
						{
							headers: {"content-type": "text/html; charset=utf-8"},
						},
					),
				);
			} else if (url.pathname === "/api/health") {
				event.respondWith(
					Response.json({
						status: "ok",
						timestamp: Date.now(),
						installed,
						activated,
					}),
				);
			}
		});

		// Run complete lifecycle
		await runtime.install();
		expect(installed).toBe(true);

		await runtime.activate();
		expect(activated).toBe(true);

		// Test requests
		const homeRequest = new Request("http://localhost/");
		const homeResponse = await runtime.handleRequest(homeRequest);
		const homeText = await homeResponse.text();
		expect(homeText).toContain("Hello from ServiceWorker!");
		expect(homeResponse.headers.get("content-type")).toBe(
			"text/html; charset=utf-8",
		);

		const healthRequest = new Request("http://localhost/api/health");
		const healthResponse = await runtime.handleRequest(healthRequest);
		const healthData = await healthResponse.json();
		expect(healthData.status).toBe("ok");
		expect(healthData.installed).toBe(true);
		expect(healthData.activated).toBe(true);
		expect(typeof healthData.timestamp).toBe("number");
	},
	TIMEOUT,
);
