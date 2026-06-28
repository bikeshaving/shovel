/**
 * Cloudflare Platform Module
 *
 * Build-time and dev-time functions for Cloudflare Workers.
 * Runtime functions are in ./runtime.ts
 */

import {getLogger} from "@logtape/logtape";
import {dirname, join} from "path";
import type {
	EntryPoints,
	ESBuildConfig,
	PlatformDefaults,
	DevServerOptions,
	DevServer,
} from "@b9g/platform/module";

const logger = getLogger(["shovel", "platform"]);

// ============================================================================
// PLATFORM IDENTITY
// ============================================================================

export const name = "cloudflare";

// ============================================================================
// BUILD-TIME FUNCTIONS
// ============================================================================

/**
 * Get entry points for bundling.
 *
 * Cloudflare produces a single file for both dev and prod.
 * Dev and prod are identical because workerd doesn't allow setTimeout
 * in global scope, so lifecycle must be deferred to first request.
 */
export function getEntryPoints(
	userEntryPath: string,
	_mode: "development" | "production",
): EntryPoints {
	const safePath = JSON.stringify(userEntryPath);

	const workerCode = `// Cloudflare Worker Entry
import { config } from "shovel:config";
import __shovelAssetsManifest from "shovel:assets";
import { initializeRuntime, createFetchHandler, setAssetsManifest } from "@b9g/platform-cloudflare/runtime";

// Register the build's asset manifest so directory handles can enumerate
// ASSETS without importing the virtual module from library code (which
// breaks consumers bundling outside a shovel build).
setAssetsManifest(__shovelAssetsManifest);

// Re-export the WebSocket Durable Object so wrangler can bind it. The class
// is only referenced if the user configures a SHOVEL_WS binding in their
// wrangler.toml; otherwise it's dead-code-eliminated at bundle time.
export { ShovelWebSocketDO } from "@b9g/platform-cloudflare/websocket-do";

// Re-export the PubSub Durable Object for wrangler binding. Only loaded when
// SHOVEL_PUBSUB is configured; the cross-isolate BroadcastChannel relay uses
// it as a registry that wakes subscriber DOs on publish via fetch.
export { ShovelPubSubDO } from "@b9g/platform-cloudflare/pubsub";

// Initialize runtime (installs ServiceWorker globals)
const registration = await initializeRuntime(config);

// Import user code (registers event handlers)
await import(${safePath});

// Lifecycle deferred to first request (workerd restriction)
export default { fetch: createFetchHandler(registration) };
`;

	return {worker: workerCode};
}

/**
 * Get ESBuild configuration for Cloudflare Workers.
 *
 * Uses browser platform with worker conditions.
 * Node builtins are externalized - available at runtime via nodejs_compat.
 */
export function getESBuildConfig(): ESBuildConfig {
	return {
		platform: "browser",
		conditions: ["worker", "browser"],
		external: [
			"node:*",
			"cloudflare:*",
			"path",
			"fs",
			"fs/promises",
			"crypto",
			"util",
			"stream",
			"buffer",
			"events",
		],
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
				module: "@b9g/platform-cloudflare/caches",
				export: "CloudflareNativeCache",
			},
		},
		directories: {
			public: {
				module: "@b9g/platform-cloudflare/directories",
				export: "CloudflareAssetsDirectory",
			},
		},
	};
}

// ============================================================================
// DEV-TIME FUNCTIONS
// ============================================================================

/**
 * Create a dev server using Miniflare.
 *
 * Dynamically imports Miniflare to keep it out of production bundles.
 */
export async function createDevServer(
	options: DevServerOptions,
): Promise<DevServer> {
	const {port, host, workerPath} = options;

	logger.info("Starting Miniflare dev server", {workerPath});

	// Dynamic import - Miniflare is never in prod bundle
	const {Miniflare} = await import("miniflare");

	// Derive the public assets directory from the worker path.
	// workerPath is e.g. dist/server/worker.js → outDir is dist → public is dist/public
	const publicDir = join(dirname(dirname(workerPath)), "public");

	const getMiniflareOptions = (scriptPath: string) => ({
		modules: true,
		scriptPath,
		compatibilityDate: "2024-09-23",
		compatibilityFlags: ["nodejs_compat"],
		port,
		host,
		// Bind both Durable Objects exported by the generated worker so that
		// `upgradeWebSocket()` works in dev exactly as it does in production.
		// Production users still need the matching bindings in their
		// wrangler.toml, but they shouldn't have to wire up dev separately.
		durableObjects: {
			SHOVEL_WS: "ShovelWebSocketDO",
			SHOVEL_PUBSUB: "ShovelPubSubDO",
		},
		assets: {
			directory: publicDir,
			binding: "ASSETS",
			routerConfig: {has_user_worker: true},
		},
	});

	let miniflare = new Miniflare(getMiniflareOptions(workerPath));

	await miniflare.ready;
	logger.info("Miniflare dev server ready");

	const url = `http://${host}:${port}`;

	return {
		url,

		async reload(newWorkerPath: string) {
			logger.info("Reloading Miniflare", {workerPath: newWorkerPath});

			// Dispose old instance and create new one
			await miniflare.dispose();

			miniflare = new Miniflare(getMiniflareOptions(newWorkerPath));

			await miniflare.ready;
			logger.info("Miniflare reloaded");
		},

		async close() {
			logger.info("Stopping Miniflare");
			await miniflare.dispose();
		},
	};
}
