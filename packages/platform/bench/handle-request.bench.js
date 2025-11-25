import {bench, group, run} from "mitata";
import {
	ShovelGlobalScope,
	ShovelServiceWorkerRegistration,
	FetchEvent,
} from "../dist/src/runtime.js";
import {CustomCacheStorage} from "@b9g/cache";
import {MemoryCache} from "@b9g/cache/memory.js";

// Setup
const registration = new ShovelServiceWorkerRegistration();
const cacheStorage = new CustomCacheStorage((name) => new MemoryCache(name));
const scope = new ShovelGlobalScope({
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

await registration.install();
await registration.activate();

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
	bench("3. handleRequest + await response", async () => {
		return registration.handleRequest(testRequest);
	});
});

// Compare with direct response creation
group("Direct vs Event-based", () => {
	bench("Direct: new Response()", () => {
		return new Response(jsonBody, {headers: jsonHeaders});
	});

	bench("Via handleRequest", async () => {
		return registration.handleRequest(testRequest);
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
