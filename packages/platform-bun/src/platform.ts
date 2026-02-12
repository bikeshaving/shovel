/**
 * Bun Platform Module
 *
 * Build-time and dev-time functions for Bun.
 * Runtime functions are in ./runtime.ts
 */

import {getLogger} from "@logtape/logtape";
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

export const name = "bun";

// ============================================================================
// BUILD-TIME FUNCTIONS
// ============================================================================

/**
 * Get entry points for bundling.
 *
 * Development mode:
 * - worker.js: Single worker with message loop (develop command manages process)
 *
 * Production mode:
 * - supervisor.js: Spawns workers and handles signals
 * - worker.js: Worker with its own HTTP server (uses reusePort for multi-worker)
 *
 * Unlike Node.js, Bun workers each bind their own server with reusePort,
 * allowing the OS to load-balance across workers without message passing overhead.
 */
export function getEntryPoints(
	userEntryPath: string,
	mode: "development" | "production",
): EntryPoints {
	const safePath = JSON.stringify(userEntryPath);

	// Development worker (simpler, managed by develop command via message loop)
	const devWorkerCode = `// Bun Development Worker
import {configureLogging, initWorkerRuntime, runLifecycle, startWorkerMessageLoop} from "@b9g/platform/runtime";
import {config} from "shovel:config";

await configureLogging(config.logging);

// Initialize worker runtime (installs ServiceWorker globals)
// Single-worker dev mode uses direct cache (no PostMessage overhead)
const {registration, databases} = await initWorkerRuntime({config, usePostMessage: config.workers > 1});

// Import user code (registers event handlers)
await import(${safePath});

// Run ServiceWorker lifecycle
await runLifecycle(registration);

// Start message loop for request handling (develop command handles HTTP)
startWorkerMessageLoop({registration, databases});
`;

	if (mode === "development") {
		return {worker: devWorkerCode};
	}

	// Worker code for production (with message handling for supervisor communication)
	const prodWorkerCode = `// Bun Production Worker
import BunPlatform from "@b9g/platform-bun";
import {getLogger} from "@logtape/logtape";
import {configureLogging, initWorkerRuntime, runLifecycle, dispatchRequest, setBroadcastChannelRelay, deliverBroadcastMessage} from "@b9g/platform/runtime";
import {createWebSocketBridge} from "@b9g/platform/websocket-bridge";
import {config} from "shovel:config";

await configureLogging(config.logging);
const logger = getLogger(["shovel", "platform"]);

// Track resources for shutdown
let server;
let databases;

// Register message handler for shutdown and broadcast relay
self.onmessage = async (event) => {
	if (event.data.type === "shutdown") {
		logger.info("Worker shutting down");
		if (server) await server.close();
		if (databases) await databases.closeAll();
		postMessage({type: "shutdown-complete"});
	} else if (event.data.type === "broadcast:deliver") {
		deliverBroadcastMessage(event.data.channel, event.data.data);
	}
};

// Initialize worker runtime (usePostMessage: false — worker owns its server, no message loop)
const result = await initWorkerRuntime({config, usePostMessage: false});
const registration = result.registration;
databases = result.databases;

// Set up broadcast relay (posts go to supervisor for fan-out to other workers)
setBroadcastChannelRelay((channelName, data) => {
	postMessage({type: "broadcast:post", channel: channelName, data});
});

// Import user code (registers event handlers)
await import(${safePath});

// Run ServiceWorker lifecycle (stage from config.lifecycle if present)
await runLifecycle(registration, config.lifecycle?.stage);

// Start server (skip in lifecycle-only mode)
if (!config.lifecycle) {
	const platform = new BunPlatform({port: config.port, host: config.host});
	server = platform.createServer(
		async (request) => {
			const result = await dispatchRequest(registration, request);
			if (result.webSocket) return {webSocket: createWebSocketBridge(result.webSocket)};
			return {response: result.response};
		},
		{reusePort: config.workers > 1},
	);
	await server.listen();
}

postMessage({type: "ready"});
logger.info("Worker started", {port: config.port});
`;

	// Production: supervisor + worker
	const supervisorCode = `// Bun Production Supervisor
import {getLogger} from "@logtape/logtape";
import {configureLogging} from "@b9g/platform/runtime";
import BunPlatform from "@b9g/platform-bun";
import {config} from "shovel:config";

await configureLogging(config.logging);
const logger = getLogger(["shovel", "platform"]);

logger.info("Starting production server", {port: config.port, workers: config.workers});

// Initialize platform and register ServiceWorker (workers handle their own HTTP via reusePort)
const platform = new BunPlatform({port: config.port, host: config.host, workers: config.workers});
await platform.serviceWorker.register(new URL("./worker.js", import.meta.url).href);
await platform.serviceWorker.ready;

logger.info("All workers ready", {port: config.port, workers: config.workers});

// Graceful shutdown
const handleShutdown = async () => {
	logger.info("Shutting down");
	await platform.serviceWorker.terminate();
	process.exit(0);
};
process.on("SIGINT", handleShutdown);
process.on("SIGTERM", handleShutdown);
`;

	return {
		supervisor: supervisorCode,
		worker: prodWorkerCode,
	};
}

/**
 * Get ESBuild configuration for Bun.
 *
 * Note: Bun natively supports import.meta.env, so no define alias is needed.
 * We use platform: "node" since Bun is Node-compatible for module resolution.
 */
export function getESBuildConfig(): ESBuildConfig {
	return {
		platform: "node",
		external: ["bun", "bun:*"],
	};
}

/**
 * Get platform defaults for config generation.
 *
 * Provides default directories (server, public, tmp) that work
 * out of the box for Bun deployments.
 */
export function getDefaults(): PlatformDefaults {
	return {
		caches: {
			"*": {
				module: "@b9g/cache/memory",
				export: "MemoryCache",
			},
		},
		directories: {
			server: {
				module: "@b9g/filesystem/node-fs",
				export: "NodeFSDirectory",
				path: "[outdir]/server",
			},
			public: {
				module: "@b9g/filesystem/node-fs",
				export: "NodeFSDirectory",
				path: "[outdir]/public",
			},
			tmp: {
				module: "@b9g/filesystem/node-fs",
				export: "NodeFSDirectory",
				path: "[tmpdir]",
			},
		},
	};
}

// ============================================================================
// DEV-TIME FUNCTIONS
// ============================================================================

/**
 * Create a dev server using ServiceWorkerPool.
 *
 * Dynamically imports the platform class to keep heavy dependencies
 * out of production bundles.
 */
export async function createDevServer(
	options: DevServerOptions,
): Promise<DevServer> {
	const {port, host, workerPath, workers = 1} = options;

	logger.info("Starting Bun dev server", {workerPath, workers});

	// Dynamic import - keeps BunPlatform class out of prod bundle
	const {default: BunPlatform} = await import("./index.js");

	const platform = new BunPlatform({
		port,
		host,
		workers,
	});

	// Register the worker
	await platform.serviceWorker.register(workerPath);
	await platform.serviceWorker.ready;

	// Start HTTP server
	await platform.listen();

	logger.info("Bun dev server ready");

	const url = `http://${host}:${port}`;

	return {
		url,

		async reload(newWorkerPath: string) {
			logger.info("Reloading workers", {workerPath: newWorkerPath});
			await platform.serviceWorker.reloadWorkers(newWorkerPath);
			logger.info("Workers reloaded");
		},

		async close() {
			logger.info("Stopping Bun dev server");
			// Use dispose() to terminate workers, not just close HTTP server
			await platform.dispose();
		},
	};
}
