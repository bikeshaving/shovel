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
 * Message event for worker communication
 */
export class MessageEvent extends Event {
	readonly data: any;

	constructor(data: any) {
		super("message");
		this.data = data;
	}
}

/**
 * Error event for worker errors
 */
export class ErrorEvent extends Event {
	readonly error: Error;

	constructor(error: Error) {
		super("error");
		this.error = error;
	}
}

/**
 * Worker wrapper code as a data URL
 * This provides Web Worker globals in the Node.js worker_threads context
 * Using a data URL avoids needing to write any files to disk (temp or otherwise)
 */
// Compact wrapper code to keep data URL length under limits
const WORKER_WRAPPER_CODE = `import{parentPort as p}from"worker_threads";const l=new Set();globalThis.onmessage=null;globalThis.onmessageerror=null;globalThis.postMessage=(d,t)=>t?.length?p.postMessage(d,t):p.postMessage(d);globalThis.self=globalThis;globalThis.addEventListener=(t,f)=>t==="message"&&l.add(f);globalThis.removeEventListener=(t,f)=>t==="message"&&l.delete(f);p.on("message",d=>{const e={data:d,type:"message"};globalThis.onmessage?.(e);l.forEach(f=>f(e))});const u=process.env.WORKER_SCRIPT_URL;if(u)await import(u);else throw Error("WORKER_SCRIPT_URL not set");`;

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
	#messageerrorListeners: Set<(event: MessageEvent) => void>;

	// Web Worker standard properties
	onmessage: ((event: MessageEvent) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
	onmessageerror: ((event: MessageEvent) => void) | null;

	constructor(
		scriptURL: string | URL,
		_options?: {type?: "classic" | "module"},
	) {
		this.#messageListeners = new Set<(event: MessageEvent) => void>();
		this.#errorListeners = new Set<(event: ErrorEvent) => void>();
		this.#messageerrorListeners = new Set<(event: MessageEvent) => void>();
		this.onmessage = null;
		this.onerror = null;
		this.onmessageerror = null;

		// Convert scriptURL to string (handles URL objects via toString())
		// Per Web Worker spec: accepts both strings and URL objects
		const scriptURLString = scriptURL.toString();

		// Resolve the worker script URL
		// Standard usage: new Worker(new URL("./worker.js", import.meta.url))
		// This gives us an absolute file:// URL which we can use directly
		let workerScriptURL = scriptURLString;

		// If it's not already a file:// or data: URL, and it's an absolute path, convert it
		if (
			!scriptURLString.startsWith("file://") &&
			!scriptURLString.startsWith("data:")
		) {
			// Check if it's a relative path
			if (
				scriptURLString.startsWith("./") ||
				scriptURLString.startsWith("../")
			) {
				throw new Error(
					"Relative paths are not supported. Use new Worker(new URL('./worker.js', import.meta.url)) instead.",
				);
			}
			// It's an absolute file path - convert to file:// URL
			workerScriptURL = `file://${scriptURLString}`;
		}

		// Create Node.js Worker using data URL wrapper (no temp files needed!)
		this.#nodeWorker = new NodeWorker(WORKER_WRAPPER_DATA_URL, {
			...({type: "module"} as object),
			env: {
				// eslint-disable-next-line no-restricted-properties -- Workers inherit parent env
				...process.env,
				WORKER_SCRIPT_URL: workerScriptURL,
			},
		});

		this.#setupEventForwarding();
	}

	/**
	 * Report an error through the error event mechanism
	 */
	#reportError(error: any): void {
		const event = new ErrorEvent(error);

		// Call onerror handler if set
		if (this.onerror) {
			this.onerror(event);
		}

		// Call error event listeners
		this.#errorListeners.forEach((listener) => {
			listener(event);
		});
	}

	/**
	 * Set up event forwarding from Node.js Worker to Web Worker API
	 */
	#setupEventForwarding(): void {
		this.#nodeWorker.on("message", (data) => {
			const event = new MessageEvent(data);

			// Call onmessage handler if set (Web Worker standard)
			if (this.onmessage) {
				try {
					this.onmessage(event);
				} catch (error) {
					// Report error through error event mechanism per spec
					this.#reportError(error);
				}
			}

			// Call addEventListener handlers
			this.#messageListeners.forEach((listener) => {
				try {
					listener(event);
				} catch (error) {
					// Report error through error event mechanism per spec
					this.#reportError(error);
				}
			});
		});

		this.#nodeWorker.on("error", (error) => {
			// Report error through error event mechanism
			this.#reportError(error);
		});

		this.#nodeWorker.on("messageerror", (data) => {
			const event = new MessageEvent(data);

			// Call onmessageerror handler if set
			if (this.onmessageerror) {
				this.onmessageerror(event);
			}

			// Call messageerror event listeners
			this.#messageerrorListeners.forEach((listener) => {
				listener(event);
			});
		});
	}

	/**
	 * Send a message to the worker
	 */
	postMessage(message: any, transfer?: Transferable[]): void {
		if (transfer && transfer.length > 0) {
			// Node.js Worker supports transferList in options
			this.#nodeWorker.postMessage(message, transfer as any);
		} else {
			this.#nodeWorker.postMessage(message);
		}
	}

	/**
	 * Add an event listener (Web Worker API)
	 */
	addEventListener(
		type: "message",
		listener: (event: MessageEvent) => void,
	): void;
	addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
	addEventListener(
		type: "messageerror",
		listener: (event: MessageEvent) => void,
	): void;
	addEventListener(type: string, listener: (event: any) => void): void {
		if (type === "message") {
			this.#messageListeners.add(listener as (event: MessageEvent) => void);
		} else if (type === "error") {
			this.#errorListeners.add(listener as (event: ErrorEvent) => void);
		} else if (type === "messageerror") {
			this.#messageerrorListeners.add(
				listener as (event: MessageEvent) => void,
			);
		}
		// Silently ignore unsupported event types for API compatibility
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
	removeEventListener(
		type: "messageerror",
		listener: (event: MessageEvent) => void,
	): void;
	removeEventListener(type: string, listener: (event: any) => void): void {
		if (type === "message") {
			this.#messageListeners.delete(listener as (event: MessageEvent) => void);
		} else if (type === "error") {
			this.#errorListeners.delete(listener as (event: ErrorEvent) => void);
		} else if (type === "messageerror") {
			this.#messageerrorListeners.delete(
				listener as (event: MessageEvent) => void,
			);
		}
	}

	/**
	 * Terminate the worker (Web Worker standard - returns void, not a promise)
	 */
	terminate(): void {
		// Node.js worker.terminate() returns a promise, but Web Worker standard is sync
		// We fire-and-forget here to match the standard API
		// Errors during termination are silently ignored per Web Worker spec
		this.#nodeWorker.terminate().catch(() => {
			// Silently ignore termination errors
		});

		// Clean up listeners immediately
		this.#messageListeners.clear();
		this.#errorListeners.clear();
		this.#messageerrorListeners.clear();
		this.onmessage = null;
		this.onerror = null;
		this.onmessageerror = null;
	}
}

// Re-export for convenience
export default Worker;
