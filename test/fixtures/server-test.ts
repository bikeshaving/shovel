/// <reference lib="webworker" />

// The lib declares: var self: WorkerGlobalScope & typeof globalThis
// We want to narrow it to ServiceWorkerGlobalScope

// Can we use declaration merging to change self's type?
// No - var declarations can't be merged, only interfaces

// What about using a const assertion or type guard?
// That wouldn't help at the module level

// The standard approach: Just declare self as the narrower type
declare var self: ServiceWorkerGlobalScope & typeof globalThis;

self.addEventListener("fetch", (event) => {
	// event should now be FetchEvent
	event.respondWith(new Response("test"));
});

export {};
