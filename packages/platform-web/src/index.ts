/**
 * @b9g/platform-web - Browser Service Worker platform adapter for Shovel
 *
 * Provides deployment to static hosting via real browser Service Workers.
 *
 * Architecture:
 * - Uses ServiceWorkerGlobals from @b9g/platform for full feature parity
 * - Caches use the browser's native Cache API
 * - Directories use Cache API-backed read-only storage
 */

import type {
	PlatformDefaults,
	EntryPoints,
	ESBuildConfig,
	DevServerOptions,
	DevServer,
} from "@b9g/platform/module";

// ============================================================================
// PLATFORM IMPLEMENTATION
// ============================================================================

/**
 * Web platform implementation
 *
 * Mirrors platform.ts functions as class methods (dual-file pattern).
 * Primarily for API consistency with other platform packages.
 */
export class WebPlatform {
	readonly name: string;

	constructor() {
		this.name = "web";
	}

	/**
	 * Get entry points for bundling.
	 *
	 * Web platform produces a single Service Worker file.
	 */
	getEntryPoints(
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
	 * Get Cloudflare-specific esbuild configuration
	 */
	getESBuildConfig(): ESBuildConfig {
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
	 * Get web platform defaults for config generation
	 */
	getDefaults(): PlatformDefaults {
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

	/**
	 * Create a dev server for browser Service Workers.
	 */
	async createDevServer(options: DevServerOptions): Promise<DevServer> {
		const {createWebDevServer} = await import("./dev-server.js");
		return createWebDevServer(options);
	}
}

export default WebPlatform;
