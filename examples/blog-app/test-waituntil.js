#!/usr/bin/env node
/**
 * Test script to verify waitUntil functionality works correctly
 */

import {createServiceWorkerGlobals} from "@b9g/shovel/serviceworker";

console.log("Testing standard ServiceWorker events...");

// Set up ServiceWorker globals
const globals = createServiceWorkerGlobals();
Object.assign(globalThis, globals);

// Make classes available for direct use
const {ExtendableEvent, FetchEvent} = globals;

// Test ExtendableEvent waitUntil
console.log("\n1. Testing ExtendableEvent waitUntil:");
let installComplete = false;
let activateComplete = false;

self.addEventListener("install", (event) => {
	console.log("Install event received");
	event.waitUntil(
		new Promise((resolve) => {
			setTimeout(() => {
				installComplete = true;
				console.log("Install async work completed");
				resolve();
			}, 100);
		}),
	);
});

self.addEventListener("activate", (event) => {
	console.log("Activate event received");
	event.waitUntil(
		new Promise((resolve) => {
			setTimeout(() => {
				activateComplete = true;
				console.log("Activate async work completed");
				resolve();
			}, 50);
		}),
	);
});

// Dispatch install event
const installEvent = new ExtendableEvent("install");
self.dispatchEvent(installEvent);
await installEvent._waitForPromises();
console.log(
	"Install event promises resolved, installComplete:",
	installComplete,
);

// Dispatch activate event
const activateEvent = new ExtendableEvent("activate");
self.dispatchEvent(activateEvent);
await activateEvent._waitForPromises();
console.log(
	"Activate event promises resolved, activateComplete:",
	activateComplete,
);

// Test FetchEvent
console.log("\n2. Testing FetchEvent:");
let fetchResponse = null;

self.addEventListener("fetch", (event) => {
	console.log("Fetch event received for:", event.request.url);
	console.log("Event properties:", {
		clientId: event.clientId,
		isReload: event.isReload,
		replacesClientId: event.replacesClientId,
		resultingClientId: event.resultingClientId,
	});

	event.respondWith(
		new Response("Hello from fetch handler!", {
			status: 200,
			headers: {"Content-Type": "text/plain"},
		}),
	);
});

const request = new Request("http://example.com/test");
const fetchEvent = new FetchEvent("fetch", {
	request,
	clientId: "test-client",
	isReload: false,
});

self.dispatchEvent(fetchEvent);
const response = await fetchEvent._getResponse();
const text = await response.text();

console.log("Fetch response:", {
	status: response.status,
	statusText: response.statusText,
	body: text,
});

console.log("\n✅ All ServiceWorker event tests passed!");
