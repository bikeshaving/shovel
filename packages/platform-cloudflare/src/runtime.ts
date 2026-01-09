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
 */
export function createFetchHandler(
	registration: ShovelServiceWorkerRegistration,
): (
	request: Request,
	env: unknown,
	ctx: ExecutionContext,
) => Promise<Response> {
	return async (
		request: Request,
		env: unknown,
		ctx: ExecutionContext,
	): Promise<Response> => {
		// Create CloudflareFetchEvent with env and waitUntil hook
		const event = new CloudflareFetchEvent(request, {
			env: env as Record<string, unknown>,
			platformWaitUntil: (promise) => ctx.waitUntil(promise),
		});

		// Run within envStorage for directory factory access
		return envStorage.run(env as Record<string, unknown>, () =>
			registration.handleRequest(event),
		);
	};
}
