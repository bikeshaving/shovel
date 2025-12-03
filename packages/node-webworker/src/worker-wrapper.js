/**
 * Worker wrapper that provides Web Worker globals to the actual worker script
 * This runs in the Node.js worker_threads context and sets up Web Worker API
 */

import {parentPort} from "worker_threads";

// Provide Web Worker globals
globalThis.onmessage = null;
globalThis.postMessage = (data) => parentPort.postMessage(data);

// Set up message forwarding
parentPort.on("message", (data) => {
	if (globalThis.onmessage) {
		globalThis.onmessage({data, type: "message"});
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
