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
	CustomLoggerStorage,
	configureLogging,
	createCacheFactory,
	createDirectoryFactory,
	runLifecycle,
	dispatchFetchEvent,
	kGetUpgradeResult,
	dispatchWebSocketMessage,
	dispatchWebSocketClose,
	ShovelClients,
	setBroadcastChannelBackend,
	type ShovelConfig,
} from "@b9g/platform/runtime";

// runLifecycle is used internally by createFetchHandler (not re-exported)
import {CustomCacheStorage} from "@b9g/cache";
import {CustomDirectoryStorage} from "@b9g/filesystem";
import {getLogger} from "@logtape/logtape";
import {envStorage} from "./variables.js";

const logger = getLogger(["shovel", "platform"]);

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

	// Get the ShovelClients instance for WebSocket client registration
	const shovelClients =
		typeof self !== "undefined" &&
		(self as any).clients instanceof ShovelClients
			? ((self as any).clients as ShovelClients)
			: null;

	// Per-connection dispatch queue to preserve message ordering
	const dispatchQueues = new Map<string, Promise<void>>();

	// Relay for outbound WebSocket messages (set per-upgrade, closed over by the event)
	// Each connection gets its own relay bound to its server socket
	function createRelay(server: WebSocket) {
		return {
			send(_id: string, data: string | ArrayBuffer) {
				server.send(data);
			},
			close(_id: string, code?: number, reason?: string) {
				server.close(code ?? 1000, reason ?? "");
			},
		};
	}

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

		// Auto-configure BroadcastChannel DO backend if binding is present
		const envRecord = env as Record<string, unknown>;
		if (!bcBackendConfigured && envRecord.SHOVEL_PUBSUB) {
			const {CloudflarePubSubBackend} = await import("./pubsub.js");
			setBroadcastChannelBackend(
				new CloudflarePubSubBackend(
					envRecord.SHOVEL_PUBSUB as DurableObjectNamespace,
				),
			);
			bcBackendConfigured = true;
		}

		// Run within envStorage for directory factory access
		return envStorage.run(envRecord, async () => {
			// Create WebSocketPair eagerly so we can pass the relay into the event.
			// The relay lets upgradeWebSocket() return a client with working send/close.
			const pair = new WebSocketPair();
			const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
			const relay = createRelay(server);

			// Create CloudflareFetchEvent with env, waitUntil, and WebSocket relay
			const cfEvent = new CloudflareFetchEvent(request, {
				env: envRecord,
				platformWaitUntil: (promise: Promise<unknown>) =>
					ctx.waitUntil(promise),
				wsRelay: relay,
			});

			const {response, event: fetchEvent} = await dispatchFetchEvent(
				registration,
				cfEvent,
			);

			// WebSocket upgrade — wire up the WebSocketPair
			const upgrade = fetchEvent[kGetUpgradeResult]?.();
			if (upgrade) {
				const connectionID = upgrade.client.id;

				// Register with self.clients so clients.get()/matchAll() work
				shovelClients?.registerWebSocketClient(upgrade.client);

				// Accept the server side to start receiving messages
				(server as any).accept();

				// Wire incoming messages with ordered dispatch
				server.addEventListener("message", (msg: MessageEvent) => {
					const prev = dispatchQueues.get(connectionID) ?? Promise.resolve();
					const next = prev
						.then(() =>
							dispatchWebSocketMessage(registration, upgrade.client, msg.data),
						)
						.catch((err) => {
							logger.error("WebSocket message dispatch failed: {error}", {
								error: err,
							});
						});
					dispatchQueues.set(connectionID, next);
				});

				// Wire close with ordered dispatch
				server.addEventListener("close", (evt: CloseEvent) => {
					shovelClients?.removeWebSocketClient(connectionID);
					const prev = dispatchQueues.get(connectionID) ?? Promise.resolve();
					prev
						.then(() =>
							dispatchWebSocketClose(
								registration,
								upgrade.client,
								evt.code,
								evt.reason,
								evt.wasClean,
							),
						)
						.catch((err) => {
							logger.error("WebSocket close dispatch failed: {error}", {
								error: err,
							});
						})
						.finally(() => {
							dispatchQueues.delete(connectionID);
						});
				});

				// Return the WebSocket upgrade response (Cloudflare allows status 101)
				return new Response(null, {
					status: 101,
					webSocket: client,
				} as any);
			}

			return response!;
		});
	};
}
