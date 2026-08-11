/**
 * Web Platform Module
 *
 * Build-time and dev-time functions for browser Service Workers.
 * Runtime functions are in ./runtime.ts
 */

import type {
	EntryPoints,
	ESBuildConfig,
	PlatformDefaults,
	DevServerOptions,
	DevServer,
} from "@b9g/platform/module";

// ============================================================================
// PLATFORM IDENTITY
// ============================================================================

export const name = "web";

// ============================================================================
// BUILD-TIME FUNCTIONS
// ============================================================================

/**
 * Get entry points for bundling.
 *
 * Web platform produces a single Service Worker file.
 * The generated code captures native SW APIs before ServiceWorkerGlobals.install()
 * replaces them, then bridges real SW fetch events to Shovel's dispatchRequest().
 */
export function getEntryPoints(
	userEntryPath: string,
	_mode: "development" | "production",
): EntryPoints {
	const safePath = JSON.stringify(userEntryPath);

	const workerCode = `// Browser Service Worker Entry
import { config } from "shovel:config";
import { initializeRuntime, createFetchHandler } from "@b9g/platform-web/runtime";
import assetManifest from "shovel:assets";

// Capture natives BEFORE ServiceWorkerGlobals.install() replaces them
const nativeAddEventListener = self.addEventListener.bind(self);
const nativeCaches = self.caches;

// Initialize runtime (installs ServiceWorker globals)
const registration = await initializeRuntime(config);

// Import user code (registers event handlers via shimmed self.addEventListener)
await import(${safePath});

const handleFetch = createFetchHandler(registration);

nativeAddEventListener("install", (event) => {
  event.waitUntil((async () => {
    // Pre-cache static assets
    const cache = await nativeCaches.open("shovel-assets-v1");
    const urls = Object.values(assetManifest.assets || {}).filter(e => e && e.url).map(e => e.url);
    if (urls.length) await cache.addAll(urls);
    await self.skipWaiting();
  })());
});

nativeAddEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

nativeAddEventListener("fetch", (event) => {
  event.respondWith(handleFetch(event.request));
});
`;

	return {worker: workerCode};
}

/**
 * Get ESBuild configuration for browser Service Workers.
 *
 * Uses browser platform with worker conditions. No externals — everything
 * must be bundled into the SW since there's no runtime module system.
 */
export function getESBuildConfig(): ESBuildConfig {
	return {
		platform: "browser",
		conditions: ["worker", "browser"],
		external: [],
		define: {
			"process.env": "({MODE:'production'})",
		},
		alias: {
			"@b9g/async-context": "@b9g/platform-web/async-context-stub",
		},
	};
}

/**
 * Get platform defaults for config generation.
 *
 * These become static imports in the bundled config.
 */
export function getDefaults(): PlatformDefaults {
	return {
		caches: {
			"*": {
				module: "@b9g/platform-web/caches",
				export: "WebNativeCache",
			},
		},
		directories: {
			public: {
				module: "@b9g/platform-web/directories",
				export: "WebCacheDirectory",
			},
		},
	};
}

// ============================================================================
// DEV-TIME FUNCTIONS
// ============================================================================

/**
 * Create a dev server for browser Service Workers.
 *
 * Dynamically imports the Node.js HTTP server to keep it out of browser bundles.
 */
export async function createDevServer(
	options: DevServerOptions,
): Promise<DevServer> {
	const {createWebDevServer} = await import("./dev-server.js");
	return createWebDevServer(options);
}
