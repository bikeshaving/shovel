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
import {getLogger, getConsoleSink} from "@logtape/logtape";
import {CustomDirectoryStorage} from "@b9g/filesystem";
import {CustomCacheStorage, Cache} from "@b9g/cache";
import {handleCacheResponse, PostMessageCache} from "@b9g/cache/postmessage";

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
	 * Get a logger by category path (sync)
	 * @example const logger = self.loggers.get("app")
	 * @example const logger = self.loggers.get("app", "db")
	 */
	get(...categories: string[]): Logger;
}

/**
 * Factory function type for creating loggers (sync).
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

	get(...categories: string[]): Logger {
		return this.#factory(...categories);
	}
}

// ============================================================================
// Database Storage API
// ============================================================================

// Import Database class from @b9g/zen
import {Database} from "@b9g/zen";

/**
 * Database configuration from shovel.json.
 * Follows the same module/export pattern as directories and caches.
 */
export interface DatabaseConfig {
	/** Module path to import (e.g., "@b9g/zen/bun") - optional if DriverClass provided */
	module?: string;
	/** Named export to use (defaults to "default") */
	export?: string;
	/** Pre-imported driver class (from generated config) - optional if module provided */
	DriverClass?: new (url: string, options?: any) => any;
	/** Database connection URL */
	url?: string;
	/** Additional driver-specific options */
	[key: string]: unknown;
}

/**
 * Upgrade event passed to onUpgrade callback during database.open().
 */
export interface DatabaseUpgradeEvent {
	/** The database being upgraded */
	db: Database;
	/** Previous database version (0 if new) */
	oldVersion: number;
	/** Target version being opened */
	newVersion: number;
	/** Register a promise that must complete before open() resolves */
	waitUntil(promise: Promise<unknown>): void;
}

/**
 * DatabaseStorage interface - provides access to named database instances.
 *
 * @example
 * ```typescript
 * // In activate handler - open database with migrations
 * self.addEventListener("activate", (event) => {
 *   event.waitUntil(
 *     self.databases.open("main", 2, (e) => {
 *       e.waitUntil(runMigrations(e));
 *     })
 *   );
 * });
 *
 * // In fetch handler - get the opened database (sync)
 * self.addEventListener("fetch", (event) => {
 *   const db = self.databases.get("main");
 *   const users = await db.all(User)`WHERE active = ${true}`;
 * });
 * ```
 */
export interface DatabaseStorage {
	/**
	 * Open a database at a specific version.
	 * Imports the driver, creates the Database, runs migrations if needed.
	 * Caches the opened instance for later get() calls.
	 */
	open(
		name: string,
		version: number,
		onUpgrade?: (event: DatabaseUpgradeEvent) => void,
	): Promise<Database>;

	/**
	 * Get an already-opened database.
	 * Throws if the database hasn't been opened yet.
	 * This is synchronous for fast access in request handlers.
	 */
	get(name: string): Database;

	/** Close a specific database */
	close(name: string): Promise<void>;

	/** Close all databases */
	closeAll(): Promise<void>;
}

/**
 * Factory function type for creating database drivers.
 * Returns the Database instance and a close function.
 */
export type DatabaseFactory = (
	name: string,
) => Promise<{db: Database; close: () => Promise<void>}>;

/**
 * CustomDatabaseStorage implements DatabaseStorage.
 */
export class CustomDatabaseStorage implements DatabaseStorage {
	#factory: DatabaseFactory;
	#databases: Map<string, Database>;
	#closers: Map<string, () => Promise<void>>;
	#pending: Map<string, Promise<Database>>;

	constructor(factory: DatabaseFactory) {
		this.#factory = factory;
		this.#databases = new Map();
		this.#closers = new Map();
		this.#pending = new Map();
	}

	async open(
		name: string,
		version: number,
		onUpgrade?: (event: DatabaseUpgradeEvent) => void,
	): Promise<Database> {
		// Return cached instance if already opened
		const existing = this.#databases.get(name);
		if (existing) {
			return existing;
		}

		// Return in-flight promise if another caller is already opening this database
		const pending = this.#pending.get(name);
		if (pending) {
			return pending;
		}

		// Create and open the database
		const promise = (async () => {
			const {db, close} = await this.#factory(name);

			// Register upgrade handler if provided
			if (onUpgrade) {
				db.addEventListener("upgradeneeded", (e: Event) => {
					const event = e as Event & {
						oldVersion: number;
						newVersion: number;
						waitUntil: (p: Promise<unknown>) => void;
					};
					onUpgrade({
						db,
						oldVersion: event.oldVersion,
						newVersion: event.newVersion,
						waitUntil: (p) => event.waitUntil(p),
					});
				});
			}

			// Open at the specified version (triggers migrations if needed)
			// If open fails, close the driver to avoid leaking connections
			try {
				await db.open(version);
			} catch (err) {
				await close();
				throw err;
			}

			// Cache the opened database
			this.#databases.set(name, db);
			this.#closers.set(name, close);

			return db;
		})().finally(() => {
			// Always clear pending, whether success or failure
			this.#pending.delete(name);
		});

		this.#pending.set(name, promise);
		return promise;
	}

	get(name: string): Database {
		const db = this.#databases.get(name);
		if (!db) {
			throw new Error(
				`Database "${name}" has not been opened. ` +
					`Call self.databases.open("${name}", version) in your activate handler first.`,
			);
		}
		return db;
	}

	async close(name: string): Promise<void> {
		// Wait for any pending open to complete before closing
		const pending = this.#pending.get(name);
		if (pending) {
			try {
				await pending;
			} catch (_err) {
				// Open failed, nothing to close - error was already thrown to open() caller
				return;
			}
		}

		const closer = this.#closers.get(name);
		if (closer) {
			await closer();
			this.#databases.delete(name);
			this.#closers.delete(name);
		}
	}

	async closeAll(): Promise<void> {
		// Wait for any pending opens to complete first
		if (this.#pending.size > 0) {
			await Promise.allSettled(this.#pending.values());
		}

		// Now close all databases
		const promises = Array.from(this.#databases.keys()).map((name) =>
			this.close(name),
		);
		await Promise.allSettled(promises);
	}
}

/**
 * Create a DatabaseFactory from declarative config.
 *
 * This dynamically imports the driver module at runtime, following
 * the same pattern as createDirectoryFactory and createCacheFactory.
 *
 * @param configs - The databases config from shovel.json
 * @returns An async factory function that creates databases by name
 *
 * @example
 * ```typescript
 * // In platform adapter:
 * const factory = createDatabaseFactory(config.databases);
 * return new CustomDatabaseStorage(factory);
 * ```
 */
export function createDatabaseFactory(
	configs: Record<string, DatabaseConfig>,
): DatabaseFactory {
	return async (name: string) => {
		const config = configs[name];
		if (!config) {
			throw new Error(
				`Database "${name}" is not configured. Available databases: ${Object.keys(configs).join(", ") || "(none)"}`,
			);
		}

		// Strip metadata fields that shouldn't be passed to driver constructor

		const {
			DriverClass,
			url,
			module: _module,
			export: _export,
			...driverOptions
		} = config;

		if (!DriverClass) {
			throw new Error(
				`Database "${name}" has no DriverClass. Ensure the database module is configured in shovel.json.`,
			);
		}

		if (!url) {
			throw new Error(
				`Database "${name}" has no url. Ensure the database URL is configured.`,
			);
		}

		const driver = new DriverClass(url, driverOptions);
		const db = new Database(driver);

		return {
			db,
			close: async () => {
				await driver.close();
			},
		};
	};
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
	"databases",
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
 * Shovel's ExtendableEvent implementation following ServiceWorker spec.
 *
 * Standard constructor: new ShovelExtendableEvent(type) or new ShovelExtendableEvent(type, options)
 *
 * Per spec, waitUntil() can be called:
 * 1. Synchronously during event dispatch, OR
 * 2. Asynchronously if there are pending promises from prior waitUntil/respondWith calls
 *
 * See: https://github.com/w3c/ServiceWorker/issues/771
 */
export class ShovelExtendableEvent extends Event implements ExtendableEvent {
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
 * Options for ShovelFetchEvent constructor (non-standard Shovel extension)
 */
export interface ShovelFetchEventInit extends EventInit {
	/**
	 * Platform-provided callback for extending request lifetime.
	 * Called automatically when waitUntil() is invoked.
	 * (e.g., Cloudflare's ctx.waitUntil)
	 */
	platformWaitUntil?: (promise: Promise<unknown>) => void;
}

/**
 * Shovel's FetchEvent implementation.
 *
 * Platforms can subclass this to add platform-specific properties (e.g., env bindings).
 * The platformWaitUntil hook allows platforms to extend request lifetime properly.
 */
export class ShovelFetchEvent
	extends ShovelExtendableEvent
	implements FetchEvent
{
	readonly request: Request;
	readonly cookieStore: RequestCookieStore;
	readonly clientId: string;
	readonly handled: Promise<undefined>;
	readonly preloadResponse: Promise<any>;
	readonly resultingClientId: string;
	#responsePromise: Promise<Response> | null;
	#responded: boolean;
	#platformWaitUntil?: (promise: Promise<unknown>) => void;

	constructor(request: Request, options?: ShovelFetchEventInit) {
		super("fetch", options);
		this.request = request;
		this.cookieStore = new RequestCookieStore(request);
		this.clientId = "";
		this.handled = Promise.resolve(undefined);
		this.preloadResponse = Promise.resolve(undefined);
		this.resultingClientId = "";
		this.#responsePromise = null;
		this.#responded = false;
		this.#platformWaitUntil = options?.platformWaitUntil;
	}

	override waitUntil(promise: Promise<any>): void {
		// Call platform hook first (e.g., Cloudflare ctx.waitUntil)
		if (this.#platformWaitUntil) {
			this.#platformWaitUntil(promise);
		}
		// Then call parent implementation for internal tracking
		super.waitUntil(promise);
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

	/** The URL of the request (convenience property) */
	get url(): string {
		return this.request.url;
	}
}

/**
 * Shovel's InstallEvent implementation
 */
export class ShovelInstallEvent extends ShovelExtendableEvent {
	constructor(eventInitDict?: EventInit) {
		super("install", eventInitDict);
	}
}

/**
 * Shovel's ActivateEvent implementation
 */
export class ShovelActivateEvent extends ShovelExtendableEvent {
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

export class ExtendableMessageEvent extends ShovelExtendableEvent {
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
export class ShovelNavigationPreloadManager implements NavigationPreloadManager {
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
			const event = new ShovelInstallEvent();

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
			const event = new ShovelActivateEvent();

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
	 *
	 * Platforms create a ShovelFetchEvent (or subclass) with platform-specific
	 * properties and hooks, then pass it to this method for dispatching.
	 *
	 * @param event - The fetch event to handle (created by platform adapter)
	 */
	async handleRequest(event: ShovelFetchEvent): Promise<Response> {
		if (this._serviceWorker.state !== "activated") {
			throw new Error("ServiceWorker not activated");
		}

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

			// Note: waitUntil promises are already handled via platformWaitUntil hook
			// in the event constructor, so no additional handling needed here.

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
				const event = new ShovelFetchEvent(request);
				return await registration.handleRequest(event);
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

export class NotificationEvent extends ShovelExtendableEvent {
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

export class PushEvent extends ShovelExtendableEvent {
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

export class SyncEvent extends ShovelExtendableEvent {
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
	/** Database storage - OPTIONAL */
	databases?: DatabaseStorage;
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
	readonly databases?: DatabaseStorage;
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
			const event = new ShovelFetchEvent(request);
			return (
				this.registration as ShovelServiceWorkerRegistration
			).handleRequest(event);
		});
	}

	queueMicrotask(callback: VoidFunction): void {
		globalThis.queueMicrotask(callback);
	}

	reportError(e: any): void {
		getLogger(["shovel", "platform"]).error`reportError: ${e}`;
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
		this.databases = options.databases;
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
		getLogger(["shovel", "platform"]).info("skipWaiting() called");
		if (!this.#isDevelopment) {
			getLogger(["shovel", "platform"]).info(
				"skipWaiting() - production graceful restart not implemented",
			);
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
		if (this.databases) {
			g.databases = this.databases;
		}
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
// Worker Runtime Initialization
// ============================================================================

/** Cache provider configuration */
export interface CacheConfig {
	/** Module path to import (e.g., "@b9g/cache/memory") - optional if CacheClass provided */
	module?: string;
	/** Named export to use (defaults to "default") */
	export?: string;
	/** Pre-imported cache class (from generated config) - optional if module provided */
	CacheClass?: new (name: string, options?: any) => Cache;
	/** Additional options passed to the constructor */
	[key: string]: unknown;
}

/** Directory (filesystem) provider configuration */
export interface DirectoryConfig {
	/** Module path to import (e.g., "@b9g/filesystem/memory") - optional if DirectoryClass provided */
	module?: string;
	/** Named export to use (defaults to "default") */
	export?: string;
	/** Pre-imported directory class (from generated config) - optional if module provided */
	DirectoryClass?: new (
		name: string,
		options?: any,
	) => FileSystemDirectoryHandle;
	/** Custom path for filesystem directories */
	path?: string;
	/** Additional options passed to the constructor */
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
	databases?: Record<string, DatabaseConfig>;
}

// ============================================================================
// Directory Factory
// ============================================================================

/**
 * Creates a directory factory function for CustomDirectoryStorage.
 *
 * Configs must have DirectoryClass pre-imported (from generated config module).
 * Paths are expected to be already resolved at build time by the path syntax parser.
 * Runtime paths (like [tmpdir]) are evaluated as expressions in the generated config.
 */
export function createDirectoryFactory(
	configs: Record<string, DirectoryConfig>,
) {
	return async (name: string): Promise<FileSystemDirectoryHandle> => {
		const config = configs[name];
		if (!config) {
			throw new Error(
				`Directory "${name}" is not configured. Available directories: ${Object.keys(configs).join(", ") || "(none)"}`,
			);
		}

		// Strip metadata fields that shouldn't be passed to directory constructor
		const {
			DirectoryClass,
			module: _module,
			export: _export,
			...dirOptions
		} = config;
		if (!DirectoryClass) {
			throw new Error(
				`Directory "${name}" has no DirectoryClass. Ensure the directory module is configured.`,
			);
		}

		return new DirectoryClass(name, dirOptions);
	};
}

// ============================================================================
// Cache Factory
// ============================================================================

export interface CacheFactoryOptions {
	/** Cache configurations with pre-imported CacheClass (from generated config module) */
	configs: Record<string, CacheConfig>;
	/** If true, use PostMessageCache (for workers communicating with main thread) */
	usePostMessage?: boolean;
}

/**
 * Creates a cache factory function for CustomCacheStorage.
 * Configs must have CacheClass pre-imported (from generated config module).
 */
export function createCacheFactory(options: CacheFactoryOptions) {
	const {configs, usePostMessage = false} = options;

	return async (name: string): Promise<Cache> => {
		// For PostMessageCache in workers (forwards to main thread)
		if (usePostMessage) {
			return new PostMessageCache(name);
		}

		const config = configs[name];
		if (!config) {
			throw new Error(
				`Cache "${name}" is not configured. Available caches: ${Object.keys(configs).join(", ") || "(none)"}`,
			);
		}

		// Strip metadata fields that shouldn't be passed to cache constructor

		const {
			CacheClass,
			module: _module,
			export: _export,
			...cacheOptions
		} = config;
		if (!CacheClass) {
			throw new Error(
				`Cache "${name}" has no CacheClass. Ensure the cache module is configured.`,
			);
		}

		return new CacheClass(name, cacheOptions);
	};
}

// ============================================================================
// Worker Runtime API
// ============================================================================

/**
 * Worker message types for the message loop
 */
export interface WorkerRequestMessage {
	type: "request";
	request: {
		url: string;
		method: string;
		headers: Record<string, string>;
		body?: ArrayBuffer | null;
	};
	requestID: number;
}

export interface WorkerResponseMessage {
	type: "response";
	response: {
		status: number;
		statusText: string;
		headers: Record<string, string>;
		body: ArrayBuffer;
	};
	requestID: number;
}

export interface WorkerErrorMessage {
	type: "error";
	error: string;
	stack?: string;
	requestID?: number;
}

/**
 * Options for initializing the worker runtime
 */
export interface InitWorkerRuntimeOptions {
	/** Shovel configuration (from shovel:config) */
	config: ShovelConfig;
}

/**
 * Result from initializing the worker runtime
 */
export interface InitWorkerRuntimeResult {
	/** The ServiceWorker registration instance */
	registration: ShovelServiceWorkerRegistration;
	/** The installed ServiceWorkerGlobals scope */
	scope: ServiceWorkerGlobals;
	/** Cache storage instance */
	caches: CustomCacheStorage;
	/** Directory storage instance */
	directories: CustomDirectoryStorage;
	/** Database storage instance (if configured) */
	databases?: CustomDatabaseStorage;
	/** Logger storage instance */
	loggers: CustomLoggerStorage;
}

/**
 * Initialize the worker runtime environment.
 * Sets up ServiceWorkerGlobals, caches, directories, and logging.
 *
 * This should be called at the top of a worker entry point before importing user code.
 *
 * @example
 * ```typescript
 * import {config} from "shovel:config";
 * import {initWorkerRuntime, startWorkerMessageLoop} from "@b9g/platform/runtime";
 *
 * const {registration} = await initWorkerRuntime({config});
 *
 * // Import user code (registers event handlers)
 * import "./server.js";
 *
 * // Run lifecycle and start message loop
 * await registration.install();
 * await registration.activate();
 * startWorkerMessageLoop(registration);
 * ```
 */
export async function initWorkerRuntime(
	options: InitWorkerRuntimeOptions,
): Promise<InitWorkerRuntimeResult> {
	const {config} = options;
	const runtimeLogger = getLogger(["shovel", "platform"]);

	// Configure logging if specified
	if (config?.logging) {
		await configureLogging(config.logging);
	}

	runtimeLogger.debug("Initializing worker runtime");

	// Create cache storage with PostMessage support for worker coordination
	const caches = new CustomCacheStorage(
		createCacheFactory({
			configs: config?.caches ?? {},
			usePostMessage: true,
		}),
	);

	// Create directory storage - paths are already resolved at build time
	const directories = new CustomDirectoryStorage(
		createDirectoryFactory(config?.directories ?? {}),
	);

	// Create database storage if configured
	let databases: CustomDatabaseStorage | undefined;
	if (config?.databases && Object.keys(config.databases).length > 0) {
		const factory = createDatabaseFactory(config.databases);
		databases = new CustomDatabaseStorage(factory);
	}

	// Create logger storage
	const loggers = new CustomLoggerStorage((...categories) =>
		getLogger(categories),
	);

	// Create registration and scope
	const registration = new ShovelServiceWorkerRegistration();
	const scope = new ServiceWorkerGlobals({
		registration,
		caches,
		directories,
		databases,
		loggers,
	});

	// Install ServiceWorker globals
	scope.install();

	runtimeLogger.debug("Worker runtime initialized");

	return {registration, scope, caches, directories, databases, loggers};
}

/**
 * Options for the worker message loop
 */
export interface WorkerMessageLoopOptions {
	registration: ShovelServiceWorkerRegistration;
	databases?: CustomDatabaseStorage;
	caches?: CacheStorage;
}

/**
 * Start the worker message loop for handling requests.
 * This function sets up message handling for request/response communication
 * with the main thread via postMessage.
 *
 * @param options - The registration and resources to manage
 */
export function startWorkerMessageLoop(
	options: ShovelServiceWorkerRegistration | WorkerMessageLoopOptions,
): void {
	// Support both old signature (just registration) and new signature (options object)
	const registration =
		options instanceof ShovelServiceWorkerRegistration
			? options
			: options.registration;
	const databases =
		options instanceof ShovelServiceWorkerRegistration
			? undefined
			: options.databases;

	const messageLogger = getLogger(["shovel", "platform"]);
	const workerId = Math.random().toString(36).substring(2, 8);

	/**
	 * Send a message to the main thread
	 */
	function sendMessage(message: any, transfer?: Transferable[]): void {
		if (transfer && transfer.length > 0) {
			postMessage(message, transfer);
		} else {
			postMessage(message);
		}
	}

	/**
	 * Handle a fetch request
	 */
	async function handleFetchRequest(
		message: WorkerRequestMessage,
	): Promise<void> {
		try {
			const request = new Request(message.request.url, {
				method: message.request.method,
				headers: message.request.headers,
				body: message.request.body,
			});

			const event = new ShovelFetchEvent(request);
			const response = await registration.handleRequest(event);

			// Use arrayBuffer for zero-copy transfer
			const body = await response.arrayBuffer();

			// Ensure Content-Type is preserved
			const headers = Object.fromEntries(response.headers.entries());
			if (!headers["Content-Type"] && !headers["content-type"]) {
				headers["Content-Type"] = "text/plain; charset=utf-8";
			}

			const responseMsg: WorkerResponseMessage = {
				type: "response",
				response: {
					status: response.status,
					statusText: response.statusText,
					headers,
					body,
				},
				requestID: message.requestID,
			};

			// Transfer the ArrayBuffer (zero-copy)
			sendMessage(responseMsg, [body]);
		} catch (error) {
			messageLogger.error(`[Worker-${workerId}] Request failed: {error}`, {
				error,
			});
			const errorMsg: WorkerErrorMessage = {
				type: "error",
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				requestID: message.requestID,
			};
			sendMessage(errorMsg);
		}
	}

	/**
	 * Handle incoming messages from main thread
	 */
	function handleMessage(event: MessageEvent): void {
		const message = event.data;

		// Forward cache responses directly to PostMessageCache handler
		if (message?.type === "cache:response" || message?.type === "cache:error") {
			messageLogger.debug(`[Worker-${workerId}] Forwarding cache message`, {
				type: message.type,
				requestID: message.requestID,
			});
			handleCacheResponse(message);
			return;
		}

		// Handle request messages
		if (message?.type === "request") {
			handleFetchRequest(message as WorkerRequestMessage).catch((error) => {
				messageLogger.error(`[Worker-${workerId}] Unhandled error: {error}`, {
					error,
				});
			});
			return;
		}

		// Handle shutdown message - close all resources before termination
		if (message?.type === "shutdown") {
			messageLogger.debug(`[Worker-${workerId}] Received shutdown signal`);
			(async () => {
				try {
					// Close all databases
					if (databases) {
						await databases.closeAll();
						messageLogger.debug(`[Worker-${workerId}] Databases closed`);
					}
					// Signal that shutdown is complete
					sendMessage({type: "shutdown-complete"});
					messageLogger.debug(`[Worker-${workerId}] Shutdown complete`);
				} catch (error) {
					messageLogger.error(`[Worker-${workerId}] Shutdown error: {error}`, {
						error,
					});
					// Still signal completion so main thread doesn't hang
					sendMessage({type: "shutdown-complete"});
				}
			})();
			return;
		}

		// Log unknown message types
		if (message?.type) {
			messageLogger.debug(`[Worker-${workerId}] Unknown message type`, {
				type: message.type,
			});
		}
	}

	// Set up message handling via addEventListener
	// ServiceWorkerGlobals delegates non-ServiceWorker events (like "message") to the native handler
	self.addEventListener("message", handleMessage);

	// Signal that the worker is ready
	sendMessage({type: "ready"});
	messageLogger.debug(`[Worker-${workerId}] Message loop started`);
}

// ============================================================================
// Logging Configuration
// ============================================================================

/** Log level for filtering */
export type LogLevel = "debug" | "info" | "warning" | "error";

/** Sink configuration */
export interface SinkConfig {
	/** Module path to import (e.g., "@logtape/logtape") - optional if factory provided */
	module?: string;
	/** Named export to use (defaults to "default") */
	export?: string;
	/** Pre-imported factory function (from build-time code generation) - optional if module provided */
	factory?: (...args: any[]) => unknown;
	/** Additional options passed to the factory (path, maxSize, etc.) */
	[key: string]: unknown;
}

/** Logger configuration - matches LogTape's logger config structure */
export interface LoggerConfig {
	/** Category as string or array for hierarchy. e.g. "myapp" or ["myapp", "db"] */
	category: string | string[];
	/** Log level for this category. Inherits from parent if not specified. */
	level?: LogLevel;
	/** Sink names to add. Inherits from parent by default. */
	sinks?: string[];
	/** Set to "override" to replace parent sinks instead of inherit */
	parentSinks?: "override";
}

export interface LoggingConfig {
	/** Named sinks. "console" is always available implicitly. */
	sinks?: Record<string, SinkConfig>;
	/** Logger configurations. Shovel provides defaults for ["shovel", ...] categories. */
	loggers?: LoggerConfig[];
}

/** Processed logging config with all defaults applied */
export interface ProcessedLoggingConfig {
	sinks: Record<string, SinkConfig>;
	loggers: LoggerConfig[];
}

// ============================================================================
// Logging Implementation
// ============================================================================

/** Default Shovel loggers - provides logging for internal categories */
const SHOVEL_DEFAULT_LOGGERS: LoggerConfig[] = [
	{category: ["shovel"], level: "info", sinks: ["console"]},
	{category: ["logtape", "meta"], level: "warning", sinks: ["console"]},
];

/**
 * Create a sink from config.
 *
 * Note: File paths in sinkOptions should already be absolute.
 * The CLI/build process is responsible for resolving relative paths.
 */
async function createSink(config: SinkConfig): Promise<any> {
	const {
		factory,
		provider: _provider, // Exclude provider from options passed to factory
		path, // Extract path for file-based sinks
		...sinkOptions
	} = config;

	if (!factory) {
		throw new Error(
			`Sink has no factory. Ensure the sink module is configured in shovel.json.`,
		);
	}

	// File-based sinks (getFileSink, getRotatingFileSink) expect (path, options)
	// Other sinks (getConsoleSink, getOpenTelemetrySink, etc.) expect (options) or no args
	if (path !== undefined) {
		return factory(path, sinkOptions);
	} else if (Object.keys(sinkOptions).length > 0) {
		return factory(sinkOptions);
	} else {
		return factory();
	}
}

/**
 * Normalize category to array format
 */
function normalizeCategory(category: string | string[]): string[] {
	return typeof category === "string" ? [category] : category;
}

/**
 * Configure LogTape logging based on Shovel config.
 * Call this in both main thread and workers.
 *
 * Uses LogTape-aligned config structure:
 * - Named sinks (console is implicit)
 * - Loggers array with category hierarchy support
 * - Shovel provides default loggers for ["shovel", ...] categories
 *
 * @param loggingConfig - The logging configuration
 */
export async function configureLogging(
	loggingConfig: LoggingConfig,
): Promise<void> {
	const userSinks = loggingConfig.sinks || {};
	const userLoggers = loggingConfig.loggers || [];

	// Create sink instances
	// Console sink is always available implicitly - use statically imported factory
	const sinks: Record<string, any> = {
		console: getConsoleSink(),
	};

	// Add user-defined sinks
	for (const [name, config] of Object.entries(userSinks)) {
		sinks[name] = await createSink(config);
	}

	// Merge Shovel default loggers with user loggers
	// User loggers can override Shovel defaults by specifying same category
	const userCategoryKeys = new Set(
		userLoggers.map((l) => JSON.stringify(normalizeCategory(l.category))),
	);

	const mergedLoggers: LoggerConfig[] = [
		// Shovel defaults (unless overridden by user)
		...SHOVEL_DEFAULT_LOGGERS.filter(
			(l) =>
				!userCategoryKeys.has(JSON.stringify(normalizeCategory(l.category))),
		),
		// User loggers
		...userLoggers,
	];

	// Convert to LogTape format
	const loggers = mergedLoggers.map((loggerConfig) => {
		const result: {
			category: string[];
			lowestLevel?: LogTapeLevel;
			sinks?: string[];
			parentSinks?: "override";
		} = {
			category: normalizeCategory(loggerConfig.category),
		};

		if (loggerConfig.level) {
			result.lowestLevel = loggerConfig.level as LogTapeLevel;
		}
		// Default to console sink if no sinks specified
		// This ensures user loggers that override defaults still output somewhere
		result.sinks = loggerConfig.sinks ?? ["console"];
		if (loggerConfig.parentSinks) {
			result.parentSinks = loggerConfig.parentSinks;
		}

		return result;
	});

	await configure({
		reset: true,
		sinks,
		loggers,
	});
}
