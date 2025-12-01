/**
 * ServiceWorker Runtime contract tests
 *
 * Tests based on WPT service-workers/service-worker/ tests:
 * - extendable-event-waituntil.https.html
 * - extendable-event-async-waituntil.https.html
 * - fetch-event-async-respond-with.https.html
 *
 * These test the same spec behaviors but against our runtime implementation.
 */

import {describe, test, expect, beforeEach} from "bun:test";

/**
 * Configuration for running runtime tests
 */
export interface RuntimeTestConfig {
	/**
	 * Factory to create ExtendableEvent
	 * Should match the ServiceWorker spec behavior
	 */
	createExtendableEvent: (type: string) => ExtendableEventLike;

	/**
	 * Factory to create FetchEvent
	 */
	createFetchEvent: (request: Request) => FetchEventLike;

	/**
	 * Factory to create InstallEvent
	 */
	createInstallEvent: () => ExtendableEventLike;

	/**
	 * Factory to create ActivateEvent
	 */
	createActivateEvent: () => ExtendableEventLike;

	/**
	 * Symbol or method to end the dispatch phase (internal API)
	 * Called after synchronous dispatch completes
	 */
	endDispatchPhase: (event: ExtendableEventLike) => void;

	/**
	 * Get promises registered via waitUntil
	 */
	getPromises: (event: ExtendableEventLike) => Promise<any>[];
}

interface ExtendableEventLike extends Event {
	waitUntil(promise: Promise<any>): void;
}

interface FetchEventLike extends ExtendableEventLike {
	readonly request: Request;
	respondWith(response: Response | Promise<Response>): void;
	getResponse(): Promise<Response> | null;
	hasResponded(): boolean;
}

/**
 * Run ServiceWorker runtime contract tests
 *
 * @param name Name for the test suite
 * @param config Test configuration with event factories
 */
export function runRuntimeTests(name: string, config: RuntimeTestConfig): void {
	describe(`ServiceWorker Runtime Tests: ${name}`, () => {
		// =====================================================================
		// ExtendableEvent.waitUntil() tests
		// Based on: extendable-event-waituntil.https.html
		// =====================================================================
		describe("ExtendableEvent.waitUntil()", () => {
			test("can be called synchronously during dispatch", () => {
				const event = config.createExtendableEvent("test");
				// Should not throw during dispatch phase
				expect(() => {
					event.waitUntil(Promise.resolve());
				}).not.toThrow();
			});

			test("can be called multiple times during dispatch", () => {
				const event = config.createExtendableEvent("test");
				expect(() => {
					event.waitUntil(Promise.resolve("first"));
					event.waitUntil(Promise.resolve("second"));
					event.waitUntil(Promise.resolve("third"));
				}).not.toThrow();

				const promises = config.getPromises(event);
				expect(promises.length).toBe(3);
			});

			test("throws InvalidStateError after dispatch with no pending promises", async () => {
				const event = config.createExtendableEvent("test");

				// End dispatch phase
				config.endDispatchPhase(event);

				// Should throw because dispatch ended and no pending promises
				expect(() => {
					event.waitUntil(Promise.resolve());
				}).toThrow();
			});

			test("can be called after dispatch if there are pending promises", async () => {
				const event = config.createExtendableEvent("test");

				// Create a pending promise that won't resolve immediately
				let resolveFirst: () => void;
				const pendingPromise = new Promise<void>((resolve) => {
					resolveFirst = resolve;
				});

				// Add pending promise during dispatch
				event.waitUntil(pendingPromise);

				// End dispatch phase
				config.endDispatchPhase(event);

				// Should succeed because there's still a pending promise
				expect(() => {
					event.waitUntil(Promise.resolve("second"));
				}).not.toThrow();

				// Cleanup
				resolveFirst!();
			});

			test("throws after all pending promises resolve", async () => {
				const event = config.createExtendableEvent("test");

				// Create a promise we can control
				let resolveFirst: () => void;
				const pendingPromise = new Promise<void>((resolve) => {
					resolveFirst = resolve;
				});

				event.waitUntil(pendingPromise);
				config.endDispatchPhase(event);

				// Resolve the pending promise
				resolveFirst!();
				await pendingPromise;

				// Wait a tick for the finally handler to run
				await new Promise((r) => setTimeout(r, 0));

				// Now should throw - no more pending promises
				expect(() => {
					event.waitUntil(Promise.resolve());
				}).toThrow();
			});
		});

		// =====================================================================
		// ExtendableEvent async waitUntil tests
		// Based on: extendable-event-async-waituntil.https.html
		// =====================================================================
		describe("ExtendableEvent async waitUntil()", () => {
			test("waitUntil in same microtask succeeds", async () => {
				const event = config.createExtendableEvent("test");

				// Queue a microtask during dispatch
				let microtaskRan = false;
				queueMicrotask(() => {
					// This runs in same microtask turn as dispatch
					expect(() => {
						event.waitUntil(Promise.resolve());
					}).not.toThrow();
					microtaskRan = true;
				});

				// Don't end dispatch until after microtask
				await Promise.resolve();
				config.endDispatchPhase(event);

				expect(microtaskRan).toBe(true);
			});

			test("waitUntil in setTimeout without pending extension throws", async () => {
				const event = config.createExtendableEvent("test");
				config.endDispatchPhase(event);

				await new Promise<void>((resolve) => {
					setTimeout(() => {
						expect(() => {
							event.waitUntil(Promise.resolve());
						}).toThrow();
						resolve();
					}, 0);
				});
			});

			test("waitUntil in setTimeout with pending extension succeeds", async () => {
				const event = config.createExtendableEvent("test");

				// Add a long-running promise
				let resolveIt: () => void;
				const longPromise = new Promise<void>((r) => {
					resolveIt = r;
				});
				event.waitUntil(longPromise);

				config.endDispatchPhase(event);

				await new Promise<void>((resolve) => {
					setTimeout(() => {
						// Should succeed because longPromise is still pending
						expect(() => {
							event.waitUntil(Promise.resolve());
						}).not.toThrow();
						resolve();
					}, 0);
				});

				resolveIt!();
			});
		});

		// =====================================================================
		// FetchEvent.respondWith() tests
		// Based on: fetch-event-async-respond-with.https.html
		// =====================================================================
		describe("FetchEvent.respondWith()", () => {
			test("can be called synchronously during dispatch", () => {
				const request = new Request("https://example.com/test");
				const event = config.createFetchEvent(request);

				expect(() => {
					event.respondWith(new Response("hello"));
				}).not.toThrow();

				expect(event.hasResponded()).toBe(true);
			});

			test("throws if called twice", () => {
				const request = new Request("https://example.com/test");
				const event = config.createFetchEvent(request);

				event.respondWith(new Response("first"));

				expect(() => {
					event.respondWith(new Response("second"));
				}).toThrow();
			});

			test("throws InvalidStateError in setTimeout", async () => {
				const request = new Request("https://example.com/test");
				const event = config.createFetchEvent(request);

				config.endDispatchPhase(event);

				await new Promise<void>((resolve) => {
					setTimeout(() => {
						expect(() => {
							event.respondWith(new Response("late"));
						}).toThrow();
						resolve();
					}, 0);
				});
			});

			test("respondWith in microtask succeeds (during dispatch)", async () => {
				const request = new Request("https://example.com/test");
				const event = config.createFetchEvent(request);

				let responded = false;
				queueMicrotask(() => {
					expect(() => {
						event.respondWith(new Response("from microtask"));
					}).not.toThrow();
					responded = true;
				});

				await Promise.resolve();
				config.endDispatchPhase(event);

				expect(responded).toBe(true);
			});

			test("respondWith extends event lifetime (allows async waitUntil)", async () => {
				const request = new Request("https://example.com/test");
				const event = config.createFetchEvent(request);

				// Create a pending response
				let resolveResponse: (r: Response) => void;
				const responsePromise = new Promise<Response>((r) => {
					resolveResponse = r;
				});

				event.respondWith(responsePromise);
				config.endDispatchPhase(event);

				// waitUntil should succeed because respondWith promise is pending
				await new Promise<void>((resolve) => {
					setTimeout(() => {
						expect(() => {
							event.waitUntil(Promise.resolve("background task"));
						}).not.toThrow();
						resolve();
					}, 0);
				});

				resolveResponse!(new Response("done"));
			});

			test("getResponse returns the response promise", async () => {
				const request = new Request("https://example.com/test");
				const event = config.createFetchEvent(request);

				const response = new Response("test body");
				event.respondWith(response);

				const result = await event.getResponse();
				expect(result).toBeDefined();
				expect(await result?.text()).toBe("test body");
			});
		});

		// =====================================================================
		// Install/Activate event lifecycle tests
		// Based on: extendable-event-waituntil.https.html
		// =====================================================================
		describe("Install/Activate lifecycle events", () => {
			test("InstallEvent is an ExtendableEvent", () => {
				const event = config.createInstallEvent();
				expect(event.type).toBe("install");
				expect(typeof event.waitUntil).toBe("function");
			});

			test("ActivateEvent is an ExtendableEvent", () => {
				const event = config.createActivateEvent();
				expect(event.type).toBe("activate");
				expect(typeof event.waitUntil).toBe("function");
			});

			test("install waitUntil fulfilled allows state transition", async () => {
				const event = config.createInstallEvent();

				let resolved = false;
				event.waitUntil(
					new Promise<void>((resolve) => {
						setTimeout(() => {
							resolved = true;
							resolve();
						}, 10);
					}),
				);

				config.endDispatchPhase(event);

				// Wait for all promises
				await Promise.all(config.getPromises(event));

				expect(resolved).toBe(true);
			});

			test("install waitUntil rejected should fail install", async () => {
				const event = config.createInstallEvent();

				event.waitUntil(Promise.reject(new Error("install failed")));

				config.endDispatchPhase(event);

				// The promises should reject
				await expect(Promise.all(config.getPromises(event))).rejects.toThrow(
					"install failed",
				);
			});
		});
	});
}
