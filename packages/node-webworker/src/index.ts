/**
 * @b9g/node-webworker - Minimal Web Worker shim for Node.js
 *
 * This package provides a minimal Web Worker API implementation for Node.js
 * until native Web Worker support is added to Node.js core.
 *
 * @see https://github.com/nodejs/node/issues/43583
 */

import {Worker as NodeWorker} from "worker_threads";

/**
 * Event-like object for message events
 */
export interface MessageEvent {
	readonly data: any;
	readonly type: "message";
}

/**
 * Error event object
 */
export interface ErrorEvent {
	readonly error: Error;
	readonly type: "error";
}

/**
 * Worker wrapper code as a data URL
 * This provides Web Worker globals in the Node.js worker_threads context
 * Using a data URL avoids needing to write any files to disk (temp or otherwise)
 */
const WORKER_WRAPPER_CODE = `
import {parentPort} from "worker_threads";
import {getLogger} from "@logtape/logtape";

const logger = getLogger(["worker"]);

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
const WORKER_SCRIPT_URL = process.env.WORKER_SCRIPT_URL;
if (WORKER_SCRIPT_URL) {
	await import(WORKER_SCRIPT_URL);
} else {
	throw new Error("WORKER_SCRIPT_URL environment variable not set");
}
`;

// Create data URL from wrapper code (created once and reused)
const WORKER_WRAPPER_DATA_URL = new URL(
	`data:text/javascript,${encodeURIComponent(WORKER_WRAPPER_CODE)}`,
);

/**
 * Web Worker API implementation using Node.js worker_threads
 *
 * This provides a minimal, standards-compliant interface that maps
 * to Node.js worker_threads underneath.
 */
export class Worker {
	#nodeWorker: NodeWorker;
	#messageListeners: Set<(event: MessageEvent) => void>;
	#errorListeners: Set<(event: ErrorEvent) => void>;

	constructor(scriptURL: string, _options?: {type?: "classic" | "module"}) {
		this.#messageListeners = new Set<(event: MessageEvent) => void>();
		this.#errorListeners = new Set<(event: ErrorEvent) => void>();

		// Convert scriptURL to file:// URL if it's a path
		// Data URLs can't resolve relative paths, so we need absolute file:// URLs
		let workerScriptURL = scriptURL;
		if (!scriptURL.startsWith("file://") && !scriptURL.startsWith("data:")) {
			// It's a file path - convert to file:// URL
			workerScriptURL = `file://${scriptURL}`;
		}

		// Create Node.js Worker using data URL wrapper (no temp files needed!)
		this.#nodeWorker = new NodeWorker(WORKER_WRAPPER_DATA_URL, {
			...({type: "module"} as object),
			env: {
				...process.env,
				WORKER_SCRIPT_URL: workerScriptURL,
			},
		});

		// Set up event forwarding from Node.js Worker to Web Worker API
		this.#nodeWorker.on("message", (data) => {
			const event: MessageEvent = {data, type: "message"};
			this.#messageListeners.forEach((listener) => {
				try {
					listener(event);
				} catch (error) {
					logger.error("Error in message listener", {error});
				}
			});
		});

		this.#nodeWorker.on("error", (error) => {
			const event: ErrorEvent = {error, type: "error"};
			this.#errorListeners.forEach((listener) => {
				try {
					listener(event);
				} catch (listenerError) {
					logger.error(
						"[node-webworker] Error in error listener:",
						listenerError,
					);
				}
			});
		});
	}

	/**
	 * Send a message to the worker
	 */
	postMessage(message: any, transfer?: Transferable[]): void {
		if (transfer && transfer.length > 0) {
			console.warn("Transferable objects not fully supported");
		}
		this.#nodeWorker.postMessage(message);
	}

	/**
	 * Add an event listener (Web Worker API)
	 */
	addEventListener(
		type: "message",
		listener: (event: MessageEvent) => void,
	): void;
	addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
	addEventListener(type: string, listener: (event: any) => void): void {
		if (type === "message") {
			this.#messageListeners.add(listener as (event: MessageEvent) => void);
		} else if (type === "error") {
			this.#errorListeners.add(listener as (event: ErrorEvent) => void);
		} else {
			console.warn(`Unsupported event type: ${type}`);
		}
	}

	/**
	 * Remove an event listener
	 */
	removeEventListener(
		type: "message",
		listener: (event: MessageEvent) => void,
	): void;
	removeEventListener(
		type: "error",
		listener: (event: ErrorEvent) => void,
	): void;
	removeEventListener(type: string, listener: (event: any) => void): void {
		if (type === "message") {
			this.#messageListeners.delete(listener as (event: MessageEvent) => void);
		} else if (type === "error") {
			this.#errorListeners.delete(listener as (event: ErrorEvent) => void);
		}
	}

	/**
	 * Terminate the worker
	 */
	async terminate(): Promise<number> {
		const exitCode = await this.#nodeWorker.terminate();
		// Clean up listeners
		this.#messageListeners.clear();
		this.#errorListeners.clear();
		return exitCode;
	}

	/**
	 * Get the underlying Node.js Worker (for advanced usage)
	 */
	get nodeWorker_(): NodeWorker {
		return this.#nodeWorker;
	}
}

// Re-export for convenience
export default Worker;
