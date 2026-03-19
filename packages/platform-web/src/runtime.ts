/**
 * Web Platform Runtime
 *
 * This module provides runtime initialization for browser Service Workers.
 * It is imported by the entry wrapper, not by user code.
 */

import {
	ServiceWorkerGlobals,
	ShovelServiceWorkerRegistration,
	ShovelFetchEvent,
	CustomLoggerStorage,
	configureLogging,
	createCacheFactory,
	createDirectoryFactory,
	runLifecycle,
	dispatchRequest,
	type ShovelConfig,
} from "@b9g/platform/runtime";

import {CustomCacheStorage} from "@b9g/cache";
import {CustomDirectoryStorage} from "@b9g/filesystem";
import {getLogger} from "@logtape/logtape";

export type {ShovelConfig};

// ============================================================================
// RUNTIME INITIALIZATION
// ============================================================================

// Module-level state (initialized once when module loads)
let _registration: ShovelServiceWorkerRegistration | null = null;
let _globals: ServiceWorkerGlobals | null = null;

/**
 * Initialize the web runtime with ServiceWorkerGlobals
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
 * Create a fetch handler for the browser Service Worker.
 *
 * Lifecycle (install/activate) is deferred to the first request.
 * Returns an async handler: (request: Request) => Promise<Response>
 */
export function createFetchHandler(
	registration: ShovelServiceWorkerRegistration,
): (request: Request) => Promise<Response> {
	// Defer lifecycle to first request
	let lifecyclePromise: Promise<void> | null = null;

	return async (request: Request): Promise<Response> => {
		// Run lifecycle once on first request
		if (!lifecyclePromise) {
			lifecyclePromise = runLifecycle(registration, "activate");
		}
		await lifecyclePromise;

		// Create a ShovelFetchEvent and dispatch
		const event = new ShovelFetchEvent(request, {
			platformWaitUntil: (_promise) => {
				// In browser SW, we don't have a ctx.waitUntil — the real
				// SW event.waitUntil is handled at the outer entry level
			},
		});

		return dispatchRequest(registration, event);
	};
}
