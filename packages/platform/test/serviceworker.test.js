import {test, expect} from "bun:test";

/**
 * ServiceWorker globals and lifecycle tests
 * Tests the ServiceWorker implementation, globals setup, and lifecycle events
 */

const TIMEOUT = 1000;

// Helper to create a mock platform for testing
function _createMockPlatform() {
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

// ======================
// SERVICEWORKER GLOBALS TESTS
// ======================

test(
	"ServiceWorker globals setup",
	async () => {
		// Import ServiceWorker classes
		const {ShovelServiceWorkerRegistration, ServiceWorkerGlobals} =
			await import("../src/runtime.js");

		const registration = new ShovelServiceWorkerRegistration();
		const mockDirectories = {
			open: async (name) => ({
				name,
				kind: "directory",
			}),
		};

		// Create ServiceWorker globals installer
		const scope = new ServiceWorkerGlobals({
			registration,
			directories: mockDirectories,
		});
		scope.install();

		// Test that globals are properly set
		expect(typeof globalThis.self).toBe("object");
		expect(typeof globalThis.addEventListener).toBe("function");
		expect(typeof globalThis.removeEventListener).toBe("function");
		expect(typeof globalThis.dispatchEvent).toBe("function");
		expect(typeof globalThis.skipWaiting).toBe("function");
		expect(typeof globalThis.clients).toBe("object");
		expect(typeof globalThis.directories).toBe("object");

		// Test that self === globalThis (browser invariant)
		expect(globalThis.self).toBe(globalThis);
	},
	TIMEOUT,
);

test(
	"ServiceWorker event listener functionality",
	async () => {
		const {ShovelServiceWorkerRegistration, ServiceWorkerGlobals} =
			await import("../src/runtime.js");

		const registration = new ShovelServiceWorkerRegistration();
		const scope = new ServiceWorkerGlobals({registration});
		scope.install();

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
		await registration.install();
		expect(installCalled).toBe(true);

		// Test activate event
		await registration.activate();
		expect(activateCalled).toBe(true);

		// Test fetch event
		const request = new Request("http://localhost/test");
		const response = await registration.handleRequest(request);
		expect(fetchCalled).toBe(true);
		expect(await response.text()).toBe("Hello from ServiceWorker!");
	},
	TIMEOUT,
);

test(
	"ServiceWorker clients API",
	async () => {
		const {ShovelServiceWorkerRegistration, ServiceWorkerGlobals} =
			await import("../src/runtime.js");

		const registration = new ShovelServiceWorkerRegistration();
		const scope = new ServiceWorkerGlobals({registration});
		scope.install();

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
	"ServiceWorker directories API",
	async () => {
		const {ShovelServiceWorkerRegistration, ServiceWorkerGlobals} =
			await import("../src/runtime.js");

		const registration = new ShovelServiceWorkerRegistration();
		const mockDirectories = {
			open: async (name) => ({
				name,
				kind: "directory",
				entries: async function* () {
					yield ["test.txt", {kind: "file"}];
				},
			}),
		};

		const scope = new ServiceWorkerGlobals({
			registration,
			directories: mockDirectories,
		});
		scope.install();

		// Test directories global
		expect(typeof globalThis.directories).toBe("object");
		expect(typeof globalThis.directories.open).toBe("function");

		// Test directory functionality
		const distDir = await globalThis.directories.open("dist");
		expect(distDir.name).toBe("dist");
		expect(distDir.kind).toBe("directory");

		// Test directory entries
		const entries = [];
		for await (const [name, handle] of distDir.entries()) {
			entries.push([name, handle]);
		}
		expect(entries.length).toBe(1);
		expect(entries[0][0]).toBe("test.txt");
	},
	TIMEOUT,
);

test(
	"ServiceWorker loggers API",
	async () => {
		const {
			ShovelServiceWorkerRegistration,
			ServiceWorkerGlobals,
			CustomLoggerStorage,
		} = await import("../src/runtime.js");

		const registration = new ShovelServiceWorkerRegistration();

		// Create mock logger factory that tracks calls
		const loggerCalls = [];
		const mockLoggerFactory = (...categories) => {
			loggerCalls.push(categories);
			// Return a mock logger with standard methods
			return {
				debug: () => {},
				info: () => {},
				warn: () => {},
				error: () => {},
				fatal: () => {},
			};
		};

		const loggers = new CustomLoggerStorage(mockLoggerFactory);

		const scope = new ServiceWorkerGlobals({
			registration,
			loggers,
		});
		scope.install();

		// Test loggers global
		expect(typeof globalThis.loggers).toBe("object");
		expect(typeof globalThis.loggers.open).toBe("function");

		// Test opening logger with single category
		const appLogger = globalThis.loggers.open("app");
		expect(loggerCalls[0]).toEqual(["app"]);
		expect(typeof appLogger.info).toBe("function");
		expect(typeof appLogger.warn).toBe("function");
		expect(typeof appLogger.error).toBe("function");

		// Test opening logger with multiple categories
		const _dbLogger = globalThis.loggers.open("app", "db");
		expect(loggerCalls[1]).toEqual(["app", "db"]);

		// Test opening logger with deeply nested categories
		const _queryLogger = globalThis.loggers.open("app", "db", "queries");
		expect(loggerCalls[2]).toEqual(["app", "db", "queries"]);
	},
	TIMEOUT,
);

test(
	"ServiceWorker loggers in fetch handler",
	async () => {
		const {
			ShovelServiceWorkerRegistration,
			ServiceWorkerGlobals,
			CustomLoggerStorage,
		} = await import("../src/runtime.js");

		const registration = new ShovelServiceWorkerRegistration();

		// Track log messages
		const logMessages = [];
		const mockLoggerFactory = (...categories) => ({
			debug: (msg) => logMessages.push({level: "debug", categories, msg}),
			info: (msg) => logMessages.push({level: "info", categories, msg}),
			warn: (msg) => logMessages.push({level: "warn", categories, msg}),
			error: (msg) => logMessages.push({level: "error", categories, msg}),
			fatal: (msg) => logMessages.push({level: "fatal", categories, msg}),
		});

		const loggers = new CustomLoggerStorage(mockLoggerFactory);

		const scope = new ServiceWorkerGlobals({
			registration,
			loggers,
		});
		scope.install();

		// ServiceWorker that uses logging
		globalThis.addEventListener("fetch", (event) => {
			const logger = globalThis.loggers.open("app");
			logger.info("Handling request");

			event.respondWith(new Response("OK"));
		});

		await registration.install();
		await registration.activate();

		const request = new Request("http://localhost/test");
		const response = await registration.handleRequest(request);

		expect(await response.text()).toBe("OK");
		expect(logMessages.length).toBeGreaterThanOrEqual(1);
		expect(logMessages.find((m) => m.categories[0] === "app")).toBeDefined();
	},
	TIMEOUT,
);

// ======================
// SERVICEWORKER LIFECYCLE TESTS
// ======================

test(
	"ServiceWorker lifecycle - install and activate",
	async () => {
		const {ShovelServiceWorkerRegistration} = await import("../src/runtime.js");

		const runtime = new ShovelServiceWorkerRegistration();
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
		const {ShovelServiceWorkerRegistration} = await import("../src/runtime.js");

		const runtime = new ShovelServiceWorkerRegistration();
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
		const {ShovelServiceWorkerRegistration} = await import("../src/runtime.js");

		const runtime = new ShovelServiceWorkerRegistration();
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
		const {ShovelServiceWorkerRegistration} = await import("../src/runtime.js");

		const runtime = new ShovelServiceWorkerRegistration();
		const calls = [];

		runtime.addEventListener("fetch", (event) => {
			calls.push("listener1");
			event.respondWith(new Response("Response 1"));
		});

		runtime.addEventListener("fetch", (_event) => {
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
	"ServiceWorker install waitUntil rejection handling",
	async () => {
		const {ShovelServiceWorkerRegistration} = await import("../src/runtime.js");

		const runtime = new ShovelServiceWorkerRegistration();

		runtime.addEventListener("install", (event) => {
			// Add a promise that will reject
			event.waitUntil(
				(async () => {
					throw new Error("Install task failed");
				})(),
			);
		});

		// Install should fail when waitUntil promise rejects
		let errorCaught = false;
		try {
			await runtime.install();
			// Should not reach here - install should have thrown
		} catch (error) {
			errorCaught = true;
			expect(error.message).toBe("Install task failed");
		}

		expect(errorCaught).toBe(true);

		// Runtime should not be installed
		expect(runtime.ready).toBe(false);
	},
	TIMEOUT,
);

test(
	"ServiceWorker activate waitUntil rejection handling",
	async () => {
		const {ShovelServiceWorkerRegistration} = await import("../src/runtime.js");

		const runtime = new ShovelServiceWorkerRegistration();

		// Install first without errors
		await runtime.install();

		runtime.addEventListener("activate", (event) => {
			// Add a promise that will reject
			event.waitUntil(
				(async () => {
					throw new Error("Activation task failed");
				})(),
			);
		});

		// Activate should fail when waitUntil promise rejects
		let errorCaught = false;
		try {
			await runtime.activate();
			// Should not reach here - activate should have thrown
		} catch (error) {
			errorCaught = true;
			expect(error.message).toBe("Activation task failed");
		}

		expect(errorCaught).toBe(true);

		// Runtime should not be ready (installed but not activated)
		expect(runtime.ready).toBe(false);
	},
	TIMEOUT,
);

test(
	"ServiceWorker fetch waitUntil rejection does not block response",
	async () => {
		const {ShovelServiceWorkerRegistration} = await import("../src/runtime.js");

		const runtime = new ShovelServiceWorkerRegistration();

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
		const {ShovelServiceWorkerRegistration, ServiceWorkerGlobals} =
			await import("../src/runtime.js");

		const registration = new ShovelServiceWorkerRegistration();

		// Set up globals like production does
		const scope = new ServiceWorkerGlobals({registration});
		scope.install();

		// Simulate user ServiceWorker code
		let installed = false;
		let activated = false;

		globalThis.addEventListener("install", (_event) => {
			installed = true;
		});

		globalThis.addEventListener("activate", (_event) => {
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
		await registration.install();
		expect(installed).toBe(true);

		await registration.activate();
		expect(activated).toBe(true);

		// Test requests
		const homeRequest = new Request("http://localhost/");
		const homeResponse = await registration.handleRequest(homeRequest);
		const homeText = await homeResponse.text();
		expect(homeText).toContain("Hello from ServiceWorker!");
		expect(homeResponse.headers.get("content-type")).toBe(
			"text/html; charset=utf-8",
		);

		const healthRequest = new Request("http://localhost/api/health");
		const healthResponse = await registration.handleRequest(healthRequest);
		const healthData = await healthResponse.json();
		expect(healthData.status).toBe("ok");
		expect(healthData.installed).toBe(true);
		expect(healthData.activated).toBe(true);
		expect(typeof healthData.timestamp).toBe("number");
	},
	TIMEOUT,
);
