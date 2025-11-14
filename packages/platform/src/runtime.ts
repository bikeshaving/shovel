/**
 * ServiceWorker Runtime - Complete ServiceWorker API Implementation
 *
 * This module provides the complete ServiceWorker runtime environment for Shovel:
 * - Base Event Classes (ExtendableEvent, FetchEvent, InstallEvent, ActivateEvent)
 * - ServiceWorker API Type Shims (Client, Clients, ServiceWorkerRegistration, etc.)
 * - ShovelGlobalScope (implements ServiceWorkerGlobalScope for any JavaScript runtime)
 *
 * Based on: https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API#interfaces
 */

// ============================================================================
// Base Event Classes
// ============================================================================

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
		// Suppress unhandled rejection warnings - Promise.all() will handle it
		promise.catch(() => {});
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
 * @deprecated - This interface is not part of the ServiceWorker spec
 */
export interface ShovelStaticEvent extends Event {
	readonly type: "static";
	waitUntil(promise: Promise<any>): void;
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

// ============================================================================
// ServiceWorker API Implementation
// ============================================================================

/**
 * Client represents the scope of a service worker client
 * Either a document in a browser context or a SharedWorker
 */
export class Client {
	readonly frameType: "auxiliary" | "top-level" | "nested" | "none" = "none";
	readonly id: string;
	readonly type: "window" | "worker" | "sharedworker" = "worker";
	readonly url: string;

	constructor(options: {
		id: string;
		url: string;
		type?: "window" | "worker" | "sharedworker";
	}) {
		this.id = options.id;
		this.url = options.url;
		this.type = options.type || "worker";
	}

	postMessage(_message: any, _transfer?: Transferable[]): void {
		console.warn(
			"[ServiceWorker] Client.postMessage() not supported in server context",
		);
	}
}

/**
 * WindowClient represents a service worker client that is a document in a browser context
 */
export class WindowClient extends Client {
	readonly focused: boolean = false;
	readonly visibilityState: "visible" | "hidden" | "prerender" = "hidden";

	constructor(options: {
		id: string;
		url: string;
		focused?: boolean;
		visibilityState?: "visible" | "hidden" | "prerender";
	}) {
		super({...options, type: "window"});
		this.focused = options.focused || false;
		this.visibilityState = options.visibilityState || "hidden";
	}

	async focus(): Promise<WindowClient> {
		console.warn(
			"[ServiceWorker] WindowClient.focus() not supported in server context",
		);
		return this;
	}

	async navigate(_url: string): Promise<WindowClient | null> {
		console.warn(
			"[ServiceWorker] WindowClient.navigate() not supported in server context",
		);
		return null;
	}
}

/**
 * Clients container provides access to active service worker clients
 */
export class Clients {
	async claim(): Promise<void> {
		// No-op: HTTP servers don't have persistent clients to claim
	}

	async get(_id: string): Promise<Client | undefined> {
		return undefined;
	}

	async matchAll(_options?: {
		includeUncontrolled?: boolean;
		type?: "window" | "worker" | "sharedworker" | "all";
	}): Promise<Client[]> {
		return [];
	}

	async openWindow(_url: string): Promise<WindowClient | null> {
		console.warn(
			"[ServiceWorker] Clients.openWindow() not supported in server context",
		);
		return null;
	}
}

/**
 * ExtendableMessageEvent represents message events with waitUntil support
 */
export class ExtendableMessageEvent extends ExtendableEvent {
	readonly data: any;
	readonly origin: string;
	readonly lastEventId: string;
	readonly source: Client | ServiceWorker | MessagePort | null;
	readonly ports: readonly MessagePort[];

	constructor(
		type: string,
		options: {
			pendingPromises: Set<Promise<any>>;
			data?: any;
			origin?: string;
			lastEventId?: string;
			source?: Client | ServiceWorker | MessagePort | null;
			ports?: MessagePort[];
		},
	) {
		super(type, options.pendingPromises);
		this.data = options.data;
		this.origin = options.origin || "";
		this.lastEventId = options.lastEventId || "";
		this.source = options.source || null;
		this.ports = Object.freeze([...(options.ports || [])]);
	}
}

/**
 * ServiceWorker interface represents a service worker
 */
export class ServiceWorker extends EventTarget {
	scriptURL: string;
	state:
		| "parsed"
		| "installing"
		| "installed"
		| "activating"
		| "activated"
		| "redundant";

	constructor(
		scriptURL: string,
		state:
			| "parsed"
			| "installing"
			| "installed"
			| "activating"
			| "activated"
			| "redundant" = "parsed",
	) {
		super();
		this.scriptURL = scriptURL;
		this.state = state;
	}

	postMessage(_message: any, _transfer?: Transferable[]): void {
		console.warn(
			"[ServiceWorker] ServiceWorker.postMessage() not implemented in server context",
		);
	}

	// Internal method to update state and dispatch statechange event
	_setState(newState: typeof this.state): void {
		if (this.state !== newState) {
			this.state = newState;
			this.dispatchEvent(new Event("statechange"));
		}
	}

	// Events: statechange, error
}

/**
 * NavigationPreloadManager provides control over navigation preload
 */
export class NavigationPreloadManager {
	async disable(): Promise<void> {
		// No-op in server context
	}

	async enable(): Promise<void> {
		// No-op in server context
	}

	async getState(): Promise<{enabled: boolean; headerValue: string}> {
		return {enabled: false, headerValue: ""};
	}

	async setHeaderValue(_value: string): Promise<void> {
		// No-op in server context
	}
}

/**
 * ServiceWorkerRegistration represents a service worker registration
 * This is also the Shovel ServiceWorker runtime - they are unified into one class
 */
export class ServiceWorkerRegistration extends EventTarget {
	readonly scope: string;
	readonly updateViaCache: "imports" | "all" | "none" = "imports";
	readonly navigationPreload: NavigationPreloadManager;

	// ServiceWorker instances representing different lifecycle states
	public _serviceWorker: ServiceWorker;

	// Shovel runtime state
	private pendingPromises = new Set<Promise<any>>();
	private eventListeners = new Map<string, Function[]>();

	constructor(scope: string = "/", scriptURL: string = "/") {
		super();
		this.scope = scope;
		this.navigationPreload = new NavigationPreloadManager();
		this._serviceWorker = new ServiceWorker(scriptURL, "parsed");
	}

	// Standard ServiceWorkerRegistration properties
	get active(): ServiceWorker | null {
		return this._serviceWorker.state === "activated"
			? this._serviceWorker
			: null;
	}

	get installing(): ServiceWorker | null {
		return this._serviceWorker.state === "installing"
			? this._serviceWorker
			: null;
	}

	get waiting(): ServiceWorker | null {
		return this._serviceWorker.state === "installed"
			? this._serviceWorker
			: null;
	}

	// Standard ServiceWorkerRegistration methods
	async getNotifications(
		_options?: NotificationOptions,
	): Promise<Notification[]> {
		return [];
	}

	async showNotification(
		_title: string,
		_options?: NotificationOptions,
	): Promise<void> {
		console.warn(
			"[ServiceWorker] Notifications not supported in server context",
		);
	}

	async sync(): Promise<void> {
		// No-op in server context
	}

	async unregister(): Promise<boolean> {
		return false;
	}

	async update(): Promise<void> {
		// No-op in server context
	}

	// Shovel runtime extensions (non-standard but needed for platforms)

	/**
	 * Enhanced addEventListener that tracks listeners for proper cleanup
	 */
	addEventListener(type: string, listener: Function): void {
		super.addEventListener(type as any, listener as any);
		if (!this.eventListeners.has(type)) {
			this.eventListeners.set(type, []);
		}
		this.eventListeners.get(type)!.push(listener);
	}

	/**
	 * Enhanced removeEventListener that tracks listeners
	 */
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
	 * Install the ServiceWorker (Shovel extension)
	 */
	async install(): Promise<void> {
		if (this._serviceWorker.state !== "parsed") return;

		this._serviceWorker._setState("installing");

		return new Promise<void>((resolve, reject) => {
			const event = new InstallEvent(this.pendingPromises);

			// Dispatch event asynchronously to allow listener errors to be deferred
			process.nextTick(() => {
				try {
					this.dispatchEvent(event);
				} catch (error) {
					// Allow errors in event listeners to propagate as uncaught exceptions
					process.nextTick(() => {
						throw error;
					});
				}

				const promises = event.getPromises();
				if (promises.length === 0) {
					this._serviceWorker._setState("installed");
					resolve();
				} else {
					// Use Promise.all() so waitUntil rejections fail the install
					Promise.all(promises)
						.then(() => {
							this._serviceWorker._setState("installed");
							resolve();
						})
						.catch(reject);
				}
			});
		});
	}

	/**
	 * Activate the ServiceWorker (Shovel extension)
	 */
	async activate(): Promise<void> {
		if (this._serviceWorker.state !== "installed") {
			throw new Error("ServiceWorker must be installed before activation");
		}

		this._serviceWorker._setState("activating");

		return new Promise<void>((resolve, reject) => {
			const event = new ActivateEvent(this.pendingPromises);

			// Dispatch event asynchronously to allow listener errors to be deferred
			process.nextTick(() => {
				try {
					this.dispatchEvent(event);
				} catch (error) {
					// Allow errors in event listeners to propagate as uncaught exceptions
					process.nextTick(() => {
						throw error;
					});
				}

				const promises = event.getPromises();
				if (promises.length === 0) {
					this._serviceWorker._setState("activated");
					resolve();
				} else {
					// Use Promise.all() so waitUntil rejections fail the activation
					Promise.all(promises)
						.then(() => {
							this._serviceWorker._setState("activated");
							resolve();
						})
						.catch(reject);
				}
			});
		});
	}

	/**
	 * Handle a fetch request (Shovel extension)
	 */
	async handleRequest(request: Request): Promise<Response> {
		if (this._serviceWorker.state !== "activated") {
			throw new Error("ServiceWorker not activated");
		}

		return new Promise<Response>((resolve, reject) => {
			const event = new FetchEvent(request, this.pendingPromises);

			// Dispatch event asynchronously to allow listener errors to be deferred
			process.nextTick(() => {
				// Manually call each listener with error handling to match browser behavior
				const listeners = this.eventListeners.get("fetch") || [];
				for (const listener of listeners) {
					try {
						listener(event);
					} catch (error) {
						// Log errors in event listeners but don't crash the process
						// This matches browser behavior where fetch listener errors are logged
						// but don't prevent other listeners from running
						console.error("[ServiceWorker] Error in fetch event listener:", error);
						// Continue with next listener
					}
				}

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
	 * Check if ready to handle requests (Shovel extension)
	 */
	get ready(): boolean {
		return this._serviceWorker.state === "activated";
	}

	/**
	 * Wait for all pending promises to resolve (Shovel extension)
	 */
	async waitForPending(): Promise<void> {
		if (this.pendingPromises.size > 0) {
			await Promise.allSettled([...this.pendingPromises]);
		}
	}

	/**
	 * Reset the ServiceWorker state for hot reloading (Shovel extension)
	 */
	reset(): void {
		this._serviceWorker._setState("parsed");
		this.pendingPromises.clear();

		// Remove all tracked event listeners
		for (const [type, listeners] of this.eventListeners) {
			for (const listener of listeners) {
				super.removeEventListener(type as any, listener as any);
			}
		}
		this.eventListeners.clear();
	}

	// Events: updatefound (standard), plus Shovel lifecycle events
}

/**
 * ServiceWorkerContainer provides access to service worker registration and messaging
 * This is the registry that manages multiple ServiceWorkerRegistrations by scope
 */
export class ServiceWorkerContainer extends EventTarget {
	private registrations = new Map<string, ServiceWorkerRegistration>();
	readonly controller: ServiceWorker | null = null;
	readonly ready: Promise<ServiceWorkerRegistration>;

	constructor() {
		super();
		// Create default registration for root scope
		const defaultRegistration = new ServiceWorkerRegistration("/", "/");
		this.registrations.set("/", defaultRegistration);
		this.ready = Promise.resolve(defaultRegistration);
	}

	/**
	 * Get registration for a specific scope
	 */
	async getRegistration(
		scope: string = "/",
	): Promise<ServiceWorkerRegistration | undefined> {
		return this.registrations.get(scope);
	}

	/**
	 * Get all registrations
	 */
	async getRegistrations(): Promise<ServiceWorkerRegistration[]> {
		return Array.from(this.registrations.values());
	}

	/**
	 * Register a new ServiceWorker for a specific scope
	 */
	async register(
		scriptURL: string | URL,
		options?: {
			scope?: string;
			type?: "classic" | "module";
			updateViaCache?: "imports" | "all" | "none";
		},
	): Promise<ServiceWorkerRegistration> {
		const url =
			typeof scriptURL === "string" ? scriptURL : scriptURL.toString();
		const scope = this.normalizeScope(options?.scope || "/");

		// Check if registration already exists for this scope
		let registration = this.registrations.get(scope);

		if (registration) {
			// Update existing registration with new script
			registration._serviceWorker.scriptURL = url;
			registration._serviceWorker._setState("parsed");
		} else {
			// Create new registration
			registration = new ServiceWorkerRegistration(scope, url);
			this.registrations.set(scope, registration);

			// Dispatch updatefound event
			this.dispatchEvent(new Event("updatefound"));
		}

		return registration;
	}

	/**
	 * Unregister a ServiceWorker registration
	 */
	async unregister(scope: string): Promise<boolean> {
		const registration = this.registrations.get(scope);
		if (registration) {
			await registration.unregister();
			this.registrations.delete(scope);
			return true;
		}
		return false;
	}

	/**
	 * Route a request to the appropriate registration based on scope matching
	 */
	async handleRequest(request: Request): Promise<Response | null> {
		const url = new URL(request.url);
		const pathname = url.pathname;

		// Find the most specific scope that matches this request
		const matchingScope = this.findMatchingScope(pathname);

		if (matchingScope) {
			const registration = this.registrations.get(matchingScope);
			if (registration && registration.ready) {
				return await registration.handleRequest(request);
			}
		}

		return null;
	}

	/**
	 * Install and activate all registrations
	 */
	async installAll(): Promise<void> {
		const installations = Array.from(this.registrations.values()).map(
			async (registration) => {
				await registration.install();
				await registration.activate();
			},
		);

		await Promise.all(installations);
	}

	/**
	 * Get list of all scopes
	 */
	getScopes(): string[] {
		return Array.from(this.registrations.keys());
	}

	startMessages(): void {
		// No-op in server context
	}

	/**
	 * Normalize scope to ensure it starts and ends correctly
	 */
	private normalizeScope(scope: string): string {
		// Ensure scope starts with /
		if (!scope.startsWith("/")) {
			scope = "/" + scope;
		}

		// Ensure scope ends with / unless it's the root
		if (scope !== "/" && !scope.endsWith("/")) {
			scope = scope + "/";
		}

		return scope;
	}

	/**
	 * Find the most specific scope that matches a pathname
	 */
	private findMatchingScope(pathname: string): string | null {
		const scopes = Array.from(this.registrations.keys());

		// Sort by length descending to find most specific match first
		scopes.sort((a, b) => b.length - a.length);

		for (const scope of scopes) {
			if (pathname.startsWith(scope === "/" ? "/" : scope)) {
				return scope;
			}
		}

		return null;
	}

	// Events: controllerchange, message, messageerror, updatefound
}

/**
 * Notification interface for push notifications (server context stubs)
 */
export class Notification extends EventTarget {
	readonly actions: readonly NotificationAction[];
	readonly badge: string;
	readonly body: string;
	readonly data: any;
	readonly dir: "auto" | "ltr" | "rtl";
	readonly icon: string;
	readonly image: string;
	readonly lang: string;
	readonly renotify: boolean;
	readonly requireInteraction: boolean;
	readonly silent: boolean;
	readonly tag: string;
	readonly timestamp: number;
	readonly title: string;
	readonly vibrate: readonly number[];

	constructor(title: string, options: NotificationOptions = {}) {
		super();
		this.title = title;
		this.actions = Object.freeze([...(options.actions || [])]);
		this.badge = options.badge || "";
		this.body = options.body || "";
		this.data = options.data;
		this.dir = options.dir || "auto";
		this.icon = options.icon || "";
		this.image = options.image || "";
		this.lang = options.lang || "";
		this.renotify = options.renotify || false;
		this.requireInteraction = options.requireInteraction || false;
		this.silent = options.silent || false;
		this.tag = options.tag || "";
		this.timestamp = options.timestamp || Date.now();
		this.vibrate = Object.freeze([...(options.vibrate || [])]);
	}

	close(): void {
		console.warn(
			"[ServiceWorker] Notification.close() not supported in server context",
		);
	}

	static permission: "default" | "denied" | "granted" = "denied";

	static async requestPermission(): Promise<"default" | "denied" | "granted"> {
		return "denied";
	}

	// Events: click, close, error, show
}

/**
 * NotificationEvent for notification interactions
 */
export class NotificationEvent extends ExtendableEvent {
	readonly action: string;
	readonly notification: Notification;
	readonly reply: string | null = null;

	constructor(
		type: string,
		options: {
			pendingPromises: Set<Promise<any>>;
			action?: string;
			notification: Notification;
			reply?: string | null;
		},
	) {
		super(type, options.pendingPromises);
		this.action = options.action || "";
		this.notification = options.notification;
		this.reply = options.reply || null;
	}
}

/**
 * PushEvent for push message handling
 */
export class PushEvent extends ExtendableEvent {
	readonly data: PushMessageData | null;

	constructor(
		type: string,
		options: {
			pendingPromises: Set<Promise<any>>;
			data?: PushMessageData | null;
		},
	) {
		super(type, options.pendingPromises);
		this.data = options.data || null;
	}
}

/**
 * PushMessageData represents the data of a push message
 */
export class PushMessageData {
	constructor(private _data: any) {}

	arrayBuffer(): ArrayBuffer {
		if (this._data instanceof ArrayBuffer) {
			return this._data;
		}
		return new TextEncoder().encode(this._data).buffer;
	}

	blob(): Blob {
		return new Blob([this.arrayBuffer()]);
	}

	json(): any {
		return JSON.parse(this.text());
	}

	text(): string {
		if (typeof this._data === "string") {
			return this._data;
		}
		return new TextDecoder().decode(this._data);
	}
}

/**
 * SyncEvent for background sync
 */
export class SyncEvent extends ExtendableEvent {
	readonly tag: string;
	readonly lastChance: boolean;

	constructor(
		type: string,
		options: {
			pendingPromises: Set<Promise<any>>;
			tag: string;
			lastChance?: boolean;
		},
	) {
		super(type, options.pendingPromises);
		this.tag = options.tag;
		this.lastChance = options.lastChance || false;
	}
}

// Supporting types (these would normally come from lib.dom.d.ts)
interface NotificationAction {
	action: string;
	title: string;
	icon?: string;
}

interface NotificationOptions {
	actions?: NotificationAction[];
	badge?: string;
	body?: string;
	data?: any;
	dir?: "auto" | "ltr" | "rtl";
	icon?: string;
	image?: string;
	lang?: string;
	renotify?: boolean;
	requireInteraction?: boolean;
	silent?: boolean;
	tag?: string;
	timestamp?: number;
	vibrate?: number[];
}

/**
 * Complete ServiceWorker API export object
 * Contains all MDN-specified interfaces for easy access
 */
export const ServiceWorkerAPI = {
	// Core classes
	Client,
	Clients,
	ExtendableEvent: ExtendableEvent,
	ExtendableMessageEvent,
	FetchEvent: FetchEvent,
	InstallEvent: InstallEvent,
	ActivateEvent: ActivateEvent,
	NavigationPreloadManager,
	Notification,
	NotificationEvent,
	PushEvent,
	PushMessageData,
	ServiceWorker,
	ServiceWorkerContainer,
	ServiceWorkerRegistration,
	SyncEvent,
	WindowClient,
} as const;
// ============================================================================
// ShovelGlobalScope - ServiceWorker Global Scope Implementation
// ============================================================================

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

			async get(_id: string): Promise<Client | undefined> {
				// Return undefined - no persistent clients in HTTP-only server
				return undefined;
			},

			async matchAll(_options?: ClientQueryOptions): Promise<Client[]> {
				// Return empty array - no persistent clients in HTTP-only server
				return [];
			},

			async openWindow(_url: string | URL): Promise<WindowClient | null> {
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
