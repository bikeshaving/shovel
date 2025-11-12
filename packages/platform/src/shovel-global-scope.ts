/**
 * ShovelGlobalScope - Implementation of ServiceWorkerGlobalScope
 *
 * This is the global scope object for Shovel ServiceWorker applications.
 * In browsers, ServiceWorkers have a ServiceWorkerGlobalScope as `self`.
 * In Shovel, applications get a ShovelGlobalScope as `self`.
 */

import type {ServiceWorkerRegistration} from "./service-worker-api.js";
import type {BucketStorage} from "./service-worker.js";

export interface ShovelGlobalScopeOptions {
	/** ServiceWorker registration instance */
	registration: ServiceWorkerRegistration;
	/** Bucket storage (file system access) */
	buckets?: BucketStorage;
	/** Cache storage */
	caches?: CacheStorage;
	/** Development mode flag */
	isDevelopment?: boolean;
	/** Hot reload callback for development */
	hotReload?: () => Promise<void>;
}

/**
 * ShovelGlobalScope implements ServiceWorkerGlobalScope
 *
 * This is the `self` object in Shovel ServiceWorker applications.
 * It provides all standard ServiceWorker APIs plus Shovel-specific extensions.
 */
export class ShovelGlobalScope implements ServiceWorkerGlobalScope {
	// Self-reference (standard in ServiceWorkerGlobalScope)
	readonly self: ShovelGlobalScope = this;

	// ServiceWorker standard properties
	readonly registration: ServiceWorkerRegistration;

	// Storage APIs
	readonly caches?: CacheStorage;
	readonly buckets?: BucketStorage;

	// Clients API
	readonly clients: Clients;

	// Internal state
	private isDevelopment: boolean;
	private hotReload?: () => Promise<void>;

	constructor(options: ShovelGlobalScopeOptions) {
		this.registration = options.registration;
		this.caches = options.caches;
		this.buckets = options.buckets;
		this.isDevelopment = options.isDevelopment ?? false;
		this.hotReload = options.hotReload;

		// Create clients API implementation
		this.clients = this.createClientsAPI();
	}

	/**
	 * Standard ServiceWorker skipWaiting() implementation
	 * In development: triggers hot reload
	 * In production: graceful restart (not yet implemented)
	 */
	async skipWaiting(): Promise<void> {
		if (this.isDevelopment && this.hotReload) {
			console.info("[ServiceWorker] skipWaiting() - triggering hot reload");
			await this.hotReload();
		} else if (!this.isDevelopment) {
			console.info(
				"[ServiceWorker] skipWaiting() - production graceful restart not implemented",
			);
			// TODO: Implement production restart logic
		}
	}

	/**
	 * Event target delegation to registration
	 */
	addEventListener(
		type: string,
		listener: EventListenerOrEventListenerObject | null,
		options?: boolean | AddEventListenerOptions,
	): void {
		this.registration.addEventListener(type, listener, options);
	}

	removeEventListener(
		type: string,
		listener: EventListenerOrEventListenerObject | null,
		options?: boolean | EventListenerOptions,
	): void {
		this.registration.removeEventListener(type, listener, options);
	}

	dispatchEvent(event: Event): boolean {
		return this.registration.dispatchEvent(event);
	}

	/**
	 * Create Clients API implementation
	 * Note: HTTP requests are stateless, so most client operations are no-ops
	 */
	private createClientsAPI(): Clients {
		return {
			async claim(): Promise<void> {
				// No-op: HTTP requests are stateless, no persistent clients to claim
			},

			async get(id: string): Promise<Client | undefined> {
				// Return undefined - no persistent clients in HTTP-only server
				return undefined;
			},

			async matchAll(options?: ClientQueryOptions): Promise<Client[]> {
				// Return empty array - no persistent clients in HTTP-only server
				return [];
			},

			async openWindow(url: string | URL): Promise<WindowClient | null> {
				// Not supported in server context
				return null;
			},
		};
	}

	/**
	 * Install this scope as the global scope
	 * Sets up globalThis with all ServiceWorker globals
	 */
	install(): void {
		// Set self and event listeners
		globalThis.self = this as any;
		globalThis.addEventListener = this.addEventListener.bind(this);
		globalThis.removeEventListener = this.removeEventListener.bind(this);
		globalThis.dispatchEvent = this.dispatchEvent.bind(this);

		// Expose storage APIs
		if (this.caches) {
			(globalThis as any).caches = this.caches;
		}
		if (this.buckets) {
			(globalThis as any).buckets = this.buckets;
		}

		// Expose ServiceWorker APIs
		(globalThis as any).registration = this.registration;
		(globalThis as any).skipWaiting = this.skipWaiting.bind(this);
		(globalThis as any).clients = this.clients;
	}
}
