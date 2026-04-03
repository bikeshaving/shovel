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
	setBroadcastChannelBackend,
	type ShovelConfig,
} from "@b9g/platform/runtime";

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

		// Route WebSocket upgrades to Durable Object for hibernation support
		// Only intercept when SHOVEL_WS binding is configured — otherwise
		// let the request reach user code (for manual WebSocketPair usage)
		if (
			request.headers.get("upgrade")?.toLowerCase() === "websocket" &&
			envRecord.SHOVEL_WS
		) {
			const ns = envRecord.SHOVEL_WS as DurableObjectNamespace;
			// Each connection gets its own DO for scalability — hibernation
			// keeps idle DOs cheap, and this avoids single-object bottlenecks
			const id = ns.newUniqueId();
			const stub = ns.get(id);
			return stub.fetch(request);
		}

		// Create CloudflareFetchEvent with env and waitUntil hook
		const event = new CloudflareFetchEvent(request, {
			env: envRecord,
			platformWaitUntil: (promise) => ctx.waitUntil(promise),
		});

		// Run within envStorage for directory factory access
		return envStorage.run(envRecord, async () => {
			const {response, event: fetchEvent} = await dispatchFetchEvent(
				registration,
				event,
			);

			// Handle WebSocket upgrade without DO (non-hibernation fallback)
			const upgrade = fetchEvent[kGetUpgradeResult]?.();
			if (upgrade) {
				const pair = new WebSocketPair();
				const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
				(server as any).accept();

				server.addEventListener("message", (msg: MessageEvent) => {
					dispatchWebSocketMessage(
						registration,
						upgrade.client,
						msg.data,
					).catch(() => {});
				});
				server.addEventListener("close", (evt: CloseEvent) => {
					dispatchWebSocketClose(
						registration,
						upgrade.client,
						evt.code,
						evt.reason,
						evt.wasClean,
					).catch(() => {});
				});

				upgrade.client.setRelay({
					send(_id: string, data: string | ArrayBuffer) {
						server.send(data);
					},
					close(_id: string, code?: number, reason?: string) {
						server.close(code ?? 1000, reason ?? "");
					},
				});

				return new Response(null, {
					status: 101,
					webSocket: client,
				} as any);
			}

			return response!;
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
