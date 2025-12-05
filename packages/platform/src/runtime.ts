/**
 * ServiceWorker Runtime - Complete ServiceWorker API Implementation
 *
 * This module provides the complete ServiceWorker runtime environment for Shovel:
 * - Cookie Store API (RequestCookieStore for per-request cookie management)
 * - Base Event Classes (ExtendableEvent, FetchEvent, InstallEvent, ActivateEvent)
 * - ServiceWorker API Type Shims (Client, Clients, ServiceWorkerRegistration, etc.)
 * - ServiceWorkerGlobals (installs ServiceWorker globals onto any JavaScript runtime)
 *
 * Based on: https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API#interfaces
 */

import {AsyncContext} from "@b9g/async-context";

// ============================================================================
// Cookie Store API Implementation
// https://cookiestore.spec.whatwg.org/
// ============================================================================

// Extend the incomplete global CookieListItem with missing properties
// TypeScript's lib.dom.d.ts only has name? and value?, but the spec includes all cookie attributes
declare global {
	interface CookieListItem {
		domain?: string;
		path?: string;
		expires?: number;
		secure?: boolean;
		sameSite?: CookieSameSite;
		partitioned?: boolean;
	}
}

// Create and export local type aliases that reference the (now-complete) global types
export type CookieSameSite = globalThis.CookieSameSite;
export type CookieInit = globalThis.CookieInit;
export type CookieStoreGetOptions = globalThis.CookieStoreGetOptions;
export type CookieStoreDeleteOptions = globalThis.CookieStoreDeleteOptions;
export type CookieListItem = globalThis.CookieListItem;
export type CookieList = CookieListItem[];

/**
 * Parse Cookie header value into key-value pairs
 * Cookie: name=value; name2=value2
 */
export function parseCookieHeader(cookieHeader: string): Map<string, string> {
	const cookies = new Map<string, string>();
	if (!cookieHeader) return cookies;

	const pairs = cookieHeader.split(/;\s*/);
	for (const pair of pairs) {
		const [name, ...valueParts] = pair.split("=");
		if (name) {
			const value = valueParts.join("="); // Handle values with = in them
			cookies.set(name.trim(), decodeURIComponent(value || ""));
		}
	}

	return cookies;
}

/**
 * Serialize cookie into Set-Cookie header value
 */
export function serializeCookie(cookie: CookieInit): string {
	let header = `${encodeURIComponent(cookie.name)}=${encodeURIComponent(cookie.value)}`;

	if (cookie.expires !== undefined && cookie.expires !== null) {
		const date = new Date(cookie.expires);
		header += `; Expires=${date.toUTCString()}`;
	}

	if (cookie.domain) {
		header += `; Domain=${cookie.domain}`;
	}

	if (cookie.path) {
		header += `; Path=${cookie.path}`;
	} else {
		header += `; Path=/`;
	}

	if (cookie.sameSite) {
		header += `; SameSite=${cookie.sameSite.charAt(0).toUpperCase() + cookie.sameSite.slice(1)}`;
	} else {
		header += `; SameSite=Strict`;
	}

	if (cookie.partitioned) {
		header += `; Partitioned`;
	}

	// Secure is implied for all cookies in this implementation
	header += `; Secure`;

	return header;
}

/**
 * Parse Set-Cookie header into CookieListItem
 */
export function parseSetCookieHeader(setCookieHeader: string): CookieListItem {
	const parts = setCookieHeader.split(/;\s*/);
	const [nameValue, ...attributes] = parts;
	const [name, ...valueParts] = nameValue.split("=");
	const value = valueParts.join("=");

	const cookie: CookieListItem = {
		name: decodeURIComponent(name.trim()),
		value: decodeURIComponent(value || ""),
	};

	for (const attr of attributes) {
		const [key, ...attrValueParts] = attr.split("=");
		const attrKey = key.trim().toLowerCase();
		const attrValue = attrValueParts.join("=").trim();

		switch (attrKey) {
			case "expires":
				cookie.expires = new Date(attrValue).getTime();
				break;
			case "max-age":
				cookie.expires = Date.now() + parseInt(attrValue, 10) * 1000;
				break;
			case "domain":
				cookie.domain = attrValue;
				break;
			case "path":
				cookie.path = attrValue;
				break;
			case "secure":
				cookie.secure = true;
				break;
			case "samesite":
				cookie.sameSite = attrValue.toLowerCase() as CookieSameSite;
				break;
			case "partitioned":
				cookie.partitioned = true;
				break;
		}
	}

	return cookie;
}

/**
 * RequestCookieStore - Cookie Store implementation for ServiceWorker contexts
 *
 * This implementation:
 * - Reads cookies from the incoming Request's Cookie header
 * - Tracks changes (set/delete operations)
 * - Exports changes as Set-Cookie headers for the Response
 *
 * It follows the Cookie Store API spec but is designed for server-side
 * request handling rather than browser contexts.
 */
export class RequestCookieStore extends EventTarget {
	#cookies: Map<string, CookieListItem>;
	#changes: Map<string, CookieInit | null>; // null = deleted
	#request: Request | null;

	// Event handler for cookie changes (spec compliance)
	// eslint-disable-next-line no-restricted-syntax
	onchange: ((this: RequestCookieStore, ev: Event) => any) | null = null;

	constructor(request?: Request) {
		super();
		this.#cookies = new Map();
		this.#changes = new Map();
		this.#request = request || null;

		// Parse initial cookies from request
		if (request) {
			const cookieHeader = request.headers.get("cookie");
			if (cookieHeader) {
				const parsed = parseCookieHeader(cookieHeader);
				for (const [name, value] of parsed) {
					this.#cookies.set(name, {name, value});
				}
			}
		}
	}

	async get(
		nameOrOptions: string | CookieStoreGetOptions,
	): Promise<CookieListItem | null> {
		const name =
			typeof nameOrOptions === "string" ? nameOrOptions : nameOrOptions.name;

		if (!name) {
			throw new TypeError("Cookie name is required");
		}

		// Check changes first (for set/delete operations)
		if (this.#changes.has(name)) {
			const change = this.#changes.get(name);
			if (change === null || change === undefined) return null;
			return {
				name: change.name,
				value: change.value,
				domain: change.domain ?? undefined,
				path: change.path,
				expires: change.expires ?? undefined,
				sameSite: change.sameSite,
				partitioned: change.partitioned,
			};
		}

		return this.#cookies.get(name) || null;
	}

	async getAll(
		nameOrOptions?: string | CookieStoreGetOptions,
	): Promise<CookieList> {
		const name =
			typeof nameOrOptions === "string" ? nameOrOptions : nameOrOptions?.name;

		const result: CookieList = [];

		// Collect all cookies (original + changes)
		const allNames = new Set([
			...this.#cookies.keys(),
			...this.#changes.keys(),
		]);

		for (const cookieName of allNames) {
			if (name && cookieName !== name) continue;

			if (
				this.#changes.has(cookieName) &&
				this.#changes.get(cookieName) === null
			) {
				continue;
			}

			const cookie = await this.get(cookieName);
			if (cookie) {
				result.push(cookie);
			}
		}

		return result;
	}

	async set(nameOrOptions: string | CookieInit, value?: string): Promise<void> {
		let cookie: CookieInit;

		if (typeof nameOrOptions === "string") {
			if (value === undefined) {
				throw new TypeError("Cookie value is required");
			}
			cookie = {
				name: nameOrOptions,
				value,
				path: "/",
				sameSite: "strict",
			};
		} else {
			cookie = {
				path: "/",
				sameSite: "strict",
				...nameOrOptions,
			};
		}

		// Validate cookie size (spec: 4096 bytes combined)
		const size = cookie.name.length + cookie.value.length;
		if (size > 4096) {
			throw new TypeError(
				`Cookie name+value too large: ${size} bytes (max 4096)`,
			);
		}

		this.#changes.set(cookie.name, cookie);
	}

	async delete(
		nameOrOptions: string | CookieStoreDeleteOptions,
	): Promise<void> {
		const name =
			typeof nameOrOptions === "string" ? nameOrOptions : nameOrOptions.name;

		if (!name) {
			throw new TypeError("Cookie name is required");
		}

		this.#changes.set(name, null);
	}

	/**
	 * Get Set-Cookie headers for all changes
	 * This should be called when constructing the Response
	 */
	getSetCookieHeaders(): string[] {
		const headers: string[] = [];

		for (const [name, change] of this.#changes) {
			if (change === null) {
				// Delete cookie by setting expires to past date
				headers.push(
					serializeCookie({
						name,
						value: "",
						expires: 0,
						path: "/",
					}),
				);
			} else {
				headers.push(serializeCookie(change));
			}
		}

		return headers;
	}

	hasChanges(): boolean {
		return this.#changes.size > 0;
	}

	clearChanges(): void {
		this.#changes.clear();
	}
}

import type {DirectoryStorage} from "@b9g/filesystem";
import {
	configure,
	type LogLevel as LogTapeLevel,
	type Logger,
} from "@logtape/logtape";

// ============================================================================
// Logger Storage API
// ============================================================================

/**
 * Logger storage interface for accessing loggers by category path.
 * Unlike CacheStorage/DirectoryStorage which use a registry pattern,
 * LoggerStorage uses variadic categories since logging backends are
 * always LogTape and per-category config is in shovel.config.json.
 */
export interface LoggerStorage {
	/**
	 * Open a logger by category path - returns LogTape's Logger directly
	 * @example loggers.open("app") → getLogger(["app"])
	 * @example loggers.open("app", "db") → getLogger(["app", "db"])
	 */
	open(...categories: string[]): Logger;
}

/**
 * Factory function type for creating loggers
 */
export type LoggerFactory = (...categories: string[]) => Logger;

/**
 * Custom logger storage implementation that wraps a factory function
 */
export class CustomLoggerStorage implements LoggerStorage {
	#factory: LoggerFactory;

	constructor(factory: LoggerFactory) {
		this.#factory = factory;
	}

	open(...categories: string[]): Logger {
		return this.#factory(...categories);
	}
}

// ============================================================================
// ServiceWorker Event Constants
// ============================================================================

/** ServiceWorker-specific event types that go to registration instead of native handler */
const SERVICE_WORKER_EVENTS = ["fetch", "install", "activate"] as const;

function isServiceWorkerEvent(type: string): boolean {
	return (SERVICE_WORKER_EVENTS as readonly string[]).includes(type);
}

// Set MODE from NODE_ENV for Vite compatibility
// import.meta.env is shimmed to process.env via esbuild define on Node.js
if (import.meta.env && !import.meta.env.MODE && import.meta.env.NODE_ENV) {
	import.meta.env.MODE = import.meta.env.NODE_ENV;
}

// ============================================================================
// AsyncContext for per-request cookieStore
// ============================================================================

/**
 * Storage for per-request cookieStore instances
 * This enables self.cookieStore to work correctly with concurrent requests
 */
const cookieStoreStorage = new AsyncContext.Variable<RequestCookieStore>();

/**
 * Storage for tracking fetch depth to prevent infinite self-fetch loops
 * Incremented on each internal fetch, throws if limit exceeded
 */
const fetchDepthStorage = new AsyncContext.Variable<number>();
const MAX_FETCH_DEPTH = 10;

/**
 * Keys we patch on globalThis in install()
 * Used to save originals and restore them in restore()
 */
const PATCHED_KEYS = [
	"self",
	"fetch",
	"caches",
	"directories",
	"loggers",
	"registration",
	"clients",
	"skipWaiting",
	"addEventListener",
	"removeEventListener",
	"dispatchEvent",
	"WorkerGlobalScope",
	"DedicatedWorkerGlobalScope",
	"cookieStore",
] as const;

type PatchedKey = (typeof PATCHED_KEYS)[number];

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Wrap a promise with a timeout
 * @param promise Promise to wrap
 * @param timeoutMs Timeout in milliseconds
 * @param errorMessage Error message if timeout occurs
 * @returns Promise that rejects if timeout occurs
 */
function promiseWithTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	errorMessage: string,
): Promise<T> {
	return Promise.race([
		promise,
		new Promise<T>((_, reject) =>
			setTimeout(() => reject(new Error(errorMessage)), timeoutMs),
		),
	]);
}

// ============================================================================
// Internal Symbols for ExtendableEvent
// ============================================================================

/** Symbol for ending dispatch phase (internal use only) */
const kEndDispatchPhase = Symbol.for("shovel.endDispatchPhase");

/** Symbol for checking if extensions are allowed (internal use only) */
const kCanExtend = Symbol.for("shovel.canExtend");

// ============================================================================
// Base Event Classes
// ============================================================================

/**
 * ExtendableEvent base class following ServiceWorker spec
 * Standard constructor: new ExtendableEvent(type) or new ExtendableEvent(type, options)
 *
 * Per spec, waitUntil() can be called:
 * 1. Synchronously during event dispatch, OR
 * 2. Asynchronously if there are pending promises from prior waitUntil/respondWith calls
 *
 * See: https://github.com/w3c/ServiceWorker/issues/771
 */
export class ExtendableEvent extends Event {
	#promises: Promise<any>[];
	#dispatchPhase: boolean;
	#pendingCount: number;

	constructor(type: string, eventInitDict?: EventInit) {
		super(type, eventInitDict);
		this.#promises = [];
		this.#dispatchPhase = true; // Starts true, set to false after dispatch
		this.#pendingCount = 0;
	}

	waitUntil(promise: Promise<any>): void {
		// Per spec: waitUntil can be called during dispatch phase OR if there are pending promises
		// See: https://w3c.github.io/ServiceWorker/#dom-extendableevent-waituntil
		if (!this.#dispatchPhase && this.#pendingCount === 0) {
			throw new DOMException(
				"waitUntil() must be called synchronously during event dispatch, " +
					"or while there are pending promises from respondWith()/waitUntil()",
				"InvalidStateError",
			);
		}

		// Track pending count
		this.#pendingCount++;
		const trackedPromise = promise.finally(() => {
			this.#pendingCount--;
		});

		// Attach catch handler to input promise to suppress unhandled rejection logging
		trackedPromise.catch(() => {});

		// Store the promise for Promise.all() to consume (rejection still propagates)
		this.#promises.push(trackedPromise);
	}

	getPromises(): Promise<any>[] {
		return [...this.#promises];
	}

	/** @internal Called after synchronous dispatch completes */
	[kEndDispatchPhase](): void {
		this.#dispatchPhase = false;
	}

	/** @internal Check if extensions are still allowed */
	[kCanExtend](): boolean {
		return this.#dispatchPhase || this.#pendingCount > 0;
	}
}

/**
 * ServiceWorker-style fetch event
 */
export class FetchEvent extends ExtendableEvent {
	readonly request: Request;
	readonly cookieStore: RequestCookieStore;
	#responsePromise: Promise<Response> | null;
	#responded: boolean;

	constructor(request: Request, eventInitDict?: EventInit) {
		super("fetch", eventInitDict);
		this.request = request;
		this.cookieStore = new RequestCookieStore(request);
		this.#responsePromise = null;
		this.#responded = false;
	}

	respondWith(response: Response | Promise<Response>): void {
		if (this.#responded) {
			throw new Error("respondWith() already called");
		}

		// Per spec, respondWith must be called during dispatch phase
		if (!this[kCanExtend]()) {
			throw new DOMException(
				"respondWith() must be called synchronously during event dispatch",
				"InvalidStateError",
			);
		}

		this.#responded = true;
		this.#responsePromise = Promise.resolve(response);

		// Per spec, respondWith() extends the event lifetime (allows async waitUntil)
		// We use waitUntil internally to track pending promise count
		this.waitUntil(this.#responsePromise);
	}

	getResponse(): Promise<Response> | null {
		return this.#responsePromise;
	}

	hasResponded(): boolean {
		return this.#responded;
	}
}

/**
 * ServiceWorker-style install event
 */
export class InstallEvent extends ExtendableEvent {
	constructor(eventInitDict?: EventInit) {
		super("install", eventInitDict);
	}
}

/**
 * ServiceWorker-style activate event
 */
export class ActivateEvent extends ExtendableEvent {
	constructor(eventInitDict?: EventInit) {
		super("activate", eventInitDict);
	}
}
// ============================================================================
// ServiceWorker API Implementation
// ============================================================================

/**
 * ShovelClient - Internal implementation of Client for Shovel runtime
 * Note: Standard Client has no constructor - instances are created internally
 */
export class ShovelClient implements Client {
	readonly frameType: "auxiliary" | "top-level" | "nested" | "none";
	readonly id: string;
	readonly type: "window" | "worker" | "sharedworker";
	readonly url: string;

	constructor(options: {
		id: string;
		url: string;
		type?: "window" | "worker" | "sharedworker";
	}) {
		this.frameType = "none";
		this.id = options.id;
		this.url = options.url;
		this.type = options.type || "worker";
	}

	// postMessage overload with Transferable array
	postMessage(message: any, transfer: Transferable[]): void;
	// postMessage overload with StructuredSerializeOptions
	postMessage(message: any, options?: StructuredSerializeOptions): void;
	// Implementation
	postMessage(
		_message: any,
		_transferOrOptions?: Transferable[] | StructuredSerializeOptions,
	): void {
		(self as any).loggers
			.open("platform")
			.warn("Client.postMessage() not supported in server context");
	}
}

/**
 * ShovelWindowClient - Internal implementation of WindowClient for Shovel runtime
 * Note: Standard WindowClient has no constructor - instances are created internally
 */
export class ShovelWindowClient extends ShovelClient implements WindowClient {
	readonly focused: boolean;
	readonly visibilityState: DocumentVisibilityState;

	constructor(options: {
		id: string;
		url: string;
		focused?: boolean;
		visibilityState?: DocumentVisibilityState;
	}) {
		super({...options, type: "window"});
		this.focused = options.focused || false;
		this.visibilityState = options.visibilityState || "hidden";
	}

	async focus(): Promise<WindowClient> {
		(self as any).loggers
			.open("platform")
			.warn("WindowClient.focus() not supported in server context");
		return this;
	}

	async navigate(_url: string): Promise<WindowClient | null> {
		(self as any).loggers
			.open("platform")
			.warn("WindowClient.navigate() not supported in server context");
		return null;
	}
}

/**
 * ShovelClients - Internal implementation of Clients for Shovel runtime
 * Note: Standard Clients has no constructor - instances are created internally
 */
export class ShovelClients implements Clients {
	async claim(): Promise<void> {
		// No-op: HTTP servers don't have persistent clients to claim
	}

	async get(_id: string): Promise<Client | undefined> {
		return undefined;
	}

	async matchAll<T extends ClientQueryOptions>(
		_options?: T,
	): Promise<readonly (T["type"] extends "window" ? WindowClient : Client)[]> {
		return [] as readonly (T["type"] extends "window"
			? WindowClient
			: Client)[];
	}

	async openWindow(_url: string): Promise<WindowClient | null> {
		(self as any).loggers
			.open("platform")
			.warn("Clients.openWindow() not supported in server context");
		return null;
	}
}

/**
 * ExtendableMessageEvent represents message events with waitUntil support
 */
export interface ExtendableMessageEventInit extends EventInit {
	data?: any;
	origin?: string;
	lastEventId?: string;
	source?: Client | ServiceWorker | MessagePort | null;
	ports?: MessagePort[];
}

export class ExtendableMessageEvent extends ExtendableEvent {
	readonly data: any;
	readonly origin: string;
	readonly lastEventId: string;
	readonly source: Client | ServiceWorker | MessagePort | null;
	readonly ports: readonly MessagePort[];

	constructor(type: string, eventInitDict?: ExtendableMessageEventInit) {
		super(type, eventInitDict);
		this.data = eventInitDict?.data ?? null;
		this.origin = eventInitDict?.origin ?? "";
		this.lastEventId = eventInitDict?.lastEventId ?? "";
		this.source = eventInitDict?.source ?? null;
		this.ports = Object.freeze([...(eventInitDict?.ports ?? [])]);
	}
}

/**
 * ShovelServiceWorker - Internal implementation of ServiceWorker for Shovel runtime
 * Note: Standard ServiceWorker has no constructor - instances are created internally
 */
export class ShovelServiceWorker extends EventTarget implements ServiceWorker {
	scriptURL: string;
	state:
		| "parsed"
		| "installing"
		| "installed"
		| "activating"
		| "activated"
		| "redundant";

	// Event handlers required by Web API
	onstatechange: ((ev: Event) => any) | null;
	onerror: ((ev: Event) => any) | null;

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
		this.onstatechange = null;
		this.onerror = null;
	}

	// postMessage overload with Transferable array
	postMessage(message: any, transfer: Transferable[]): void;
	// postMessage overload with StructuredSerializeOptions
	postMessage(message: any, options?: StructuredSerializeOptions): void;
	// Implementation
	postMessage(
		_message: any,
		_transferOrOptions?: Transferable[] | StructuredSerializeOptions,
	): void {
		(self as any).loggers
			.open("platform")
			.warn("ServiceWorker.postMessage() not implemented in server context");
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
 * ShovelNavigationPreloadManager - Internal implementation of NavigationPreloadManager
 * Note: Standard NavigationPreloadManager has no constructor - instances are created internally
 */
export class ShovelNavigationPreloadManager
	implements NavigationPreloadManager
{
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
 * ShovelServiceWorkerRegistration - Internal implementation of ServiceWorkerRegistration
 * This is also the Shovel ServiceWorker runtime - they are unified into one class
 * Note: Standard ServiceWorkerRegistration has no constructor - instances are created internally
 */
export class ShovelServiceWorkerRegistration
	extends EventTarget
	implements ServiceWorkerRegistration
{
	readonly scope: string;
	readonly updateViaCache: "imports" | "all" | "none";
	readonly navigationPreload: NavigationPreloadManager;

	// ServiceWorker instances representing different lifecycle states
	_serviceWorker: ShovelServiceWorker;

	// Web API properties (not supported in server context, but required by interface)
	readonly cookies: any;
	readonly pushManager: any;
	onupdatefound: ((ev: Event) => any) | null;

	constructor(scope: string = "/", scriptURL: string = "/") {
		super();
		this.scope = scope;
		this.updateViaCache = "imports";
		this.navigationPreload = new ShovelNavigationPreloadManager();
		this._serviceWorker = new ShovelServiceWorker(scriptURL, "parsed");
		this.cookies = null;
		this.pushManager = null;
		this.onupdatefound = null;
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
		(self as any).loggers
			.open("platform")
			.warn("Notifications not supported in server context");
	}

	async sync(): Promise<void> {
		// No-op in server context
	}

	async unregister(): Promise<boolean> {
		return false;
	}

	async update(): Promise<ServiceWorkerRegistration> {
		// No-op in server context - just return this registration
		return this;
	}

	// Shovel runtime extensions (non-standard but needed for platforms)

	/**
	 * Install the ServiceWorker (Shovel extension)
	 */
	async install(): Promise<void> {
		if (this._serviceWorker.state !== "parsed") return;

		this._serviceWorker._setState("installing");

		return new Promise<void>((resolve, reject) => {
			const event = new InstallEvent();

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
					// Wrap with timeout to prevent indefinite hangs
					promiseWithTimeout(
						Promise.all(promises),
						30000,
						"ServiceWorker install event timed out after 30s - waitUntil promises did not resolve",
					)
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
			const event = new ActivateEvent();

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
					// Wrap with timeout to prevent indefinite hangs
					promiseWithTimeout(
						Promise.all(promises),
						30000,
						"ServiceWorker activate event timed out after 30s - waitUntil promises did not resolve",
					)
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

		// Create the fetch event with its per-request cookieStore
		const event = new FetchEvent(request);

		// Run the request handling within the AsyncLocalStorage context
		// This makes event.cookieStore available via self.cookieStore
		return cookieStoreStorage.run(event.cookieStore, async () => {
			// Dispatch event using native EventTarget
			this.dispatchEvent(event);

			// End the dispatch phase - after this, waitUntil/respondWith require pending promises
			event[kEndDispatchPhase]();

			// Per ServiceWorker spec, respondWith() must be called synchronously
			// during event dispatch. No need to defer - check immediately.
			if (!event.hasResponded()) {
				throw new Error(
					"No response provided for fetch event. " +
						"respondWith() must be called synchronously during event dispatch.",
				);
			}

			// Get the response (may be a Promise)
			const response = await event.getResponse()!;

			// Fire off waitUntil promises (background tasks, don't block response)
			const promises = event.getPromises();
			if (promises.length > 0) {
				Promise.allSettled(promises).catch(
					(err) =>
						(self as any).loggers.open("platform")
							.error`waitUntil error: ${err}`,
				);
			}

			// Apply cookie changes from the cookieStore to the response
			if (event.cookieStore.hasChanges()) {
				const setCookieHeaders = event.cookieStore.getSetCookieHeaders();
				const headers = new Headers(response.headers);

				// Add all Set-Cookie headers
				for (const setCookie of setCookieHeaders) {
					headers.append("Set-Cookie", setCookie);
				}

				// Create new response with updated headers
				return new Response(response.body, {
					status: response.status,
					statusText: response.statusText,
					headers,
				});
			}

			return response;
		});
	}

	/**
	 * Check if ready to handle requests (Shovel extension)
	 */
	get ready(): boolean {
		return this._serviceWorker.state === "activated";
	}

	// Events: updatefound (standard), plus Shovel lifecycle events
}

/**
 * ShovelServiceWorkerContainer - Internal implementation of ServiceWorkerContainer
 * This is the registry that manages multiple ServiceWorkerRegistrations by scope
 * Note: Standard ServiceWorkerContainer has no constructor - instances are created internally
 */
export class ShovelServiceWorkerContainer
	extends EventTarget
	implements ServiceWorkerContainer
{
	#registrations: Map<string, ShovelServiceWorkerRegistration>;
	readonly controller: ServiceWorker | null;
	readonly ready: Promise<ServiceWorkerRegistration>;

	// Event handlers required by Web API
	oncontrollerchange: ((ev: Event) => any) | null;
	onmessage: ((ev: MessageEvent) => any) | null;
	onmessageerror: ((ev: MessageEvent) => any) | null;

	constructor() {
		super();
		this.#registrations = new Map<string, ShovelServiceWorkerRegistration>();
		this.controller = null;
		this.oncontrollerchange = null;
		this.onmessage = null;
		this.onmessageerror = null;
		// Create default registration for root scope
		const defaultRegistration = new ShovelServiceWorkerRegistration("/", "/");
		this.#registrations.set("/", defaultRegistration);
		this.ready = Promise.resolve(defaultRegistration);
	}

	/**
	 * Get registration for a specific scope
	 */
	async getRegistration(
		scope: string = "/",
	): Promise<ServiceWorkerRegistration | undefined> {
		return this.#registrations.get(scope);
	}

	/**
	 * Get all registrations
	 */
	async getRegistrations(): Promise<ServiceWorkerRegistration[]> {
		return Array.from(this.#registrations.values());
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
		const scope = this.#normalizeScope(options?.scope || "/");

		// Check if registration already exists for this scope
		let registration = this.#registrations.get(scope);

		if (registration) {
			// Update existing registration with new script
			registration._serviceWorker.scriptURL = url;
			registration._serviceWorker._setState("parsed");
		} else {
			// Create new registration
			registration = new ShovelServiceWorkerRegistration(scope, url);
			this.#registrations.set(scope, registration);

			// Dispatch updatefound event
			this.dispatchEvent(new Event("updatefound"));
		}

		return registration;
	}

	/**
	 * Unregister a ServiceWorker registration
	 */
	async unregister(scope: string): Promise<boolean> {
		const registration = this.#registrations.get(scope);
		if (registration) {
			await registration.unregister();
			this.#registrations.delete(scope);
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
		const matchingScope = this.#findMatchingScope(pathname);

		if (matchingScope) {
			const registration = this.#registrations.get(matchingScope);
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
		const installations = Array.from(this.#registrations.values()).map(
			async (registration) => {
				await registration.install();
				await registration.activate();
			},
		);

		// Wrap with timeout to prevent hangs if any registration hangs
		await promiseWithTimeout(
			Promise.all(installations),
			65000,
			"ServiceWorker installAll timed out after 65s - some registrations failed to install/activate",
		);
	}

	/**
	 * Get list of all scopes
	 */
	getScopes(): string[] {
		return Array.from(this.#registrations.keys());
	}

	startMessages(): void {
		// No-op in server context
	}

	/**
	 * Normalize scope to ensure it starts and ends correctly
	 */
	#normalizeScope(scope: string): string {
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
	#findMatchingScope(pathname: string): string | null {
		const scopes = Array.from(this.#registrations.keys());

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

	// Event handlers required by Web API
	onclick: ((ev: Event) => any) | null;
	onclose: ((ev: Event) => any) | null;
	onerror: ((ev: Event) => any) | null;
	onshow: ((ev: Event) => any) | null;

	static permission: "default" | "denied" | "granted";

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
		this.onclick = null;
		this.onclose = null;
		this.onerror = null;
		this.onshow = null;
	}

	close(): void {
		(self as any).loggers
			.open("platform")
			.warn("Notification.close() not supported in server context");
	}

	static async requestPermission(): Promise<"default" | "denied" | "granted"> {
		return "denied";
	}

	// Events: click, close, error, show
}

// Initialize static property
Notification.permission = "denied";

/**
 * NotificationEvent for notification interactions
 */
export interface NotificationEventInit extends EventInit {
	action?: string;
	notification: Notification;
	reply?: string | null;
}

export class NotificationEvent extends ExtendableEvent {
	readonly action: string;
	readonly notification: Notification;
	readonly reply: string | null;

	constructor(type: string, eventInitDict: NotificationEventInit) {
		super(type, eventInitDict);
		this.action = eventInitDict.action ?? "";
		this.notification = eventInitDict.notification;
		this.reply = eventInitDict.reply ?? null;
	}
}

/**
 * PushEvent for push message handling
 */
export interface PushEventInit extends EventInit {
	data?: PushMessageData | null;
}

export class PushEvent extends ExtendableEvent {
	readonly data: PushMessageData | null;

	constructor(type: string, eventInitDict?: PushEventInit) {
		super(type, eventInitDict);
		this.data = eventInitDict?.data ?? null;
	}
}

/**
 * ShovelPushMessageData - Internal implementation of PushMessageData
 * Note: Standard PushMessageData has no constructor - instances are created internally
 */
export class ShovelPushMessageData implements PushMessageData {
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

	bytes(): Uint8Array<ArrayBuffer> {
		return new Uint8Array(this.arrayBuffer()) as Uint8Array<ArrayBuffer>;
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
export interface SyncEventInit extends EventInit {
	tag: string;
	lastChance?: boolean;
}

export class SyncEvent extends ExtendableEvent {
	readonly tag: string;
	readonly lastChance: boolean;

	constructor(type: string, eventInitDict: SyncEventInit) {
		super(type, eventInitDict);
		this.tag = eventInitDict.tag;
		this.lastChance = eventInitDict.lastChance ?? false;
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

// ============================================================================
// ServiceWorkerGlobals - ServiceWorker Global Scope Implementation
// ============================================================================

export interface ServiceWorkerGlobalsOptions {
	/** ServiceWorker registration instance */
	registration: ServiceWorkerRegistration;
	/** Directory storage (file system access) - REQUIRED */
	directories: DirectoryStorage;
	/** Logger storage (logging access) - REQUIRED */
	loggers: LoggerStorage;
	/** Cache storage (required by ServiceWorkerGlobalScope) - REQUIRED */
	caches: CacheStorage;
	/** Development mode flag */
	isDevelopment?: boolean;
}

/**
 * Base class for all worker global scopes
 * Part of the Web Worker standard - used for worker context detection
 */
export class WorkerGlobalScope {}

/**
 * Global scope for dedicated workers
 * Part of the Web Worker standard - extends WorkerGlobalScope
 */
export class DedicatedWorkerGlobalScope extends WorkerGlobalScope {}

/**
 * ServiceWorkerGlobals - Installs ServiceWorker globals onto globalThis
 *
 * This class holds ServiceWorker API implementations (caches, directories, clients, etc.)
 * and patches them onto globalThis via install(). It maintains the browser invariant
 * that self === globalThis while providing ServiceWorker APIs.
 *
 * Use restore() to revert all patches (useful for testing).
 */
export class ServiceWorkerGlobals implements ServiceWorkerGlobalScope {
	// Self-reference (standard in ServiceWorkerGlobalScope)
	// Type assertion: we provide a compatible subset of WorkerGlobalScope
	readonly self: any;

	// ServiceWorker standard properties
	// Our custom ServiceWorkerRegistration provides core functionality compatible with the Web API
	readonly registration: ServiceWorkerRegistration;

	// Storage APIs
	readonly caches: CacheStorage;
	readonly directories: DirectoryStorage;
	readonly loggers: LoggerStorage;

	// Clients API
	// Our custom Clients implementation provides core functionality compatible with the Web API
	readonly clients: Clients;

	// Shovel-specific development features
	#isDevelopment: boolean;

	// Snapshot of original globals before patching (for restore())
	#originals: Record<PatchedKey, unknown>;

	// Web API required properties
	// Note: Using RequestCookieStore but typing as any for flexibility with global CookieStore type
	// cookieStore is retrieved from AsyncContext for per-request isolation
	get cookieStore(): any {
		return cookieStoreStorage.get();
	}
	readonly serviceWorker: any;

	// WorkerGlobalScope required properties (stubs for server context)
	readonly location: WorkerLocation;
	readonly navigator: WorkerNavigator;
	readonly fonts: FontFaceSet;
	readonly indexedDB: IDBFactory;
	readonly isSecureContext: boolean;
	readonly crossOriginIsolated: boolean;
	readonly origin: string;
	readonly performance: Performance;
	readonly crypto: Crypto;

	// WorkerGlobalScope methods (stubs for server context)
	importScripts(..._urls: (string | URL)[]): void {
		(self as any).loggers
			.open("platform")
			.warn("importScripts() not supported in server context");
	}

	atob(data: string): string {
		return globalThis.atob(data);
	}

	btoa(data: string): string {
		return globalThis.btoa(data);
	}

	clearInterval(id: number): void {
		globalThis.clearInterval(id);
	}

	clearTimeout(id: number): void {
		globalThis.clearTimeout(id);
	}

	createImageBitmap(..._args: any[]): Promise<ImageBitmap> {
		throw new Error(
			"[ServiceWorker] createImageBitmap() not supported in server context",
		);
	}

	fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
		// Determine URL string from input
		const urlString =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.href
					: input.url;

		// Check if relative URL (self-fetch)
		const isRelative = urlString.startsWith("/") || urlString.startsWith("./");

		if (!isRelative) {
			// Absolute URL - use network (original fetch to avoid recursion)
			const originalFetch = this.#originals.fetch as typeof fetch;
			return originalFetch(input, init);
		}

		// Relative URL - route internally through our own fetch handler
		const currentDepth = fetchDepthStorage.get() ?? 0;
		if (currentDepth >= MAX_FETCH_DEPTH) {
			return Promise.reject(
				new Error(`Maximum self-fetch depth (${MAX_FETCH_DEPTH}) exceeded`),
			);
		}

		// Create request with a base URL for the relative path
		// The actual host doesn't matter since we're routing internally
		const request = new Request(new URL(urlString, "http://localhost"), init);

		// Route through our own handler with incremented depth
		return fetchDepthStorage.run(currentDepth + 1, () => {
			return (
				this.registration as ShovelServiceWorkerRegistration
			).handleRequest(request);
		});
	}

	queueMicrotask(callback: VoidFunction): void {
		globalThis.queueMicrotask(callback);
	}

	reportError(e: any): void {
		(self as any).loggers.open("platform").error`reportError: ${e}`;
	}

	setInterval(handler: TimerHandler, timeout?: number, ...args: any[]): number {
		return globalThis.setInterval(handler as any, timeout, ...args) as any;
	}

	setTimeout(handler: TimerHandler, timeout?: number, ...args: any[]): number {
		return globalThis.setTimeout(handler as any, timeout, ...args) as any;
	}

	structuredClone<T>(value: T, options?: StructuredSerializeOptions): T {
		return globalThis.structuredClone(value, options);
	}

	// Event handlers required by ServiceWorkerGlobalScope
	// Use Web API types (not our custom implementations) for event handler signatures
	onactivate:
		| ((this: ServiceWorkerGlobalScope, ev: globalThis.ExtendableEvent) => any)
		| null;
	oncookiechange: ((this: ServiceWorkerGlobalScope, ev: Event) => any) | null;
	onfetch:
		| ((this: ServiceWorkerGlobalScope, ev: globalThis.FetchEvent) => any)
		| null;
	oninstall:
		| ((this: ServiceWorkerGlobalScope, ev: globalThis.ExtendableEvent) => any)
		| null;
	onmessage:
		| ((
				this: ServiceWorkerGlobalScope,
				ev: globalThis.ExtendableMessageEvent,
		  ) => any)
		| null;
	onmessageerror:
		| ((this: ServiceWorkerGlobalScope, ev: MessageEvent) => any)
		| null;
	onnotificationclick:
		| ((
				this: ServiceWorkerGlobalScope,
				ev: globalThis.NotificationEvent,
		  ) => any)
		| null;
	onnotificationclose:
		| ((
				this: ServiceWorkerGlobalScope,
				ev: globalThis.NotificationEvent,
		  ) => any)
		| null;
	onpush:
		| ((this: ServiceWorkerGlobalScope, ev: globalThis.PushEvent) => any)
		| null;
	onpushsubscriptionchange:
		| ((this: ServiceWorkerGlobalScope, ev: Event) => any)
		| null;
	onsync: ((this: ServiceWorkerGlobalScope, ev: SyncEvent) => any) | null;

	// WorkerGlobalScope event handlers (inherited by ServiceWorkerGlobalScope)
	onerror: OnErrorEventHandlerNonNull | null;
	onlanguagechange: ((ev: Event) => any) | null;
	onoffline: ((ev: Event) => any) | null;
	ononline: ((ev: Event) => any) | null;
	onrejectionhandled: ((ev: PromiseRejectionEvent) => any) | null;
	onunhandledrejection: ((ev: PromiseRejectionEvent) => any) | null;

	constructor(options: ServiceWorkerGlobalsOptions) {
		// Save originals for all keys we'll patch (for restore())
		const g = globalThis as Record<string, unknown>;
		this.#originals = {} as Record<PatchedKey, unknown>;
		for (const key of PATCHED_KEYS) {
			this.#originals[key] = g[key];
		}

		this.self = globalThis;
		this.registration = options.registration;
		this.caches = options.caches;
		this.directories = options.directories;
		this.loggers = options.loggers;
		this.#isDevelopment = options.isDevelopment ?? false;

		// Create clients API implementation
		this.clients = this.#createClientsAPI();

		// Initialize Web API properties
		// Note: cookieStore is per-request and retrieved via AsyncLocalStorage getter
		this.serviceWorker = null;
		this.location = {} as WorkerLocation;
		this.navigator = {} as WorkerNavigator;
		this.fonts = {} as FontFaceSet;
		this.indexedDB = {} as IDBFactory;
		this.isSecureContext = true;
		this.crossOriginIsolated = false;
		this.origin = "";
		this.performance = {} as Performance;
		this.crypto = {} as Crypto;

		// Initialize event handlers
		this.onactivate = null;
		this.oncookiechange = null;
		this.onfetch = null;
		this.oninstall = null;
		this.onmessage = null;
		this.onmessageerror = null;
		this.onnotificationclick = null;
		this.onnotificationclose = null;
		this.onpush = null;
		this.onpushsubscriptionchange = null;
		this.onsync = null;
		this.onerror = null;
		this.onlanguagechange = null;
		this.onoffline = null;
		this.ononline = null;
		this.onrejectionhandled = null;
		this.onunhandledrejection = null;
	}

	/**
	 * Standard ServiceWorker skipWaiting() implementation
	 * Allows the ServiceWorker to activate immediately
	 */
	async skipWaiting(): Promise<void> {
		(self as any).loggers.open("platform").info("skipWaiting() called");
		if (!this.#isDevelopment) {
			(self as any).loggers
				.open("platform")
				.info("skipWaiting() - production graceful restart not implemented");
			// In production, this would normally activate the waiting worker
			// For Shovel, production restart logic could be implemented here
		}
	}

	/**
	 * Event target delegation - ServiceWorker events go to registration,
	 * other events (like "message" for worker threads) go to native handler
	 */
	addEventListener(
		type: string,
		listener: EventListenerOrEventListenerObject | null,
		options?: boolean | AddEventListenerOptions,
	): void {
		if (!listener) return;

		if (isServiceWorkerEvent(type)) {
			this.registration.addEventListener(type, listener, options);
		} else {
			// Other events (e.g., "message" for worker threads) go to native
			const original = this.#originals
				.addEventListener as typeof addEventListener;
			if (original) {
				original.call(globalThis, type, listener, options);
			}
		}
	}

	removeEventListener(
		type: string,
		listener: EventListenerOrEventListenerObject | null,
		options?: boolean | EventListenerOptions,
	): void {
		if (!listener) return;

		if (isServiceWorkerEvent(type)) {
			this.registration.removeEventListener(type, listener, options);
		} else {
			const original = this.#originals
				.removeEventListener as typeof removeEventListener;
			if (original) {
				original.call(globalThis, type, listener, options);
			}
		}
	}

	dispatchEvent(event: Event): boolean {
		if (isServiceWorkerEvent(event.type)) {
			return this.registration.dispatchEvent(event);
		}
		// Other events go to native
		const original = this.#originals.dispatchEvent as typeof dispatchEvent;
		if (original) {
			return original.call(globalThis, event);
		}
		return false;
	}

	/**
	 * Create Clients API implementation
	 * Note: HTTP requests are stateless, so most client operations are no-ops
	 */
	#createClientsAPI(): Clients {
		return new ShovelClients();
	}

	/**
	 * Install this scope as the global scope
	 * Patches globalThis with ServiceWorker globals while maintaining self === globalThis
	 */
	install(): void {
		const g = globalThis as Record<string, unknown>;

		// Install standard Worker global scope constructors for detection
		// This allows standard detection: typeof WorkerGlobalScope !== 'undefined'
		g.WorkerGlobalScope = WorkerGlobalScope;
		g.DedicatedWorkerGlobalScope = DedicatedWorkerGlobalScope;

		// Ensure self === globalThis (Node.js workers don't have self by default)
		// This maintains browser parity where self and globalThis are the same object
		if (typeof g.self === "undefined") {
			g.self = globalThis;
		}

		// Event delegation to registration
		g.addEventListener = this.addEventListener.bind(this);
		g.removeEventListener = this.removeEventListener.bind(this);
		g.dispatchEvent = this.dispatchEvent.bind(this);

		// Storage APIs
		g.caches = this.caches;
		g.directories = this.directories;
		g.loggers = this.loggers;

		// ServiceWorker APIs
		g.registration = this.registration;
		g.skipWaiting = this.skipWaiting.bind(this);
		g.clients = this.clients;

		// Override global fetch to use internal routing for relative URLs
		// This ensures cache.add(), libraries, etc. all benefit from self-fetch
		g.fetch = this.fetch.bind(this);

		// Install cookieStore getter (per-request via AsyncContext)
		Object.defineProperty(g, "cookieStore", {
			get: () => cookieStoreStorage.get(),
			configurable: true,
		});
	}

	/**
	 * Restore original globals (for testing)
	 * Reverts all patched globals to their original values
	 */
	restore(): void {
		const g = globalThis as Record<string, unknown>;
		for (const key of PATCHED_KEYS) {
			const original = this.#originals[key];
			if (original === undefined) {
				delete g[key];
			} else {
				g[key] = original;
			}
		}
	}
}

// ============================================================================
// Logging Configuration
// ============================================================================

/** Log level for filtering */
export type LogLevel = "debug" | "info" | "warning" | "error";

/** Sink configuration */
export interface SinkConfig {
	provider: string;
	/** Pre-imported factory function (from build-time code generation) */
	factory?: (options: Record<string, unknown>) => unknown;
	/** Provider-specific options (path, maxSize, etc.) */
	[key: string]: any;
}

/** Per-category logging configuration */
export interface CategoryLoggingConfig {
	level?: LogLevel;
	sinks?: SinkConfig[];
}

export interface LoggingConfig {
	/** Default log level. Defaults to "info" */
	level?: LogLevel;
	/** Default sinks. Defaults to console */
	sinks?: SinkConfig[];
	/** Per-category config (inherits from top-level, can override level and/or sinks) */
	categories?: Record<string, CategoryLoggingConfig>;
}

/** Processed logging config with all defaults applied */
export interface ProcessedLoggingConfig {
	level: LogLevel;
	sinks: SinkConfig[];
	categories: Record<string, CategoryLoggingConfig>;
}

// ============================================================================
// Shovel Configuration Types
// ============================================================================

/** Cache provider configuration */
export interface CacheConfig {
	provider?: string;
	[key: string]: unknown;
}

/** Directory (filesystem) provider configuration */
export interface DirectoryConfig {
	provider?: string;
	path?: string;
	[key: string]: unknown;
}

/** Shovel application configuration (from shovel.json) */
export interface ShovelConfig {
	port?: number;
	host?: string;
	workers?: number;
	platform?: string;
	logging?: LoggingConfig;
	caches?: Record<string, CacheConfig>;
	directories?: Record<string, DirectoryConfig>;
}

// ============================================================================
// Logging Implementation
// ============================================================================

/** All Shovel package categories for logging
 * TODO: Clean up this list to match actual packages */
const SHOVEL_CATEGORIES = [
	"cli",
	"build",
	"platform",
	"watcher",
	"worker",
	"single-threaded",
	"assets",
	"platform-node",
	"platform-bun",
	"platform-cloudflare",
	"cache",
	"cache-redis",
	"router",
] as const;

/** Built-in sink provider aliases */
const BUILTIN_SINK_PROVIDERS: Record<
	string,
	{module: string; factory: string}
> = {
	console: {module: "@logtape/logtape", factory: "getConsoleSink"},
	file: {module: "@logtape/file", factory: "getFileSink"},
	rotating: {module: "@logtape/file", factory: "getRotatingFileSink"},
	"stream-file": {module: "@logtape/file", factory: "getStreamFileSink"},
	otel: {module: "@logtape/otel", factory: "getOpenTelemetrySink"},
	sentry: {module: "@logtape/sentry", factory: "getSentrySink"},
	syslog: {module: "@logtape/syslog", factory: "getSyslogSink"},
	cloudwatch: {
		module: "@logtape/cloudwatch-logs",
		factory: "getCloudWatchLogsSink",
	},
};

/**
 * Create a sink from config.
 * Supports built-in providers (console, file, rotating, etc.) and custom modules.
 *
 * If config.factory is provided (pre-imported at build time), uses that directly.
 * Otherwise falls back to dynamic import (dev mode only - won't work in bundled builds).
 *
 * Note: File paths in sinkOptions should already be absolute.
 * The CLI/build process is responsible for resolving relative paths.
 */
async function createSink(config: SinkConfig): Promise<any> {
	const {provider, factory: preImportedFactory, ...sinkOptions} = config;

	// Use pre-imported factory if available (from generateConfigModule)
	if (preImportedFactory) {
		return preImportedFactory(sinkOptions);
	}

	// Fallback to dynamic import (dev mode only)
	// This won't work in bundled builds - esbuild can't resolve dynamic imports
	const builtin = BUILTIN_SINK_PROVIDERS[provider];
	const modulePath = builtin?.module || provider;
	const factoryName = builtin?.factory || "default";

	const module = await import(modulePath);
	const factory = module[factoryName] || module.default;

	if (!factory) {
		throw new Error(
			`Sink module "${modulePath}" has no export "${factoryName}"`,
		);
	}

	// Pass options to factory (path, maxSize, etc.)
	return factory(sinkOptions);
}

/**
 * Configure LogTape logging based on Shovel config.
 * Call this in both main thread and workers.
 *
 * @param loggingConfig - The logging configuration (sinks defaults to console)
 * @param options - Additional options
 * @param options.reset - Whether to reset existing LogTape config (default: true)
 */
export async function configureLogging(
	loggingConfig: LoggingConfig,
	options: {reset?: boolean} = {},
): Promise<void> {
	const level = loggingConfig.level || "info";
	const defaultSinkConfigs = loggingConfig.sinks || [{provider: "console"}];
	const categories = loggingConfig.categories || {};
	const reset = options.reset !== false;

	// Create all unique sinks (default + category-specific)
	// Use Map keyed by JSON string for O(1) deduplication instead of O(n) iteration
	const sinkByKey = new Map<string, {config: SinkConfig; name: string}>();

	// Add default sinks
	for (const config of defaultSinkConfigs) {
		const key = JSON.stringify(config);
		if (!sinkByKey.has(key)) {
			sinkByKey.set(key, {config, name: `sink_${sinkByKey.size}`});
		}
	}

	// Add category-specific sinks
	for (const [_, categoryConfig] of Object.entries(categories)) {
		if (categoryConfig.sinks) {
			for (const config of categoryConfig.sinks) {
				const key = JSON.stringify(config);
				if (!sinkByKey.has(key)) {
					sinkByKey.set(key, {config, name: `sink_${sinkByKey.size}`});
				}
			}
		}
	}

	// Create sink instances
	const sinks: Record<string, any> = {};
	for (const {config, name} of sinkByKey.values()) {
		sinks[name] = await createSink(config);
	}

	// Get sink names for a given array of sink configs (O(1) lookup per config)
	const getSinkNames = (configs: SinkConfig[]): string[] => {
		return configs
			.map((config) => sinkByKey.get(JSON.stringify(config))?.name ?? "")
			.filter(Boolean);
	};

	// Default sink names
	const defaultSinkNames = getSinkNames(defaultSinkConfigs);

	// Build logger configs for each Shovel category
	const loggers: Array<{
		category: string[];
		level: LogTapeLevel;
		sinks: string[];
	}> = SHOVEL_CATEGORIES.map((category) => {
		const categoryConfig = categories[category];
		const categoryLevel = categoryConfig?.level || level;
		const categorySinks = categoryConfig?.sinks
			? getSinkNames(categoryConfig.sinks)
			: defaultSinkNames;

		return {
			category: [category],
			level: categoryLevel as LogTapeLevel,
			sinks: categorySinks,
		};
	});

	// Add meta logger config (suppress info messages about LogTape itself)
	loggers.push({
		category: ["logtape", "meta"],
		level: "warning",
		sinks: [],
	});

	await configure({
		reset,
		sinks,
		loggers,
	});
}
