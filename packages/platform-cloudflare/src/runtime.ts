// Re-exported so generated worker entries can register the asset manifest
// via a specifier that resolves from this package's own dependency context
// (a bare "@b9g/assets/manifest" import in a generated entry resolves from
// the user's project root, which fails under pnpm-isolated layouts and can
// bundle a second registry copy).
export {setAssetsManifest} from "@b9g/assets/manifest";

/**
 * Cloudflare Worker Runtime
 *
 * This module provides runtime initialization for Cloudflare Workers.
 * It is imported by the entry wrapper, not by user code.
 */

import {
	ServiceWorkerGlobals,
	ShovelServiceWorkerRegistration,
	ShovelFetchEvent,
	type ShovelFetchEventInit,
	ShovelWebSocketConnection,
	CustomLoggerStorage,
	configureLogging,
	createCacheFactory,
	createDirectoryFactory,
	runLifecycle,
	dispatchFetchEvent,
	errorToResponse,
	setBroadcastChannelBackend,
	kGetConnectionState,
	type ShovelConfig,
	hasBroadcastChannelBackend,
} from "@b9g/platform/runtime";

// A pre-socket frame the handler produced (via conn.send/close) before the
// physical WebSocket exists; buffered in the worker and replayed in the DO.
type WsFrame =
	| {type: "send"; data: string | ArrayBuffer}
	| {type: "close"; code?: number; reason?: string};

function bytesToBase64(bytes: Uint8Array): string {
	let bin = "";
	for (let i = 0; i < bytes.length; i += 0x8000) {
		bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return btoa(bin);
}

/** JSON-safe encoding of buffered frames for the worker→DO establish handoff. */
function encodeFrames(frames: WsFrame[]): unknown[] {
	return frames.map((f) => {
		if (f.type === "close") return {k: "c", code: f.code, reason: f.reason};
		if (typeof f.data === "string") return {k: "s", s: f.data};
		return {k: "b", b: bytesToBase64(new Uint8Array(f.data))};
	});
}

// runLifecycle is used internally by createFetchHandler (not re-exported)
import {CustomCacheStorage} from "@b9g/cache";
import {CustomDirectoryStorage} from "@b9g/filesystem";
import {getLogger} from "@logtape/logtape";
import {envStorage} from "./variables.js";

export type {ShovelConfig};

// ============================================================================
// CLOUDFLARE TYPES
// ============================================================================

/**
 * Cloudflare's ExecutionContext - passed to each request handler
 */
export interface ExecutionContext {
	waitUntil(promise: Promise<unknown>): void;
	passThroughOnException(): void;
}

// ============================================================================
// CLOUDFLARE FETCH EVENT
// ============================================================================

/**
 * Options for CloudflareFetchEvent constructor
 */
export interface CloudflareFetchEventInit extends ShovelFetchEventInit {
	/** Cloudflare environment bindings (KV, R2, D1, etc.) */
	env: Record<string, unknown>;
}

/**
 * Cloudflare-specific FetchEvent with env bindings.
 *
 * Extends ShovelFetchEvent to add the `env` property for accessing
 * Cloudflare bindings (KV namespaces, R2 buckets, D1 databases, etc.)
 */
export class CloudflareFetchEvent extends ShovelFetchEvent {
	/** Cloudflare environment bindings (KV, R2, D1, Durable Objects, etc.) */
	readonly env: Record<string, unknown>;

	constructor(request: Request, options: CloudflareFetchEventInit) {
		super(request, options);
		this.env = options.env;
	}
}

// ============================================================================
// RUNTIME INITIALIZATION
// ============================================================================

// Module-level state (initialized once when module loads)
let _registration: ShovelServiceWorkerRegistration | null = null;
let _globals: ServiceWorkerGlobals | null = null;

/**
 * Initialize the Cloudflare runtime with ServiceWorkerGlobals
 *
 * @param config - Shovel configuration from shovel:config virtual module
 * @returns The ServiceWorker registration for handling requests
 */
export async function initializeRuntime(
	config: ShovelConfig,
): Promise<ShovelServiceWorkerRegistration> {
	if (_registration) {
		return _registration;
	}

	// Configure logging first
	if (config.logging) {
		await configureLogging(config.logging);
	}

	_registration = new ShovelServiceWorkerRegistration();

	// Create cache storage with config-driven factory
	const caches = new CustomCacheStorage(
		createCacheFactory({configs: config.caches ?? {}}),
	);

	// Create directory storage with config-driven factory
	const directories = new CustomDirectoryStorage(
		createDirectoryFactory(config.directories ?? {}),
	);

	// Create ServiceWorkerGlobals
	_globals = new ServiceWorkerGlobals({
		registration: _registration,
		caches,
		directories,
		loggers: new CustomLoggerStorage((cats) => getLogger(cats)),
	});

	// Install globals (caches, directories, cookieStore, addEventListener, etc.)
	_globals.install();

	return _registration;
}

/**
 * Create the ES module fetch handler for Cloudflare Workers
 *
 * Creates a CloudflareFetchEvent with env bindings and waitUntil hook,
 * then delegates to registration.handleEvent()
 *
 * Lifecycle (install/activate) is deferred to the first request because
 * Cloudflare Workers don't allow setTimeout in global scope, and our
 * lifecycle implementation uses timeouts for safety.
 */
export function createFetchHandler(
	registration: ShovelServiceWorkerRegistration,
): (
	request: Request,
	env: unknown,
	ctx: ExecutionContext,
) => Promise<Response> {
	// Defer lifecycle to first request (workerd restriction on setTimeout in global scope)
	let lifecyclePromise: Promise<void> | null = null;
	let bcBackendConfigured = false;

	return async (
		request: Request,
		env: unknown,
		ctx: ExecutionContext,
	): Promise<Response> => {
		// Run lifecycle once on first request
		if (!lifecyclePromise) {
			lifecyclePromise = runLifecycle(registration, "activate");
		}
		await lifecyclePromise;

		// Auto-configure BroadcastChannel DO backend if binding is present.
		// Worker isolates are ephemeral and not addressable by the pubsub DO,
		// so they pass `null` for the subscriber identity: they can publish
		// but cannot receive cross-isolate publishes.
		const envRecord = env as Record<string, unknown>;
		// Also guard on ANY installed backend: the WS DO shares this module's
		// state and installs a backend carrying its DO id — overwriting it
		// with this null-id one would unsubscribe the DO from the pubsub
		// registry and kill hibernation wake-ups.
		if (
			!bcBackendConfigured &&
			!hasBroadcastChannelBackend() &&
			envRecord.SHOVEL_PUBSUB
		) {
			const {CloudflarePubSubBackend} = await import("./pubsub.js");
			setBroadcastChannelBackend(
				new CloudflarePubSubBackend(
					envRecord.SHOVEL_PUBSUB as DurableObjectNamespace,
					null,
				),
			);
			bcBackendConfigured = true;
		}

		// LAZY WEBSOCKET INIT: a request upgrades ONLY when the fetch handler
		// actually calls event.upgradeWebSocket() — never on the header alone.
		// The handler runs HERE, in the stateless worker; the Durable Object
		// (Cloudflare's socket-holder) is touched only after a real upgrade.
		// This is the same contract Node/Bun already honor, and it closes the
		// billing-DoS where an Upgrade header on any route spun up the DO.
		const upgradeHeader = request.headers.get("upgrade")?.toLowerCase() ?? "";
		const isUpgradeCapable =
			request.method === "GET" &&
			upgradeHeader.split(",").some((token) => token.trim() === "websocket");

		if (!isUpgradeCapable) {
			// No upgrade machinery armed — the common case, unchanged.
			const event = new CloudflareFetchEvent(request, {
				env: envRecord,
				platformWaitUntil: (promise) => ctx.waitUntil(promise),
			});
			return envStorage.run(envRecord, async () => {
				const {response} = await dispatchFetchEvent(registration, event);
				return response!;
			});
		}

		// Arm a buffering relay so the handler can subscribe/send before any
		// socket exists; capture the connection if it upgrades.
		const pending: WsFrame[] = [];
		let upgraded: ShovelWebSocketConnection | null = null;
		const event = new CloudflareFetchEvent(request, {
			env: envRecord,
			platformWaitUntil: (promise) => ctx.waitUntil(promise),
			wsRelay: {
				send(_id, data) {
					pending.push({type: "send", data});
				},
				close(_id, code, reason) {
					pending.push({type: "close", code, reason});
				},
			},
			onUpgrade: (conn) => {
				upgraded = conn;
			},
		});

		return envStorage.run(envRecord, async () => {
			let response: Response | null | undefined;
			try {
				const result = await dispatchFetchEvent(registration, event);
				response = result.response;
			} catch (err) {
				(upgraded as ShovelWebSocketConnection | null)?._releaseSubscriptions();
				return errorToResponse(err);
			}

			// The handler did NOT upgrade: return its response, DO untouched.
			if (!upgraded) {
				return response ?? new Response("Not Found", {status: 404});
			}

			// The handler upgraded. Hand the captured connection state to the
			// DO to materialize the physical socket — it does NOT re-run the
			// handler (no double side-effects).
			const conn = upgraded as ShovelWebSocketConnection;
			if (!envRecord.SHOVEL_WS) {
				conn._releaseSubscriptions();
				return new Response(
					"WebSocket upgrade requires SHOVEL_WS Durable Object binding in wrangler.toml",
					{status: 426},
				);
			}
			const state = conn[kGetConnectionState]();
			const setCookies = event.cookieStore.hasChanges()
				? event.cookieStore.getSetCookieHeaders()
				: [];
			// The worker's connection is throwaway — release its worker-isolate
			// subscriptions; the DO re-establishes them bound to the real socket.
			conn._releaseSubscriptions();

			const ns = envRecord.SHOVEL_WS as DurableObjectNamespace;
			const stub = ns.get(ns.idFromName("shovel-ws"));

			// Two steps, because the socket handshake and the arbitrary-size
			// state can't ride the same request: a WS upgrade must be a bodyless
			// GET, so (1) stage the captured state via RPC (binding-only, not
			// externally reachable), then (2) forward the ORIGINAL upgrade
			// request so workerd threads the real socket. The DO matches them by
			// connection id.
			await (
				stub as unknown as {
					prepareUpgrade(state: {
						id: string;
						url: string;
						subscribedChannels: string[];
						frames: unknown[];
						setCookies: string[];
					}): Promise<void>;
				}
			).prepareUpgrade({
				id: state.id,
				url: state.url,
				subscribedChannels: state.subscribedChannels,
				frames: encodeFrames(pending),
				setCookies,
			});

			const forwardHeaders = new Headers(request.headers);
			forwardHeaders.set("x-shovel-conn-id", state.id);
			return stub.fetch(
				new Request(request.url, {method: "GET", headers: forwardHeaders}),
			);
		});
	};
}

/**
 * Get the module-level registration singleton.
 * Used by ShovelWebSocketDO after hibernation wake-up.
 * @internal
 */
export function _getRegistration(): ShovelServiceWorkerRegistration | null {
	return _registration;
}
