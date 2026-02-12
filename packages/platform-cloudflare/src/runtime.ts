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
	dispatchRequest,
	setBroadcastChannelBackend,
	type ShovelConfig,
} from "@b9g/platform/runtime";
import {createWebSocketBridge} from "@b9g/platform/websocket-bridge";

// runLifecycle is used internally by createFetchHandler (not re-exported)
import {CustomCacheStorage} from "@b9g/cache";
import {CustomDirectoryStorage} from "@b9g/filesystem";
import {getLogger} from "@logtape/logtape";
import {envStorage} from "./variables.js";

// Capture native WebSocketPair before ServiceWorkerGlobals overwrites it
const NativeWebSocketPair = (globalThis as any)
	.WebSocketPair as typeof WebSocketPair;

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

		// Create CloudflareFetchEvent with env and waitUntil hook
		const event = new CloudflareFetchEvent(request, {
			env: envRecord,
			platformWaitUntil: (promise) => ctx.waitUntil(promise),
		});

		// Run within envStorage for directory factory access
		const result = await envStorage.run(envRecord, () =>
			dispatchRequest(registration, event),
		);

		// WebSocket upgrade: bridge ShovelWebSocket to Cloudflare native WebSocket
		if (result.webSocket) {
			if (!NativeWebSocketPair) {
				throw new Error(
					"WebSocketPair not available. Are you running in a Cloudflare Workers environment?",
				);
			}
			const cfPair = new NativeWebSocketPair();
			const cfClient = cfPair[0];
			const cfServer = cfPair[1];
			const bridge = createWebSocketBridge(result.webSocket);
			bridge.connect(
				(data) => cfServer.send(data),
				(code, reason) => cfServer.close(code, reason),
			);
			cfServer.accept();
			cfServer.addEventListener("message", (ev: MessageEvent) =>
				bridge.deliver(ev.data),
			);
			cfServer.addEventListener("close", (ev: CloseEvent) =>
				bridge.deliverClose(ev.code, ev.reason),
			);
			return new Response(null, {status: 101, webSocket: cfClient});
		}

		return result.response!;
	};
}
