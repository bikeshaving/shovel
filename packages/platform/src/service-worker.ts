/**
 * ServiceWorker runtime environment for Shovel entrypoints
 *
 * Provides ServiceWorker APIs (self, addEventListener, etc.) in any JavaScript runtime
 */

/**
 * ExtendableEvent base class following ServiceWorker spec
 */
export class ExtendableEvent extends Event {
	private promises: Promise<any>[] = [];
	private pendingPromises: Set<Promise<any>>;

	constructor(type: string, pendingPromises: Set<Promise<any>>) {
		super(type);
		this.pendingPromises = pendingPromises;
	}

	waitUntil(promise: Promise<any>): void {
		this.promises.push(promise);
		this.pendingPromises.add(promise);
		promise.finally(() => this.pendingPromises.delete(promise));
	}

	getPromises(): Promise<any>[] {
		return [...this.promises];
	}
}

/**
 * ServiceWorker-style fetch event
 */
export class FetchEvent extends ExtendableEvent {
	readonly request: Request;
	private responsePromise: Promise<Response> | null = null;
	private responded = false;

	constructor(request: Request, pendingPromises: Set<Promise<any>>) {
		super("fetch", pendingPromises);
		this.request = request;
	}

	respondWith(response: Response | Promise<Response>): void {
		if (this.responded) {
			throw new Error("respondWith() already called");
		}
		this.responded = true;
		this.responsePromise = Promise.resolve(response);
	}

	getResponse(): Promise<Response> | null {
		return this.responsePromise;
	}

	hasResponded(): boolean {
		return this.responded;
	}
}

/**
 * ServiceWorker-style install event
 */
export class InstallEvent extends ExtendableEvent {
	constructor(pendingPromises: Set<Promise<any>>) {
		super("install", pendingPromises);
	}
}

/**
 * ServiceWorker-style activate event
 */
export class ActivateEvent extends ExtendableEvent {
	constructor(pendingPromises: Set<Promise<any>>) {
		super("activate", pendingPromises);
	}
}

/**
 * Legacy interfaces for backward compatibility
 */
export interface ShovelFetchEvent extends Event {
	readonly type: "fetch";
	readonly request: Request;
	respondWith(response: Response | Promise<Response>): void;
	waitUntil(promise: Promise<any>): void;
}

export interface ShovelInstallEvent extends Event {
	readonly type: "install";
	waitUntil(promise: Promise<any>): void;
}

export interface ShovelActivateEvent extends Event {
	readonly type: "activate";
	waitUntil(promise: Promise<any>): void;
}


/**
 * ServiceWorker runtime that can be embedded in any platform
 */
export class ServiceWorkerRuntime extends EventTarget {
	private pendingPromises = new Set<Promise<any>>();
	private isInstalled = false;
	private isActivated = false;
	private eventListeners = new Map<string, Function[]>();

	constructor() {
		super();
	}
	
	addEventListener(type: string, listener: Function): void {
		super.addEventListener(type as any, listener as any);
		if (!this.eventListeners.has(type)) {
			this.eventListeners.set(type, []);
		}
		this.eventListeners.get(type)!.push(listener);
	}
	
	removeEventListener(type: string, listener: Function): void {
		super.removeEventListener(type as any, listener as any);
		if (this.eventListeners.has(type)) {
			const listeners = this.eventListeners.get(type)!;
			const index = listeners.indexOf(listener);
			if (index > -1) {
				listeners.splice(index, 1);
				if (listeners.length === 0) {
					this.eventListeners.delete(type);
				}
			}
		}
	}

	/**
	 * Create a fetch event and dispatch it
	 */
	async handleRequest(request: Request): Promise<Response> {
		if (!this.isActivated) {
			throw new Error("ServiceWorker not activated");
		}

		return new Promise<Response>((resolve, reject) => {
			const event = new FetchEvent(request, this.pendingPromises);

			// Dispatch event asynchronously to allow listener errors to be deferred
			process.nextTick(() => {
				this.dispatchEvent(event);
				
				// Wait for all waitUntil promises (background tasks, don't block response)
				const promises = event.getPromises();
				if (promises.length > 0) {
					Promise.allSettled(promises).catch(console.error);
				}
			});

			// Allow async event handlers to execute before checking response
			setTimeout(() => {
				if (event.hasResponded()) {
					const responsePromise = event.getResponse()!;
					responsePromise.then(resolve).catch(reject);
				} else {
					reject(new Error("No response provided for fetch event"));
				}
			}, 0);
		});
	}

	/**
	 * Install the ServiceWorker
	 */
	async install(): Promise<void> {
		if (this.isInstalled) return;

		return new Promise<void>((resolve, reject) => {
			const event = new InstallEvent(this.pendingPromises);

			// Dispatch event asynchronously to allow listener errors to be deferred
			process.nextTick(() => {
				this.dispatchEvent(event);
				
				const promises = event.getPromises();
				if (promises.length === 0) {
					this.isInstalled = true;
					resolve();
				} else {
					// Use Promise.all() so waitUntil rejections fail the install
					Promise.all(promises)
						.then(() => {
							this.isInstalled = true;
							resolve();
						})
						.catch(reject);
				}
			});
		});
	}

	/**
	 * Activate the ServiceWorker
	 */
	async activate(): Promise<void> {
		if (!this.isInstalled) {
			throw new Error("ServiceWorker must be installed before activation");
		}
		if (this.isActivated) return;

		return new Promise<void>((resolve, reject) => {
			const event = new ActivateEvent(this.pendingPromises);

			// Dispatch event asynchronously to allow listener errors to be deferred
			process.nextTick(() => {
				this.dispatchEvent(event);
				
				const promises = event.getPromises();
				if (promises.length === 0) {
					this.isActivated = true;
					resolve();
				} else {
					// Use Promise.all() so waitUntil rejections fail the activation
					Promise.all(promises)
						.then(() => {
							this.isActivated = true;
							resolve();
						})
						.catch(reject);
				}
			});
		});
	}


	/**
	 * Check if ready to handle requests
	 */
	get ready(): boolean {
		return this.isInstalled && this.isActivated;
	}

	/**
	 * Wait for all pending promises to resolve
	 */
	async waitForPending(): Promise<void> {
		if (this.pendingPromises.size > 0) {
			await Promise.allSettled([...this.pendingPromises]);
		}
	}


	/**
	 * Reset the ServiceWorker state (for hot reloading)
	 */
	reset(): void {
		this.isInstalled = false;
		this.isActivated = false;
		this.pendingPromises.clear();
		
		// Remove all tracked event listeners
		for (const [type, listeners] of this.eventListeners) {
			for (const listener of listeners) {
				super.removeEventListener(type as any, listener as any);
			}
		}
		this.eventListeners.clear();
	}
}


/**
 * Bucket storage interface - parallels CacheStorage for filesystem access
 * This could become a future web standard
 */
export interface BucketStorage {
	/**
	 * Open a named bucket - returns FileSystemDirectoryHandle (root of that bucket)
	 * Well-known names: 'assets', 'static', 'uploads', 'temp'
	 */
	open(name: string): Promise<FileSystemDirectoryHandle>;
	
	/**
	 * Alias for open() - for compatibility with File System Access API naming
	 */
	getDirectoryHandle(name: string): Promise<FileSystemDirectoryHandle>;
	
	/**
	 * Check if a named bucket exists
	 */
	has(name: string): Promise<boolean>;
	
	/**
	 * Delete a named bucket and all its contents
	 */
	delete(name: string): Promise<boolean>;
	
	/**
	 * List all available bucket names
	 */
	keys(): Promise<string[]>;
}



/**
 * Create ServiceWorker globals for a module context
 */
export function createServiceWorkerGlobals(
	runtime: ServiceWorkerRuntime,
	options: {
		caches?: any;
		buckets?: BucketStorage;
		// Environment-specific options
		isDevelopment?: boolean;
		hotReload?: () => Promise<void>;
	} = {}
) {
	// Attach platform resources directly to runtime
	if (options.caches) {
		(runtime as any).caches = options.caches;
	}
	if (options.buckets) {
		(runtime as any).buckets = options.buckets;
	}

	// Environment-aware ServiceWorker APIs
	const skipWaiting = async (): Promise<void> => {
		if (options.isDevelopment && options.hotReload) {
			// Development: trigger hot reload
			console.info('[ServiceWorker] skipWaiting() - triggering hot reload');
			await options.hotReload();
		} else if (!options.isDevelopment) {
			// Production: could trigger graceful restart or worker replacement
			console.info('[ServiceWorker] skipWaiting() - production graceful restart not implemented');
			// TODO: Implement production restart logic
		}
		// Always resolve - skipWaiting never fails in real ServiceWorkers
	};

	// ServiceWorker clients API - spec-compliant with standard webworker types
	// No-ops for HTTP servers, future-ready for WebSocket/SSE connections
	const clients = {
		async claim(): Promise<void> {
			// No-op: HTTP requests are stateless, no persistent clients to claim
		},

		async get(id: string): Promise<any> {
			// Return undefined - no persistent clients in HTTP-only server
			return undefined;
		},

		async matchAll(options?: any): Promise<any[]> {
			// Return empty array - no persistent clients in HTTP-only server
			return [];
		},

		async openWindow(url: string | URL): Promise<any> {
			// Not supported in server context
			return null;
		}
	};

	const globals = {
		self: runtime,
		addEventListener: runtime.addEventListener.bind(runtime),
		removeEventListener: runtime.removeEventListener.bind(runtime),
		dispatchEvent: runtime.dispatchEvent.bind(runtime),

		// ServiceWorker-specific globals with proper implementations
		skipWaiting,
		clients,

		// Platform resources
		...(options.buckets && { buckets: options.buckets }),
		...(options.caches && { caches: options.caches }),

		// Standard globals
		console,
		setTimeout,
		clearTimeout,
		setInterval,
		clearInterval,
		fetch,
		Request,
		Response,
		Headers,
		URL,
		URLSearchParams,
	};

	// Set globals on globalThis for ServiceWorker compatibility
	Object.assign(globalThis, globals);

	return globals;
}
