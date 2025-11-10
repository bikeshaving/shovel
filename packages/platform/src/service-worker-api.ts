/**
 * Complete Service Worker API Type Shims
 * 
 * This file implements all Service Worker API interfaces as defined in:
 * https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API#interfaces
 * 
 * Provides compatibility shims for running ServiceWorker code in any JavaScript runtime.
 */

// Import base event classes from service-worker.ts
import { 
	ExtendableEvent as BaseExtendableEvent, 
	FetchEvent as BaseFetchEvent, 
	InstallEvent as BaseInstallEvent, 
	ActivateEvent as BaseActivateEvent 
} from './service-worker.js';

// Re-export with original names
export { 
	ExtendableEvent, 
	FetchEvent, 
	InstallEvent, 
	ActivateEvent 
} from './service-worker.js';

/**
 * Client represents the scope of a service worker client
 * Either a document in a browser context or a SharedWorker
 */
export class Client {
	readonly frameType: 'auxiliary' | 'top-level' | 'nested' | 'none' = 'none';
	readonly id: string;
	readonly type: 'window' | 'worker' | 'sharedworker' = 'worker';
	readonly url: string;

	constructor(options: { 
		id: string; 
		url: string; 
		type?: 'window' | 'worker' | 'sharedworker' 
	}) {
		this.id = options.id;
		this.url = options.url;
		this.type = options.type || 'worker';
	}

	postMessage(message: any, transfer?: Transferable[]): void {
		console.warn('[ServiceWorker] Client.postMessage() not supported in server context');
	}
}

/**
 * WindowClient represents a service worker client that is a document in a browser context
 */
export class WindowClient extends Client {
	readonly focused: boolean = false;
	readonly visibilityState: 'visible' | 'hidden' | 'prerender' = 'hidden';

	constructor(options: {
		id: string;
		url: string;
		focused?: boolean;
		visibilityState?: 'visible' | 'hidden' | 'prerender';
	}) {
		super({ ...options, type: 'window' });
		this.focused = options.focused || false;
		this.visibilityState = options.visibilityState || 'hidden';
	}

	async focus(): Promise<WindowClient> {
		console.warn('[ServiceWorker] WindowClient.focus() not supported in server context');
		return this;
	}

	async navigate(url: string): Promise<WindowClient | null> {
		console.warn('[ServiceWorker] WindowClient.navigate() not supported in server context');
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

	async get(id: string): Promise<Client | undefined> {
		return undefined;
	}

	async matchAll(options?: {
		includeUncontrolled?: boolean;
		type?: 'window' | 'worker' | 'sharedworker' | 'all';
	}): Promise<Client[]> {
		return [];
	}

	async openWindow(url: string): Promise<WindowClient | null> {
		console.warn('[ServiceWorker] Clients.openWindow() not supported in server context');
		return null;
	}
}

/**
 * ExtendableMessageEvent represents message events with waitUntil support
 */
export class ExtendableMessageEvent extends BaseExtendableEvent {
	readonly data: any;
	readonly origin: string;
	readonly lastEventId: string;
	readonly source: Client | ServiceWorker | MessagePort | null;
	readonly ports: readonly MessagePort[];

	constructor(type: string, options: {
		pendingPromises: Set<Promise<any>>;
		data?: any;
		origin?: string;
		lastEventId?: string;
		source?: Client | ServiceWorker | MessagePort | null;
		ports?: MessagePort[];
	}) {
		super(type, options.pendingPromises);
		this.data = options.data;
		this.origin = options.origin || '';
		this.lastEventId = options.lastEventId || '';
		this.source = options.source || null;
		this.ports = Object.freeze([...(options.ports || [])]);
	}
}

/**
 * ServiceWorker interface represents a service worker
 */
export class ServiceWorker extends EventTarget {
	readonly scriptURL: string;
	readonly state: 'parsed' | 'installing' | 'installed' | 'activating' | 'activated' | 'redundant';

	constructor(scriptURL: string, state: 'parsed' | 'installing' | 'installed' | 'activating' | 'activated' | 'redundant' = 'activated') {
		super();
		this.scriptURL = scriptURL;
		this.state = state;
	}

	postMessage(message: any, transfer?: Transferable[]): void {
		console.warn('[ServiceWorker] ServiceWorker.postMessage() not implemented in server context');
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

	async getState(): Promise<{ enabled: boolean; headerValue: string }> {
		return { enabled: false, headerValue: '' };
	}

	async setHeaderValue(value: string): Promise<void> {
		// No-op in server context
	}
}

/**
 * ServiceWorkerRegistration represents a service worker registration
 */
export class ServiceWorkerRegistration extends EventTarget {
	readonly scope: string;
	readonly updateViaCache: 'imports' | 'all' | 'none' = 'imports';
	readonly active: ServiceWorker | null;
	readonly installing: ServiceWorker | null;
	readonly waiting: ServiceWorker | null;
	readonly navigationPreload: NavigationPreloadManager;

	constructor(scope: string, serviceWorker?: ServiceWorker) {
		super();
		this.scope = scope;
		this.active = serviceWorker || null;
		this.installing = null;
		this.waiting = null;
		this.navigationPreload = new NavigationPreloadManager();
	}

	async getNotifications(options?: NotificationOptions): Promise<Notification[]> {
		return [];
	}

	async showNotification(title: string, options?: NotificationOptions): Promise<void> {
		console.warn('[ServiceWorker] Notifications not supported in server context');
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

	// Events: updatefound
}

/**
 * ServiceWorkerContainer provides access to service worker registration and messaging
 */
export class ServiceWorkerContainer extends EventTarget {
	readonly controller: ServiceWorker | null = null;
	readonly ready: Promise<ServiceWorkerRegistration>;

	constructor() {
		super();
		// Provide a default registration for compatibility
		this.ready = Promise.resolve(
			new ServiceWorkerRegistration('/', new ServiceWorker('/', 'activated'))
		);
	}

	async getRegistration(scope?: string): Promise<ServiceWorkerRegistration | undefined> {
		return undefined;
	}

	async getRegistrations(): Promise<ServiceWorkerRegistration[]> {
		return [];
	}

	async register(scriptURL: string | URL, options?: {
		scope?: string;
		type?: 'classic' | 'module';
		updateViaCache?: 'imports' | 'all' | 'none';
	}): Promise<ServiceWorkerRegistration> {
		const url = typeof scriptURL === 'string' ? scriptURL : scriptURL.toString();
		const scope = options?.scope || '/';
		const serviceWorker = new ServiceWorker(url, 'activated');
		return new ServiceWorkerRegistration(scope, serviceWorker);
	}

	startMessages(): void {
		// No-op in server context
	}

	// Events: controllerchange, message, messageerror
}

/**
 * Notification interface for push notifications (server context stubs)
 */
export class Notification extends EventTarget {
	readonly actions: readonly NotificationAction[];
	readonly badge: string;
	readonly body: string;
	readonly data: any;
	readonly dir: 'auto' | 'ltr' | 'rtl';
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
		this.badge = options.badge || '';
		this.body = options.body || '';
		this.data = options.data;
		this.dir = options.dir || 'auto';
		this.icon = options.icon || '';
		this.image = options.image || '';
		this.lang = options.lang || '';
		this.renotify = options.renotify || false;
		this.requireInteraction = options.requireInteraction || false;
		this.silent = options.silent || false;
		this.tag = options.tag || '';
		this.timestamp = options.timestamp || Date.now();
		this.vibrate = Object.freeze([...(options.vibrate || [])]);
	}

	close(): void {
		console.warn('[ServiceWorker] Notification.close() not supported in server context');
	}

	static permission: 'default' | 'denied' | 'granted' = 'denied';

	static async requestPermission(): Promise<'default' | 'denied' | 'granted'> {
		return 'denied';
	}

	// Events: click, close, error, show
}

/**
 * NotificationEvent for notification interactions
 */
export class NotificationEvent extends BaseExtendableEvent {
	readonly action: string;
	readonly notification: Notification;
	readonly reply: string | null = null;

	constructor(type: string, options: {
		pendingPromises: Set<Promise<any>>;
		action?: string;
		notification: Notification;
		reply?: string | null;
	}) {
		super(type, options.pendingPromises);
		this.action = options.action || '';
		this.notification = options.notification;
		this.reply = options.reply || null;
	}
}

/**
 * PushEvent for push message handling
 */
export class PushEvent extends BaseExtendableEvent {
	readonly data: PushMessageData | null;

	constructor(type: string, options: {
		pendingPromises: Set<Promise<any>>;
		data?: PushMessageData | null;
	}) {
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
		if (typeof this._data === 'string') {
			return this._data;
		}
		return new TextDecoder().decode(this._data);
	}
}

/**
 * SyncEvent for background sync
 */
export class SyncEvent extends BaseExtendableEvent {
	readonly tag: string;
	readonly lastChance: boolean;

	constructor(type: string, options: {
		pendingPromises: Set<Promise<any>>;
		tag: string;
		lastChance?: boolean;
	}) {
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
	dir?: 'auto' | 'ltr' | 'rtl';
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
	ExtendableEvent: BaseExtendableEvent,
	ExtendableMessageEvent,
	FetchEvent: BaseFetchEvent,
	InstallEvent: BaseInstallEvent,
	ActivateEvent: BaseActivateEvent,
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