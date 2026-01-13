import {bench, group, run} from "mitata";
import {
	ServiceWorkerGlobals,
	ShovelServiceWorkerRegistration,
	FetchEvent,
	runLifecycle,
	dispatchRequest,
} from "../dist/src/runtime.js";
import {CustomCacheStorage} from "@b9g/cache";
import {MemoryCache} from "@b9g/cache/memory.js";

// Setup
const registration = new ShovelServiceWorkerRegistration();
const cacheStorage = new CustomCacheStorage(() => new MemoryCache());
const scope = new ServiceWorkerGlobals({
	registration,
	caches: cacheStorage,
});
scope.install();

// Pre-create response components
const jsonBody = JSON.stringify({message: "Hello, World!"});
const jsonHeaders = new Headers({"Content-Type": "application/json"});

// Simple inline handler - no event system
self.addEventListener("fetch", (event) => {
	event.respondWith(new Response(jsonBody, {headers: jsonHeaders}));
});

await runLifecycle(registration);

const testRequest = new Request("http://localhost:8080/json");

// Measure individual steps of handleRequest
group("handleRequest breakdown", () => {
	// Step 1: Create FetchEvent
	bench("1. Create FetchEvent", () => {
		const event = new FetchEvent("fetch", {request: testRequest});
		return event;
	});

	// Step 2: Dispatch event (this triggers the handler)
	bench("2. Full handleRequest (sync part)", () => {
		const event = new FetchEvent("fetch", {request: testRequest});
		registration._dispatchFetchEvent(event);
		return event;
	});

	// Step 3: Get response promise
	bench("3. dispatchRequest + await response", async () => {
		return dispatchRequest(registration, testRequest);
	});
});

// Compare with direct response creation
group("Direct vs Event-based", () => {
	bench("Direct: new Response()", () => {
		return new Response(jsonBody, {headers: jsonHeaders});
	});

	bench("Via dispatchRequest", async () => {
		return dispatchRequest(registration, testRequest);
	});
});

// Async overhead test
group("Async overhead", () => {
	bench("sync function", () => {
		return 1 + 1;
	});

	bench("async function (no await)", async () => {
		return 1 + 1;
	});

	bench("async function (await Promise.resolve)", async () => {
		return await Promise.resolve(1 + 1);
	});
});

await run({colors: true});
