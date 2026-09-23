/**
 * @b9g/platform-bun - Bun platform adapter for Shovel
 *
 * Provides built-in TypeScript/JSX support and simplified server setup for Bun environments.
 */

// Node.js built-ins (Bun is Node-compatible)
import {builtinModules} from "node:module";
import {tmpdir} from "node:os";
import * as Path from "node:path";

// Internal @b9g/* packages
import {CustomCacheStorage} from "@b9g/cache";
import {InternalServerError, isHTTPError} from "@b9g/http-errors";
import type {HTTPError} from "@b9g/http-errors";
import {
	type EntryPoints,
	type Handler,
	type PlatformDefaults,
	type PlatformESBuildConfig,
	type Server,
	type ServerOptions,
	ServiceWorkerPool,
} from "@b9g/platform";
import {
	createCacheFactory,
	kServiceWorker,
	type ShovelConfig,
	ShovelServiceWorkerRegistration,
} from "@b9g/platform/runtime";
// External packages
import {getLogger} from "@logtape/logtape";

const logger = getLogger(["shovel", "platform"]);

// ============================================================================
// TYPES
// ============================================================================

export interface BunPlatformOptions {

	/** Port for development server (default: 7777) */
	port?: number;

	/** Host for development server (default: localhost) */
	host?: string;

	/** Working directory for file resolution */
	cwd?: string;

	/** Number of worker threads (default: 1) */
	workers?: number;

	/** Shovel configuration (caches, directories, etc.) */
	config?: ShovelConfig;
}

// ============================================================================
// SERVICE WORKER CONTAINER
// ============================================================================

const kPlatform = Symbol("platform");
const kPool = Symbol("pool");
const kCacheStorage = Symbol("cacheStorage");
const kRegistration = Symbol("registration");
const kReadyPromise = Symbol("readyPromise");
const kReadyResolve = Symbol("readyResolve");

export interface BunServiceWorkerContainer {
	[kPlatform]: BunPlatform;
	[kPool]?: ServiceWorkerPool;
	[kCacheStorage]?: CustomCacheStorage;
	[kRegistration]?: ShovelServiceWorkerRegistration;
	[kReadyPromise]: Promise<ServiceWorkerRegistration>;
	[kReadyResolve]?: (registration: ServiceWorkerRegistration) => void;
}

/**
 * Bun ServiceWorkerContainer implementation
 * Manages ServiceWorker registrations backed by native Web Workers
 *
 * Note: In Bun's production model, workers handle their own HTTP servers
 * via reusePort, so the supervisor doesn't route requests through the pool.
 * This container is mainly for worker lifecycle management.
 */
export class BunServiceWorkerContainer
	extends EventTarget
	implements ServiceWorkerContainer {
	// Standard ServiceWorkerContainer properties
	readonly controller: ServiceWorker | null;
	oncontrollerchange: ((ev: Event) => unknown) | null;
	onmessage: ((ev: MessageEvent) => unknown) | null;
	onmessageerror: ((ev: MessageEvent) => unknown) | null;

	constructor(platform: BunPlatform) {
		super();
		this[kPlatform] = platform;
		this[kReadyPromise] = new Promise((resolve) => {
			this[kReadyResolve] = resolve;
		});
		this.controller = null;
		this.oncontrollerchange = null;
		this.onmessage = null;
		this.onmessageerror = null;
	}

	/**
	 * Ready promise - resolves when a registration is active
	 */
	get ready(): Promise<ServiceWorkerRegistration> {
		return this[kReadyPromise];
	}

	/**
	 * Internal: Get worker pool for request handling
	 */
	get pool(): ServiceWorkerPool | undefined {
		return this[kPool];
	}

	/**
	 * Register a ServiceWorker script
	 * Spawns Web Workers (each with their own HTTP server in production)
	 */
	async register(
		scriptURL: string | URL,
		options?: RegistrationOptions,
	): Promise<ServiceWorkerRegistration> {
		const urlStr = typeof scriptURL === "string"
			? scriptURL
			: scriptURL.toString();
		const scope = options?.scope ?? "/";

		// Convert file:// URL to filesystem path, or resolve relative path
		let entryPath: string;
		if (urlStr.startsWith("file://")) {
			// Use URL to properly parse the file:// URL
			entryPath = new URL(urlStr).pathname;
		} else {
			entryPath = Path.resolve(this[kPlatform].options.cwd, urlStr);
		}

		// Try to load config.js for cache coordination (exists in built output)
		let config = this[kPlatform].options.config;
		const configPath = Path.join(Path.dirname(entryPath), "config.js");
		try {
			// eslint-disable-next-line no-restricted-syntax -- Import generated config at runtime
			const configModule = await import(configPath);
			config = configModule.config ?? config;
		} catch (error) {
			// config.js doesn't exist - use platform config instead
			logger.debug`Using platform config (no config.js found): ${error}`;
		}

		// Create cache storage for cross-worker coordination
		if (!this[kCacheStorage] && config?.caches) {
			this[kCacheStorage] = new CustomCacheStorage(
				createCacheFactory({configs: config.caches}),
			);
		}

		// Terminate any existing pool
		if (this[kPool]) {
			await this[kPool].terminate();
		}

		// Create worker pool using native Web Workers
		this[kPool] = new ServiceWorkerPool({
			workerCount: this[kPlatform].options.workers,
			createWorker: (entrypoint) => new Worker(entrypoint),
		}, entryPath, this[kCacheStorage]);

		// Initialize workers (waits for ready)
		await this[kPool].init();

		// Create registration to track state
		this[kRegistration] = new ShovelServiceWorkerRegistration(scope, urlStr);
		this[kRegistration][kServiceWorker]._setState("activated");

		// Resolve ready promise
		this[kReadyResolve]?.(this[kRegistration]);

		return this[kRegistration];
	}

	/**
	 * Get registration for scope
	 */
	async getRegistration(
		scope?: string,
	): Promise<ServiceWorkerRegistration | undefined> {
		if (
			scope === undefined ||
			scope === "/" ||
			scope === this[kRegistration]?.scope
		) {
			return this[kRegistration];
		}
		return undefined;
	}

	/**
	 * Get all registrations
	 */
	async getRegistrations(): Promise<readonly ServiceWorkerRegistration[]> {
		return this[kRegistration] ? [this[kRegistration]] : [];
	}

	/**
	 * Start receiving messages (no-op in server context)
	 */
	startMessages(): void {
		// No-op
	}

	/**
	 * Internal: Terminate workers and dispose cache storage
	 */
	async terminate(): Promise<void> {
		await this[kPool]?.terminate();
		this[kPool] = undefined;

		// Dispose cache storage (closes Redis connections, etc.)
		await this[kCacheStorage]?.dispose();
		this[kCacheStorage] = undefined;
	}

	/**
	 * Internal: Reload workers (for hot reload)
	 */
	async reloadWorkers(entrypoint: string): Promise<void> {
		await this[kPool]?.reloadWorkers(entrypoint);
	}
}

// ============================================================================
// IMPLEMENTATION
// ============================================================================

const kOptions = Symbol("options");
const kServer = Symbol("server");

export interface BunPlatform {
	[kOptions]: {
		port: number;
		host: string;
		cwd: string;
		workers: number;
		config?: ShovelConfig;
	};
	[kServer]?: Server;
}

/**
 * Bun platform implementation
 * ServiceWorker entrypoint loader for Bun with native TypeScript/JSX support
 */
export class BunPlatform {
	readonly name: string;
	readonly serviceWorker: BunServiceWorkerContainer;

	constructor(options: BunPlatformOptions = {}) {
		this.name = "bun";
		// eslint-disable-next-line no-restricted-properties -- Platform adapter entry point
		const cwd = options.cwd || process.cwd();

		this[kOptions] = {
			port: options.port ?? 7777,
			host: options.host ?? "localhost",
			workers: options.workers ?? 1,
			cwd,
			config: options.config,
		};

		this.serviceWorker = new BunServiceWorkerContainer(this);
	}

	/**
	 * Get options for testing
	 */
	get options(): {
		port: number;
		host: string;
		cwd: string;
		workers: number;
		config?: ShovelConfig;
	} {
		return this[kOptions];
	}

	/**
	 * Create HTTP server using Bun.serve
	 */
	createServer(handler: Handler, options: ServerOptions = {}): Server {
		const requestedPort = options.port ?? this[kOptions].port;
		const hostname = options.host ?? this[kOptions].host;
		const reusePort = options.reusePort ?? false;

		// Bun.serve is much simpler than Node.js
		const server = Bun.serve({
			port: requestedPort,
			hostname,
			reusePort,
			async fetch(request) {
				try {
					return await handler(request);
				} catch (error) {
					const err = error instanceof Error ? error : new Error(String(error));

					// Convert to HTTPError for consistent response format
					const httpError = isHTTPError(error)
						? (error as HTTPError)
						: new InternalServerError(err.message, {cause: err});

					// Log at appropriate level: warn for 4xx (client errors), error for 5xx (server errors)
					if (httpError.status >= 500) {
						logger.error("Request error: {error}", {error: err});
					} else {
						logger.warn("Request error: {status} {error}", {
							status: httpError.status,
							error: err,
						});
					}

					// Fails closed: an unset MODE must not leak stack traces.
					const isDev = import.meta.env?.MODE === "development";
					return httpError.toResponse(isDev);
				}
			},
		});

		// Get the actual port (important when port 0 was requested)
		// server.port is always defined after Bun.serve() returns
		const actualPort = server.port as number;

		return {
			async listen() {
				logger.info("Bun server running", {
					url: `http://${hostname}:${actualPort}`,
				});
			},
			async close() {
				server.stop();
			},
			address: () => ({port: actualPort, host: hostname}),
			get url() {
				return `http://${hostname}:${actualPort}`;
			},
			get ready() {
				return true; // Bun.serve starts immediately
			},
		};
	}

	/**
	 * Start listening for connections using pool's handlers
	 */
	async listen(): Promise<Server> {
		const pool = this.serviceWorker.pool;
		if (!pool) {
			throw new Error(
				"No ServiceWorker registered - call serviceWorker.register() first",
			);
		}

		this[kServer] = this.createServer(
			(request) => pool.handleRequest(request),
			{port: this[kOptions].port, host: this[kOptions].host},
		);
		await this[kServer].listen();
		return this[kServer];
	}

	/**
	 * Close the server
	 */
	async close(): Promise<void> {
		await this[kServer]?.close();
		this[kServer] = undefined;
	}

	/**
	 * Reload workers for hot reloading (called by CLI)
	 * @param entrypoint - Path to the new entrypoint (hashed filename)
	 */
	async reloadWorkers(entrypoint: string): Promise<void> {
		await this.serviceWorker.reloadWorkers(entrypoint);
	}

	/**
	 * Get entry points for bundling.
	 *
	 * Development mode:
	 * - worker.js: Single worker with HTTP server (develop command manages process)
	 *
	 * Production mode:
	 * - index.js: Supervisor that spawns workers and handles signals
	 * - worker.js: Worker with its own HTTP server (uses reusePort for multi-worker)
	 *
	 * Unlike Node.js, Bun workers each bind their own server with reusePort,
	 * allowing the OS to load-balance across workers without message passing overhead.
	 */
	getEntryPoints(
		userEntryPath: string,
		mode: "development" | "production",
	): EntryPoints {
		// Worker code for production (with message handling for supervisor communication)
		const prodWorkerCode = `// Bun Production Worker
import BunPlatform from "@b9g/platform-bun";
import {getLogger, configureLogging, initWorkerRuntime, runLifecycle, dispatchRequest, setBroadcastChannelRelay, deliverBroadcastMessage} from "@b9g/platform/runtime";
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
await import("${userEntryPath}");

// Run ServiceWorker lifecycle (stage from config.lifecycle if present)
await runLifecycle(registration, config.lifecycle?.stage);

// Start server (skip in lifecycle-only mode)
if (!config.lifecycle) {
	const platform = new BunPlatform({port: config.port, host: config.host});
	server = platform.createServer(
		(request) => dispatchRequest(registration, request),
		{reusePort: config.workers > 1},
	);
	await server.listen();
}

postMessage({type: "ready"});
logger.info("Worker started", {port: config.port});
`;

		// Development worker (simpler, managed by develop command via message loop)
		const devWorkerCode = `// Bun Development Worker
import {configureLogging, initWorkerRuntime, runLifecycle, startWorkerMessageLoop} from "@b9g/platform/runtime";
import {config} from "shovel:config";

await configureLogging(config.logging);

// Initialize worker runtime (installs ServiceWorker globals)
// Single-worker dev mode uses direct cache (no PostMessage overhead)
const {registration, databases} = await initWorkerRuntime({config, usePostMessage: config.workers > 1});

// Import user code (registers event handlers)
await import("${userEntryPath}");

// Run ServiceWorker lifecycle
await runLifecycle(registration);

// Start message loop for request handling (develop command handles HTTP)
startWorkerMessageLoop({registration, databases});
`;

		if (mode === "development") {
			return {worker: devWorkerCode};
		}

		// Production: supervisor + worker
		const supervisorCode = `// Bun Production Supervisor
import {getLogger, configureLogging} from "@b9g/platform/runtime";
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

		return {supervisor: supervisorCode, worker: prodWorkerCode};
	}

	/**
	 * Get Bun-specific esbuild configuration
	 *
	 * Note: Bun natively supports import.meta.env, so no define alias is needed.
	 * We use platform: "node" since Bun is Node-compatible for module resolution.
	 */
	getESBuildConfig(): PlatformESBuildConfig {
		return {
			platform: "node",
			external: ["node:*", "bun", "bun:*", ...builtinModules],
		};
	}

	/**
	 * Get Bun-specific defaults for config generation
	 *
	 * Provides default directories (server, public, tmp) that work
	 * out of the box for Bun deployments.
	 */
	getDefaults(): PlatformDefaults {
		return {
			caches: {"*": {module: "@b9g/cache/memory", export: "MemoryCache"}},
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

	/**
	 * Dispose of platform resources
	 */
	async dispose(): Promise<void> {
		// Close server
		await this.close();

		// Terminate workers via container
		await this.serviceWorker.terminate();
	}

	// =========================================================================
	// Config Expression Method Overrides
	// =========================================================================

	/**
	 * Get the OS temp directory (Bun-specific implementation using node:os)
	 */
	tmpdir(): string {
		return tmpdir();
	}
}

/**
 * Default export for easy importing
 */
export default BunPlatform;

/**
 * Platform's default cache implementation.
 * Re-exported so config can reference: { module: "@b9g/platform-bun", export: "DefaultCache" }
 */
export {MemoryCache as DefaultCache} from "@b9g/cache/memory";
