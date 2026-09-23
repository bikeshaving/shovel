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
 * Close event for worker termination
 * Includes exit code for crash detection
 */
export class CloseEvent extends Event {
	readonly code: number;

	constructor(code: number) {
		super("close");
		this.code = code;
	}
}

/**
 * Worker wrapper code as a data URL
 * This provides Web Worker globals in the Node.js worker_threads context
 * Using a data URL avoids needing to write any files to disk (temp or otherwise)
 */
// Compact wrapper code to keep data URL length under limits
// Messages that arrive while the worker script is still loading are queued
// and dispatched once it has registered its listeners.
const WORKER_WRAPPER_CODE = `import{parentPort as p}from"worker_threads";const l=new Set();let q=[];globalThis.onmessage=null;globalThis.onmessageerror=null;globalThis.postMessage=(d,t)=>t?.length?p.postMessage(d,t):p.postMessage(d);globalThis.self=globalThis;globalThis.addEventListener=(t,f)=>t==="message"&&l.add(f);globalThis.removeEventListener=(t,f)=>t==="message"&&l.delete(f);const h=e=>{globalThis.onmessage?.(e);l.forEach(f=>f(e))};p.on("message",d=>{const e={data:d,type:"message"};q?q.push(e):h(e)});const u=process.env.WORKER_SCRIPT_URL;if(u)await import(u);else throw Error("WORKER_SCRIPT_URL not set");const b=q;q=null;b.forEach(h);`;

// Create data URL from wrapper code (created once and reused)
const WORKER_WRAPPER_DATA_URL = new URL(
	`data:text/javascript,${encodeURIComponent(WORKER_WRAPPER_CODE)}`,
);

const kNodeWorker = Symbol("nodeWorker");
const kMessageListeners = Symbol("messageListeners");
const kErrorListeners = Symbol("errorListeners");
const kMessageerrorListeners = Symbol("messageerrorListeners");
const kCloseListeners = Symbol("closeListeners");

export interface Worker {
	[kNodeWorker]: NodeWorker;
	[kMessageListeners]: Set<(event: MessageEvent) => void>;
	[kErrorListeners]: Set<(event: ErrorEvent) => void>;
	[kMessageerrorListeners]: Set<(event: MessageEvent) => void>;
	[kCloseListeners]: Set<(event: CloseEvent) => void>;
}

/**
 * Web Worker API implementation using Node.js worker_threads
 *
 * This provides a minimal, standards-compliant interface that maps
 * to Node.js worker_threads underneath.
 */
export class Worker {
	// Web Worker standard properties
	onmessage: ((event: MessageEvent) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
	onmessageerror: ((event: MessageEvent) => void) | null;
	onclose: ((event: CloseEvent) => void) | null;

	constructor(
		scriptURL: string | URL,
		_options?: {type?: "classic" | "module"; env?: Record<string, string>},
	) {
		this[kMessageListeners] = new Set<(event: MessageEvent) => void>();
		this[kErrorListeners] = new Set<(event: ErrorEvent) => void>();
		this[kMessageerrorListeners] = new Set<(event: MessageEvent) => void>();
		this[kCloseListeners] = new Set<(event: CloseEvent) => void>();
		this.onmessage = null;
		this.onerror = null;
		this.onmessageerror = null;
		this.onclose = null;

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
				scriptURLString.startsWith("./") || scriptURLString.startsWith("../")
			) {
				throw new Error(
					"Relative paths are not supported. Use new Worker(new URL('./worker.js', import.meta.url)) instead.",
				);
			}
			// It's an absolute file path - convert to file:// URL
			workerScriptURL = `file://${scriptURLString}`;
		}

		// Create Node.js Worker using data URL wrapper (no temp files needed!)
		this[kNodeWorker] = new NodeWorker(WORKER_WRAPPER_DATA_URL, {
			...({type: "module"} as object),
			env: {
				// eslint-disable-next-line no-restricted-properties -- Workers inherit parent env
				...process.env,
				..._options?.env,
				WORKER_SCRIPT_URL: workerScriptURL,
			},
		});

		setupEventForwarding(this);
	}

	/**
	 * Send a message to the worker
	 */
	postMessage(message: any, transfer?: Transferable[]): void {
		if (transfer && transfer.length > 0) {
			// Node.js Worker supports transferList in options
			this[kNodeWorker].postMessage(message, transfer as any);
		} else {
			this[kNodeWorker].postMessage(message);
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
	addEventListener(type: "close", listener: (event: CloseEvent) => void): void;
	addEventListener(type: string, listener: (event: any) => void): void {
		if (type === "message") {
			this[kMessageListeners].add(listener as (event: MessageEvent) => void);
		} else if (type === "error") {
			this[kErrorListeners].add(listener as (event: ErrorEvent) => void);
		} else if (type === "messageerror") {
			this[kMessageerrorListeners].add(
				listener as (event: MessageEvent) => void,
			);
		} else if (type === "close") {
			this[kCloseListeners].add(listener as (event: CloseEvent) => void);
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
	removeEventListener(
		type: "close",
		listener: (event: CloseEvent) => void,
	): void;
	removeEventListener(type: string, listener: (event: any) => void): void {
		if (type === "message") {
			this[kMessageListeners].delete(listener as (event: MessageEvent) => void);
		} else if (type === "error") {
			this[kErrorListeners].delete(listener as (event: ErrorEvent) => void);
		} else if (type === "messageerror") {
			this[kMessageerrorListeners].delete(
				listener as (event: MessageEvent) => void,
			);
		} else if (type === "close") {
			this[kCloseListeners].delete(listener as (event: CloseEvent) => void);
		}
	}

	/**
	 * Terminate the worker (Web Worker standard - returns void, not a promise)
	 */
	terminate(): void {
		// Node.js worker.terminate() returns a promise, but Web Worker standard is sync
		// We fire-and-forget here to match the standard API
		// Errors during termination are silently ignored per Web Worker spec
		this[kNodeWorker].terminate().catch(() => {
			// Silently ignore termination errors
		});

		// Clean up listeners immediately
		this[kMessageListeners].clear();
		this[kErrorListeners].clear();
		this[kMessageerrorListeners].clear();
		this[kCloseListeners].clear();
		this.onmessage = null;
		this.onerror = null;
		this.onmessageerror = null;
		this.onclose = null;
	}
}

/**
 * Report a close event when the worker exits
 */
function reportClose(worker: Worker, code: number): void {
	const event = new CloseEvent(code);

	// Call onclose handler if set
	if (worker.onclose) {
		worker.onclose(event);
	}

	// Call close event listeners
	worker[kCloseListeners].forEach((listener) => {
		listener(event);
	});
}

/**
 * Report an error through the error event mechanism
 */
function reportError(worker: Worker, error: any): void {
	const event = new ErrorEvent(error);

	// Call onerror handler if set
	if (worker.onerror) {
		worker.onerror(event);
	}

	// Call error event listeners
	worker[kErrorListeners].forEach((listener) => {
		listener(event);
	});
}

/**
 * Set up event forwarding from Node.js Worker to Web Worker API
 */
function setupEventForwarding(worker: Worker): void {
	worker[kNodeWorker].on("message", (data) => {
		const event = new MessageEvent(data);

		// Call onmessage handler if set (Web Worker standard)
		if (worker.onmessage) {
			try {
				worker.onmessage(event);
			} catch (error) {
				// Report error through error event mechanism per spec
				reportError(worker, error);
			}
		}

		// Call addEventListener handlers
		worker[kMessageListeners].forEach((listener) => {
			try {
				listener(event);
			} catch (error) {
				// Report error through error event mechanism per spec
				reportError(worker, error);
			}
		});
	});

	worker[kNodeWorker].on("error", (error) => {
		// Report error through error event mechanism
		reportError(worker, error);
	});

	worker[kNodeWorker].on("messageerror", (data) => {
		const event = new MessageEvent(data);

		// Call onmessageerror handler if set
		if (worker.onmessageerror) {
			worker.onmessageerror(event);
		}

		// Call messageerror event listeners
		worker[kMessageerrorListeners].forEach((listener) => {
			listener(event);
		});
	});

	worker[kNodeWorker].on("exit", (code) => {
		reportClose(worker, code);
	});
}

// Re-export for convenience
export default Worker;
