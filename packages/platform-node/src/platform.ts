/**
 * Node.js Platform Module
 *
 * Build-time and dev-time functions for Node.js.
 * Runtime functions are in ./runtime.ts
 */

import {builtinModules} from "node:module";
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

export const name = "node";

// ============================================================================
// BUILD-TIME FUNCTIONS
// ============================================================================

/**
 * Get entry points for bundling.
 *
 * Development mode:
 * - worker.js: Single worker with message loop (develop command acts as supervisor)
 *
 * Production mode:
 * - supervisor.js: Spawns workers and manages lifecycle
 * - worker.js: Worker that either runs its own HTTP server (single-worker)
 *   or uses message loop (multi-worker, supervisor owns the HTTP server)
 */
export function getEntryPoints(
	userEntryPath: string,
	mode: "development" | "production",
): EntryPoints {
	const safePath = JSON.stringify(userEntryPath);

	// Development worker: uses message loop (develop command owns the HTTP server)
	const devWorkerCode = `// Node.js Development Worker
import {parentPort} from "node:worker_threads";
import {configureLogging, initWorkerRuntime, runLifecycle, startWorkerMessageLoop} from "@b9g/platform/runtime";
import {config} from "shovel:config";

await configureLogging(config.logging);

// Initialize worker runtime (installs ServiceWorker globals)
// Single-worker dev mode uses direct cache (no PostMessage overhead)
const {registration, databases} = await initWorkerRuntime({config, usePostMessage: config.workers > 1});

// Import user code (registers event handlers)
await import(${safePath});

// Run ServiceWorker lifecycle (stage from config.lifecycle if present)
await runLifecycle(registration, config.lifecycle?.stage);

// Start message loop for request handling, or signal ready and exit in lifecycle-only mode
if (config.lifecycle) {
	parentPort?.postMessage({type: "ready"});
	// Clean shutdown after lifecycle
	if (databases) await databases.closeAll();
	process.exit(0);
} else {
	startWorkerMessageLoop({registration, databases});
}
`;

	if (mode === "development") {
		// Development: single worker file (develop command manages the process)
		return {worker: devWorkerCode};
	}

	// Production worker: branches based on worker count
	// - Single worker: creates own HTTP server (no postMessage overhead)
	// - Multi-worker: uses message loop (supervisor owns the HTTP server)
	const prodWorkerCode = `// Node.js Production Worker
import {parentPort} from "node:worker_threads";
import {getLogger} from "@logtape/logtape";
import {configureLogging, initWorkerRuntime, runLifecycle, startWorkerMessageLoop, dispatchRequest} from "@b9g/platform/runtime";
import NodePlatform from "@b9g/platform-node";
import {config} from "shovel:config";

await configureLogging(config.logging);
const logger = getLogger(["shovel", "platform"]);

const directMode = config.workers <= 1;

// Track resources for shutdown
let server;
let databases;

// Register shutdown handler before async startup
parentPort?.on("message", async (event) => {
	if (event.type === "shutdown") {
		logger.info("Worker shutting down");
		if (server) await server.close();
		if (databases) await databases.closeAll();
		parentPort?.postMessage({type: "shutdown-complete"});
	}
});

// Initialize worker runtime (usePostMessage: false when worker owns the server)
const result = await initWorkerRuntime({config, usePostMessage: !directMode});
const registration = result.registration;
databases = result.databases;

// Import user code (registers event handlers)
await import(${safePath});

// Run ServiceWorker lifecycle (stage from config.lifecycle if present)
await runLifecycle(registration, config.lifecycle?.stage);

if (config.lifecycle) {
	parentPort?.postMessage({type: "ready"});
	if (databases) await databases.closeAll();
	process.exit(0);
} else if (directMode) {
	// Single worker: create own HTTP server
	const platform = new NodePlatform({port: config.port, host: config.host});
	server = platform.createServer(
		(request) => dispatchRequest(registration, request),
	);
	await server.listen();
	parentPort?.postMessage({type: "ready"});
	logger.info("Worker started (direct mode)", {port: config.port});
} else {
	// Multi-worker: use message loop (supervisor owns the HTTP server)
	startWorkerMessageLoop({registration, databases});
}
`;

	// Production: supervisor + worker
	const supervisorCode = `// Node.js Production Supervisor
import {Worker} from "@b9g/node-webworker";
import {getLogger} from "@logtape/logtape";
import {configureLogging} from "@b9g/platform/runtime";
import NodePlatform from "@b9g/platform-node";
import {config} from "shovel:config";

await configureLogging(config.logging);
const logger = getLogger(["shovel", "platform"]);

logger.info("Starting production server", {port: config.port, workers: config.workers});

// Initialize platform and register ServiceWorker
// Override createWorker to use the imported Worker class (avoids require() issues with ESM)
const platform = new NodePlatform({port: config.port, host: config.host, workers: config.workers});
platform.createWorker = (entrypoint) => new Worker(entrypoint);
await platform.serviceWorker.register(new URL("./worker.js", import.meta.url).href);
await platform.serviceWorker.ready;

// Single worker owns its own HTTP server — skip platform.listen()
if (config.workers > 1) {
	await platform.listen();
}

logger.info("Server started", {port: config.port, host: config.host, workers: config.workers});

// Graceful shutdown
const handleShutdown = async () => {
	logger.info("Shutting down");
	await platform.close();
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
 * Get ESBuild configuration for Node.js.
 *
 * Note: Node.js doesn't support import.meta.env natively, so we alias it
 * to process.env for compatibility with code that uses Vite-style env access.
 */
export function getESBuildConfig(): ESBuildConfig {
	return {
		platform: "node",
		external: ["node:*", ...builtinModules],
		define: {
			// Node.js doesn't support import.meta.env, alias to process.env
			"import.meta.env": "process.env",
		},
	};
}

/**
 * Get platform defaults for config generation.
 *
 * Provides default directories (server, public, tmp) that work
 * out of the box for Node.js deployments.
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
		indexedDB: {
			module: "@b9g/indexeddb/sqlite",
			export: "SQLiteBackend",
			path: "[outdir]/data",
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

	logger.info("Starting Node.js dev server", {workerPath, workers});

	// Dynamic import - keeps NodePlatform class out of prod bundle
	const {default: NodePlatform} = await import("./index.js");

	const platform = new NodePlatform({
		port,
		host,
		workers,
	});

	// Register the worker
	await platform.serviceWorker.register(workerPath);
	await platform.serviceWorker.ready;

	// Start HTTP server
	await platform.listen();

	logger.info("Node.js dev server ready");

	const url = `http://${host}:${port}`;

	return {
		url,

		async reload(newWorkerPath: string) {
			logger.info("Reloading workers", {workerPath: newWorkerPath});
			await platform.serviceWorker.reloadWorkers(newWorkerPath);
			logger.info("Workers reloaded");
		},

		async close() {
			logger.info("Stopping Node.js dev server");
			// Use dispose() to terminate workers, not just close HTTP server
			await platform.dispose();
		},
	};
}
