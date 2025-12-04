/**
 * Worker wrapper that provides Web Worker globals to the actual worker script
 * This runs in the Node.js worker_threads context and sets up Web Worker API
 */

import {parentPort} from "worker_threads";

// Message event listeners (for addEventListener support)
const messageListeners = new Set();

// Provide Web Worker globals
globalThis.onmessage = null;
globalThis.postMessage = (data, transfer) => {
	if (transfer && transfer.length > 0) {
		parentPort.postMessage(data, transfer);
	} else {
		parentPort.postMessage(data);
	}
};

// Provide self (same as globalThis in workers)
globalThis.self = globalThis;

// Provide addEventListener/removeEventListener for message events
globalThis.addEventListener = (type, listener) => {
	if (type === "message") {
		messageListeners.add(listener);
	}
};
globalThis.removeEventListener = (type, listener) => {
	if (type === "message") {
		messageListeners.delete(listener);
	}
};

// Set up message forwarding
parentPort.on("message", (data) => {
	const event = {data, type: "message"};

	// Call onmessage handler if set
	if (globalThis.onmessage) {
		globalThis.onmessage(event);
	}

	// Call addEventListener handlers
	for (const listener of messageListeners) {
		listener(event);
	}
});

// Import the actual worker script URL from environment variable
// eslint-disable-next-line no-restricted-properties -- Worker receives script path via env
const WORKER_SCRIPT_URL = process.env.WORKER_SCRIPT_URL;
if (WORKER_SCRIPT_URL) {
	await import(WORKER_SCRIPT_URL);
} else {
	throw new Error("WORKER_SCRIPT_URL environment variable not set");
}
