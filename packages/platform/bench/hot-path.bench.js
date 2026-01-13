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

// Setup: Create a minimal ServiceWorker environment
const registration = new ShovelServiceWorkerRegistration();
const cacheStorage = new CustomCacheStorage(() => new MemoryCache());
const scope = new ServiceWorkerGlobals({
	registration,
	caches: cacheStorage,
});

// Install scope
scope.install();

// Register a simple fetch handler (like TFB /json endpoint)
const jsonResponse = JSON.stringify({message: "Hello, World!"});
const jsonHeaders = new Headers({"Content-Type": "application/json"});

self.addEventListener("fetch", (event) => {
	event.respondWith(new Response(jsonResponse, {headers: jsonHeaders}));
});

// Activate
await runLifecycle(registration);

// Create test request
const testRequest = new Request("http://localhost:8080/json");

// Benchmarks
group("Hot Path Components", () => {
	bench("baseline: new Response(json)", () => {
		return new Response(jsonResponse, {headers: jsonHeaders});
	});

	bench("new Request(url)", () => {
		return new Request("http://localhost:8080/json");
	});

	bench("new Headers()", () => {
		return new Headers({"Content-Type": "application/json"});
	});

	bench("new FetchEvent(request)", () => {
		return new FetchEvent("fetch", {request: testRequest});
	});

	bench("dispatchRequest(registration, request)", async () => {
		return dispatchRequest(registration, testRequest);
	});
});

group("Response Creation", () => {
	bench("new Response(string)", () => {
		return new Response("Hello");
	});

	bench("new Response(json, headers)", () => {
		return new Response(jsonResponse, {headers: jsonHeaders});
	});

	bench("new Response(json, new Headers())", () => {
		return new Response(jsonResponse, {
			headers: new Headers({"Content-Type": "application/json"}),
		});
	});

	bench("Response.json()", () => {
		return Response.json({message: "Hello, World!"});
	});
});

group("Headers Operations", () => {
	bench("new Headers()", () => {
		return new Headers();
	});

	bench("new Headers(object)", () => {
		return new Headers({"Content-Type": "application/json"});
	});

	bench("headers.set()", () => {
		const h = new Headers();
		h.set("Content-Type", "application/json");
		return h;
	});

	const existingHeaders = new Headers({"Content-Type": "application/json"});
	bench("headers.get() (existing)", () => {
		return existingHeaders.get("Content-Type");
	});
});

group("JSON Operations", () => {
	const obj = {message: "Hello, World!"};
	const str = JSON.stringify(obj);

	bench("JSON.stringify(small)", () => {
		return JSON.stringify(obj);
	});

	bench("JSON.parse(small)", () => {
		return JSON.parse(str);
	});
});

await run({
	colors: true,
	percentiles: true,
});
