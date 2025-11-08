/**
 * @b9g/node-webworker - Minimal Web Worker shim for Node.js
 * 
 * This package provides a minimal Web Worker API implementation for Node.js
 * until native Web Worker support is added to Node.js core.
 * 
 * @see https://github.com/nodejs/node/issues/43583
 */

import { Worker as NodeWorker, MessagePort } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

/**
 * Event-like object for message events
 */
export interface MessageEvent {
	readonly data: any;
	readonly type: 'message';
}

/**
 * Error event object
 */
export interface ErrorEvent {
	readonly error: Error;
	readonly type: 'error';
}

/**
 * Web Worker API implementation using Node.js worker_threads
 * 
 * This provides a minimal, standards-compliant interface that maps
 * to Node.js worker_threads underneath.
 */
export class Worker {
	private nodeWorker: NodeWorker;
	private messageListeners = new Set<(event: MessageEvent) => void>();
	private errorListeners = new Set<(event: ErrorEvent) => void>();

	constructor(scriptURL: string, options?: { type?: 'classic' | 'module' }) {
		// Get the path to our wrapper script
		const __filename = fileURLToPath(import.meta.url);
		const __dirname = dirname(__filename);
		const wrapperScript = join(__dirname, 'worker-wrapper.js');
		
		// Create Node.js Worker with our wrapper that provides Web Worker globals
		this.nodeWorker = new NodeWorker(wrapperScript, {
			type: 'module',
			env: {
				...process.env,
				WORKER_SCRIPT_URL: scriptURL
			}
		});

		// Set up event forwarding from Node.js Worker to Web Worker API
		this.nodeWorker.on('message', (data) => {
			const event: MessageEvent = { data, type: 'message' };
			this.messageListeners.forEach(listener => {
				try {
					listener(event);
				} catch (error) {
					console.error('[node-webworker] Error in message listener:', error);
				}
			});
		});

		this.nodeWorker.on('error', (error) => {
			const event: ErrorEvent = { error, type: 'error' };
			this.errorListeners.forEach(listener => {
				try {
					listener(event);
				} catch (listenerError) {
					console.error('[node-webworker] Error in error listener:', listenerError);
				}
			});
		});
	}

	/**
	 * Send a message to the worker
	 */
	postMessage(message: any, transfer?: Transferable[]): void {
		if (transfer && transfer.length > 0) {
			console.warn('[node-webworker] Transferable objects not fully supported');
		}
		this.nodeWorker.postMessage(message);
	}

	/**
	 * Add an event listener (Web Worker API)
	 */
	addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
	addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
	addEventListener(type: string, listener: (event: any) => void): void {
		if (type === 'message') {
			this.messageListeners.add(listener as (event: MessageEvent) => void);
		} else if (type === 'error') {
			this.errorListeners.add(listener as (event: ErrorEvent) => void);
		} else {
			console.warn(`[node-webworker] Unsupported event type: ${type}`);
		}
	}

	/**
	 * Remove an event listener
	 */
	removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
	removeEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
	removeEventListener(type: string, listener: (event: any) => void): void {
		if (type === 'message') {
			this.messageListeners.delete(listener as (event: MessageEvent) => void);
		} else if (type === 'error') {
			this.errorListeners.delete(listener as (event: ErrorEvent) => void);
		}
	}

	/**
	 * Terminate the worker
	 */
	async terminate(): Promise<number> {
		const exitCode = await this.nodeWorker.terminate();
		// Clean up listeners
		this.messageListeners.clear();
		this.errorListeners.clear();
		return exitCode;
	}

	/**
	 * Get the underlying Node.js Worker (for advanced usage)
	 */
	get nodeWorker_(): NodeWorker {
		return this.nodeWorker;
	}
}

// Re-export for convenience
export default Worker;