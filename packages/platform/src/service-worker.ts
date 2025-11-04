/**
 * ServiceWorker runtime environment for Shovel entrypoints
 *
 * Provides ServiceWorker APIs (self, addEventListener, etc.) in any JavaScript runtime
 */

/**
 * ServiceWorker-style fetch event
 */
export interface ShovelFetchEvent extends Event {
	readonly type: "fetch";
	readonly request: Request;
	respondWith(response: Response | Promise<Response>): void;
	waitUntil(promise: Promise<any>): void;
}

/**
 * ServiceWorker-style install event
 */
export interface ShovelInstallEvent extends Event {
	readonly type: "install";
	waitUntil(promise: Promise<any>): void;
}

/**
 * ServiceWorker-style activate event
 */
export interface ShovelActivateEvent extends Event {
	readonly type: "activate";
	waitUntil(promise: Promise<any>): void;
}

/**
 * Static generation event for collecting routes
 */
export interface ShovelStaticEvent extends Event {
	readonly type: "static";
	readonly detail: {
		outDir: string;
		baseUrl?: string;
	};
	waitUntil(promise: Promise<string[]>): void;
}

/**
 * ServiceWorker runtime that can be embedded in any platform
 */
export class ServiceWorkerRuntime extends EventTarget {
	private pendingPromises = new Set<Promise<any>>();
	private isInstalled = false;
	private isActivated = false;

	constructor() {
		super();
	}

	/**
	 * Create a fetch event and dispatch it
	 */
	async handleRequest(request: Request): Promise<Response> {
		if (!this.isActivated) {
			throw new Error("ServiceWorker not activated");
		}

		return new Promise<Response>((resolve, reject) => {
			let responded = false;
			const promises: Promise<any>[] = [];

			const event: ShovelFetchEvent = Object.assign(new Event("fetch"), {
				request,
				respondWith: (response: Response | Promise<Response>) => {
					if (responded) {
						throw new Error("respondWith() already called");
					}
					responded = true;
					Promise.resolve(response).then(resolve).catch(reject);
				},
				waitUntil: (promise: Promise<any>) => {
					promises.push(promise);
					this.pendingPromises.add(promise);
					promise.finally(() => this.pendingPromises.delete(promise));
				},
			});

			this.dispatchEvent(event);

			if (!responded) {
				reject(new Error("No response provided for fetch event"));
			}

			// Wait for all promises
			Promise.allSettled(promises).catch(console.error);
		});
	}

	/**
	 * Install the ServiceWorker
	 */
	async install(): Promise<void> {
		if (this.isInstalled) return;

		return new Promise<void>((resolve, reject) => {
			const promises: Promise<any>[] = [];
			let installCancelled = false;

			const event: ShovelInstallEvent = Object.assign(new Event("install"), {
				waitUntil: (promise: Promise<any>) => {
					promises.push(promise);
					this.pendingPromises.add(promise);
					promise.finally(() => this.pendingPromises.delete(promise));
				},
			});

			this.dispatchEvent(event);

			Promise.allSettled(promises)
				.then(() => {
					if (!installCancelled) {
						this.isInstalled = true;
						resolve();
					}
				})
				.catch(reject);
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
			const promises: Promise<any>[] = [];

			const event: ShovelActivateEvent = Object.assign(new Event("activate"), {
				waitUntil: (promise: Promise<any>) => {
					promises.push(promise);
					this.pendingPromises.add(promise);
					promise.finally(() => this.pendingPromises.delete(promise));
				},
			});

			this.dispatchEvent(event);

			Promise.allSettled(promises)
				.then(() => {
					this.isActivated = true;
					resolve();
				})
				.catch(reject);
		});
	}

	/**
	 * Collect static routes for pre-rendering
	 */
	async collectStaticRoutes(
		outDir: string,
		baseUrl?: string,
	): Promise<string[]> {
		return new Promise<string[]>((resolve, reject) => {
			let routes: string[] = [];
			const promises: Promise<any>[] = [];

			const event: ShovelStaticEvent = Object.assign(new Event("static"), {
				detail: {outDir, baseUrl},
				waitUntil: (promise: Promise<string[]>) => {
					promises.push(
						promise.then((routeList) => {
							routes = routes.concat(routeList);
						}),
					);
					this.pendingPromises.add(promise);
					promise.finally(() => this.pendingPromises.delete(promise));
				},
			});

			this.dispatchEvent(event);

			if (promises.length === 0) {
				// No static event listeners, return empty routes
				resolve([]);
			} else {
				Promise.allSettled(promises)
					.then(() => resolve([...new Set(routes)])) // Deduplicate
					.catch(reject);
			}
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
		// Remove all event listeners
		const listeners = (this as any)._listeners;
		if (listeners) {
			for (const type in listeners) {
				delete listeners[type];
			}
		}
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
	} = {}
) {
	// Attach platform resources directly to runtime
	if (options.caches) {
		(runtime as any).caches = options.caches;
	}
	if (options.buckets) {
		(runtime as any).buckets = options.buckets;
	}

	return {
		self: runtime,
		addEventListener: runtime.addEventListener.bind(runtime),
		removeEventListener: runtime.removeEventListener.bind(runtime),
		dispatchEvent: runtime.dispatchEvent.bind(runtime),

		// ServiceWorker-specific globals that might be useful
		skipWaiting: () => Promise.resolve(),
		clients: {
			claim: () => Promise.resolve(),
			matchAll: () => Promise.resolve([]),
		},

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
}
