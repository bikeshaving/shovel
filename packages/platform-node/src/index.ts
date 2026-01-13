/**
 * @b9g/platform-node - Node.js platform adapter for Shovel
 *
 * Provides hot reloading, ESBuild integration, and optimized caching for Node.js environments.
 */

import {builtinModules} from "node:module";
import {tmpdir} from "node:os";
import {
	BasePlatform,
	type PlatformConfig,
	type PlatformDefaults,
	type Handler,
	type Server,
	type ServerOptions,
	type ServiceWorkerOptions,
	type ServiceWorkerInstance,
	type PlatformESBuildConfig,
	type ProductionEntryPoints,
	ServiceWorkerPool,
	CustomLoggerStorage,
	CustomDatabaseStorage,
	createDatabaseFactory,
} from "@b9g/platform";
import {
	ShovelServiceWorkerRegistration,
	kServiceWorker,
} from "@b9g/platform/runtime";
import {
	createCacheFactory,
	createDirectoryFactory,
	type ShovelConfig,
} from "@b9g/platform/runtime";
import {CustomCacheStorage} from "@b9g/cache";
import {MemoryCache} from "@b9g/cache/memory";
import {CustomDirectoryStorage} from "@b9g/filesystem";
import {NodeFSDirectory} from "@b9g/filesystem/node-fs";
import {InternalServerError, isHTTPError, HTTPError} from "@b9g/http-errors";
import * as HTTP from "http";
import * as Path from "path";
import {getLogger} from "@logtape/logtape";

const logger = getLogger(["shovel", "platform"]);

// ============================================================================
// TYPES
// ============================================================================

export interface NodePlatformOptions extends PlatformConfig {
	/** Port for development server (default: 3000) */
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

/**
 * Node.js ServiceWorkerContainer implementation
 * Manages ServiceWorker registrations backed by worker threads
 */
export class NodeServiceWorkerContainer
	extends EventTarget
	implements ServiceWorkerContainer
{
	#platform: NodePlatform;
	#pool?: ServiceWorkerPool;
	#registration?: ShovelServiceWorkerRegistration;
	#readyPromise: Promise<ServiceWorkerRegistration>;
	#readyResolve?: (registration: ServiceWorkerRegistration) => void;

	// Standard ServiceWorkerContainer properties
	readonly controller: ServiceWorker | null = null;
	oncontrollerchange: ((ev: Event) => unknown) | null = null;
	onmessage: ((ev: MessageEvent) => unknown) | null = null;
	onmessageerror: ((ev: MessageEvent) => unknown) | null = null;

	constructor(platform: NodePlatform) {
		super();
		this.#platform = platform;
		this.#readyPromise = new Promise((resolve) => {
			this.#readyResolve = resolve;
		});
	}

	/**
	 * Register a ServiceWorker script
	 * Spawns worker threads and runs lifecycle
	 */
	async register(
		scriptURL: string | URL,
		options?: RegistrationOptions,
	): Promise<ServiceWorkerRegistration> {
		const url =
			typeof scriptURL === "string" ? scriptURL : scriptURL.toString();
		const scope = options?.scope ?? "/";

		// Create worker pool
		this.#pool = new ServiceWorkerPool(
			{
				workerCount: this.#platform.options.workers,
				createWorker: (entrypoint) =>
					this.#platform.createWorker(entrypoint),
			},
			url,
		);

		// Initialize workers (waits for ready)
		await this.#pool.init();

		// Create registration to track state
		this.#registration = new ShovelServiceWorkerRegistration(scope, url);
		this.#registration[kServiceWorker]._setState("activated");

		// Resolve ready promise
		this.#readyResolve?.(this.#registration);

		return this.#registration;
	}

	/**
	 * Get registration for scope
	 */
	async getRegistration(
		scope?: string,
	): Promise<ServiceWorkerRegistration | undefined> {
		if (scope === undefined || scope === "/" || scope === this.#registration?.scope) {
			return this.#registration;
		}
		return undefined;
	}

	/**
	 * Get all registrations
	 */
	async getRegistrations(): Promise<readonly ServiceWorkerRegistration[]> {
		return this.#registration ? [this.#registration] : [];
	}

	/**
	 * Start receiving messages (no-op in server context)
	 */
	startMessages(): void {
		// No-op
	}

	/**
	 * Ready promise - resolves when a registration is active
	 */
	get ready(): Promise<ServiceWorkerRegistration> {
		return this.#readyPromise;
	}

	/**
	 * Internal: Get worker pool for request handling
	 */
	get pool(): ServiceWorkerPool | undefined {
		return this.#pool;
	}

	/**
	 * Internal: Terminate workers
	 */
	async terminate(): Promise<void> {
		await this.#pool?.terminate();
		this.#pool = undefined;
	}

	/**
	 * Internal: Reload workers (for hot reload)
	 */
	async reloadWorkers(entrypoint: string): Promise<void> {
		await this.#pool?.reloadWorkers(entrypoint);
	}
}

// ============================================================================
// PLATFORM IMPLEMENTATION
// ============================================================================

/**
 * Node.js platform implementation
 * ServiceWorker entrypoint loader for Node.js with ESBuild VM system
 */
export class NodePlatform extends BasePlatform {
	readonly name: string;
	readonly serviceWorker: NodeServiceWorkerContainer;

	#options: {
		port: number;
		host: string;
		cwd: string;
		workers: number;
		config?: ShovelConfig;
	};
	#workerPool?: ServiceWorkerPool;
	#cacheStorage?: CustomCacheStorage;
	#databaseStorage?: CustomDatabaseStorage;

	#server?: Server;

	constructor(options: NodePlatformOptions = {}) {
		super(options);
		this.name = "node";

		// eslint-disable-next-line no-restricted-properties -- Platform adapter entry point
		const cwd = options.cwd || process.cwd();

		this.#options = {
			port: options.port ?? 3000,
			host: options.host ?? "localhost",
			workers: options.workers ?? 1,
			cwd,
			config: options.config,
		};

		this.serviceWorker = new NodeServiceWorkerContainer(this);
	}

	/**
	 * Create a worker instance for the pool
	 * Can be overridden for testing
	 */
	createWorker(entrypoint: string): Worker {
		const {Worker} = require("@b9g/node-webworker");
		return new Worker(entrypoint);
	}

	/**
	 * Start the HTTP server, routing requests to ServiceWorker
	 */
	async listen(): Promise<Server> {
		const pool = this.serviceWorker.pool;
		if (!pool) {
			throw new Error(
				"No ServiceWorker registered. Call serviceWorker.register() first.",
			);
		}

		this.#server = this.createServer((request) => pool.handleRequest(request));
		await this.#server.listen();
		return this.#server;
	}

	/**
	 * Close the server and terminate workers
	 */
	async close(): Promise<void> {
		await this.#server?.close();
		await this.serviceWorker.terminate();
	}

	/**
	 * Get options for testing
	 */
	get options() {
		return this.#options;
	}

	/**
	 * Get/set worker pool for testing
	 */
	get workerPool() {
		return this.#workerPool;
	}

	set workerPool(pool: ServiceWorkerPool | undefined) {
		this.#workerPool = pool;
	}

	/**
	 * THE MAIN JOB - Load and run a ServiceWorker-style entrypoint in Node.js
	 * Uses Worker threads with coordinated cache storage for isolation and standards compliance
	 */
	async loadServiceWorker(
		entrypoint: string,
		options: ServiceWorkerOptions = {},
	): Promise<ServiceWorkerInstance> {
		const workerCount = options.workerCount ?? this.#options.workers;
		const entryPath = Path.resolve(this.#options.cwd, entrypoint);

		// Try to import the generated config module (built alongside the worker entry)
		// Falls back to platform config if config.js doesn't exist (e.g., for tests)
		let config = this.#options.config;
		const configPath = Path.join(Path.dirname(entryPath), "config.js");
		try {
			// eslint-disable-next-line no-restricted-syntax -- Import generated config at runtime
			const configModule = await import(configPath);
			config = configModule.config ?? config;
		} catch (err) {
			// config.js doesn't exist - use platform config instead
			logger.debug`Using platform config (no config.js): ${err}`;
		}

		// Create shared cache storage from config
		if (!this.#cacheStorage) {
			this.#cacheStorage = new CustomCacheStorage(
				createCacheFactory({
					configs: config?.caches ?? {},
				}),
			);
		}

		// Terminate any existing worker pool
		if (this.#workerPool) {
			await this.#workerPool.terminate();
		}

		logger.debug("Creating ServiceWorker pool", {
			entryPath,
			workerCount,
		});
		this.#workerPool = new ServiceWorkerPool(
			{
				workerCount,
				requestTimeout: 30000,
				cwd: this.#options.cwd,
			},
			entryPath,
			this.#cacheStorage,
		);

		// Initialize workers with dynamic import handling
		// init() creates workers and loads the ServiceWorker code
		await this.#workerPool.init();

		// Capture references for closures
		const workerPool = this.#workerPool;
		const platform = this;

		const instance: ServiceWorkerInstance = {
			runtime: workerPool,
			handleRequest: async (request: Request) => {
				if (!platform.#workerPool) {
					throw new Error("ServiceWorkerPool not initialized");
				}
				return platform.#workerPool.handleRequest(request);
			},
			install: async () => {
				logger.debug("ServiceWorker installed", {
					method: "worker_threads",
				});
			},
			activate: async () => {
				logger.debug("ServiceWorker activated", {
					method: "worker_threads",
				});
			},
			get ready() {
				return workerPool?.ready ?? false;
			},
			dispose: async () => {
				if (platform.#workerPool) {
					await platform.#workerPool.terminate();
					platform.#workerPool = undefined;
				}
				logger.debug("ServiceWorker disposed", {});
			},
		};

		logger.debug("ServiceWorker loaded", {
			features: ["worker_threads", "coordinated_caches"],
		});
		return instance;
	}

	/**
	 * Create cache storage using config from shovel.json
	 * Used for testing - production uses the generated config module
	 * Merges with runtime defaults (actual class references) for fallback behavior
	 */
	async createCaches(): Promise<CustomCacheStorage> {
		// Runtime defaults with actual class references (not module/export strings)
		const runtimeDefaults: Record<string, {impl: any}> = {
			default: {impl: MemoryCache},
		};
		const userCaches = this.#options.config?.caches ?? {};
		// Deep merge per entry so user can override options without losing impl
		const configs: Record<string, any> = {};
		const allNames = new Set([
			...Object.keys(runtimeDefaults),
			...Object.keys(userCaches),
		]);
		for (const name of allNames) {
			configs[name] = {...runtimeDefaults[name], ...userCaches[name]};
		}
		return new CustomCacheStorage(createCacheFactory({configs}));
	}

	/**
	 * Create directory storage using config from shovel.json
	 * Used for testing - production uses the generated config module
	 * Merges with runtime defaults (actual class references) for fallback behavior
	 */
	async createDirectories(): Promise<CustomDirectoryStorage> {
		// Runtime defaults with actual class references (not module/export strings)
		// Note: These are test-time defaults - production uses build-time resolved paths
		const runtimeDefaults: Record<string, {impl: any; path: string}> = {
			server: {impl: NodeFSDirectory, path: this.#options.cwd},
			public: {impl: NodeFSDirectory, path: this.#options.cwd},
			tmp: {impl: NodeFSDirectory, path: tmpdir()},
		};
		const userDirs = this.#options.config?.directories ?? {};
		// Deep merge per entry so user can override options without losing impl
		const configs: Record<string, any> = {};
		const allNames = new Set([
			...Object.keys(runtimeDefaults),
			...Object.keys(userDirs),
		]);
		for (const name of allNames) {
			configs[name] = {...runtimeDefaults[name], ...userDirs[name]};
		}
		return new CustomDirectoryStorage(createDirectoryFactory(configs));
	}

	/**
	 * Create logger storage using config from shovel.json
	 */
	async createLoggers(): Promise<CustomLoggerStorage> {
		return new CustomLoggerStorage((categories) => getLogger(categories));
	}

	/**
	 * Create database storage from declarative config in shovel.json
	 */
	createDatabases(
		configOverride?: NodePlatformOptions["config"],
	): CustomDatabaseStorage | undefined {
		const config = configOverride ?? this.#options.config;
		if (config?.databases && Object.keys(config.databases).length > 0) {
			const factory = createDatabaseFactory(config.databases);
			return new CustomDatabaseStorage(factory);
		}
		return undefined;
	}

	/**
	 * SUPPORTING UTILITY - Create HTTP server for Node.js
	 */
	createServer(handler: Handler, options: ServerOptions = {}): Server {
		const port = options.port ?? this.#options.port;
		const host = options.host ?? this.#options.host;

		// Create HTTP server with Web API Request/Response conversion
		const httpServer = HTTP.createServer(async (req, res) => {
			try {
				// Convert Node.js request to Web API Request
				const url = `http://${req.headers.host}${req.url}`;
				const request = new Request(url, {
					method: req.method,
					headers: req.headers as HeadersInit,
					// Node.js IncomingMessage can be used as body (it's a readable stream)
					body:
						req.method !== "GET" && req.method !== "HEAD"
							? (req as any)
							: undefined,
				});

				// Handle request via provided handler
				const response = await handler(request);

				// Convert Web API Response to Node.js response
				res.statusCode = response.status;
				res.statusMessage = response.statusText;

				// Set headers
				response.headers.forEach((value, key) => {
					res.setHeader(key, value);
				});

				// Stream response body
				if (response.body) {
					const reader = response.body.getReader();
					const pump = async () => {
						const {done, value} = await reader.read();
						if (done) {
							res.end();
						} else {
							res.write(value);
							await pump();
						}
					};
					await pump();
				} else {
					res.end();
				}
			} catch (error) {
				const err = error instanceof Error ? error : new Error(String(error));
				logger.error("Request error: {error}", {error: err});

				// Convert to HTTPError for consistent response format
				const httpError = isHTTPError(error)
					? (error as HTTPError)
					: new InternalServerError(err.message, {cause: err});

				// import.meta.env is aliased to process.env for Node.js builds
				const isDev = import.meta.env?.MODE !== "production";
				const response = httpError.toResponse(isDev);

				// Write response to Node.js res
				res.statusCode = response.status;
				response.headers.forEach((value, key) => {
					res.setHeader(key, value);
				});
				res.end(await response.text());
			}
		});

		let isListening = false;
		let actualPort = port;

		return {
			async listen() {
				return new Promise<void>((resolve, reject) => {
					httpServer.listen(port, host, () => {
						// Get actual assigned port (important when port is 0)
						const addr = httpServer.address();
						if (addr && typeof addr === "object") {
							actualPort = addr.port;
						}
						logger.info("Server started", {
							host,
							port: actualPort,
							url: `http://${host}:${actualPort}`,
						});
						isListening = true;
						resolve();
					});

					httpServer.on("error", (error) => {
						reject(error);
					});
				});
			},
			async close() {
				return new Promise<void>((resolve) => {
					httpServer.close(() => {
						isListening = false;
						resolve();
					});
				});
			},
			address: () => ({port: actualPort, host}),
			get url() {
				return `http://${host}:${actualPort}`;
			},
			get ready() {
				return isListening;
			},
		};
	}

	/**
	 * Reload workers for hot reloading (called by CLI)
	 * @param entrypoint - Path to the new entrypoint (hashed filename)
	 */
	async reloadWorkers(entrypoint: string): Promise<void> {
		if (this.#workerPool) {
			await this.#workerPool.reloadWorkers(entrypoint);
		}
	}

	/**
	 * Get production entry points for bundling.
	 *
	 * Node.js produces two files:
	 * - index.js: Supervisor that spawns workers and owns the HTTP server
	 * - worker.js: Worker that handles requests via message loop
	 */
	getProductionEntryPoints(userEntryPath: string): ProductionEntryPoints {
		// Note: userEntryPath is used as a module specifier for esbuild to resolve,
		// not as a runtime string. It should be quoted but not JSON-escaped.

		// Supervisor: uses platform.serviceWorker for worker management
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

// Start HTTP server
await platform.listen();

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

		// Worker: uses runtime utilities for ServiceWorker lifecycle and message handling
		const workerCode = `// Node.js Production Worker
import {parentPort} from "node:worker_threads";
import {configureLogging, initWorkerRuntime, runLifecycle, startWorkerMessageLoop} from "@b9g/platform/runtime";
import {config} from "shovel:config";

await configureLogging(config.logging);

// Initialize worker runtime (installs ServiceWorker globals)
const {registration, databases} = await initWorkerRuntime({config});

// Import user code (registers event handlers)
await import("${userEntryPath}");

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

		return {
			index: supervisorCode,
			worker: workerCode,
		};
	}

	/**
	 * Get Node.js-specific esbuild configuration
	 *
	 * Note: Node.js doesn't support import.meta.env natively, so we alias it
	 * to process.env for compatibility with code that uses Vite-style env access.
	 */
	getESBuildConfig(): PlatformESBuildConfig {
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
	 * Get Node.js-specific defaults for config generation
	 *
	 * Provides default directories (server, public, tmp) that work
	 * out of the box for Node.js deployments.
	 */
	getDefaults(): PlatformDefaults {
		return {
			caches: {
				default: {
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

	/**
	 * Dispose of platform resources
	 */
	async dispose(): Promise<void> {
		// Dispose worker pool
		if (this.#workerPool) {
			await this.#workerPool.terminate();
			this.#workerPool = undefined;
		}

		// Dispose cache storage (closes Redis connections, etc.)
		if (this.#cacheStorage) {
			await this.#cacheStorage.dispose();
			this.#cacheStorage = undefined;
		}

		// Dispose database storage (closes database connections)
		if (this.#databaseStorage) {
			await this.#databaseStorage.closeAll();
			this.#databaseStorage = undefined;
		}
	}

	// =========================================================================
	// Config Expression Method Overrides
	// =========================================================================

	/**
	 * Get the OS temp directory (Node.js-specific implementation)
	 */
	tmpdir(): string {
		return tmpdir();
	}
}

/**
 * Default export for easy importing
 */
export default NodePlatform;

/**
 * Platform's default cache implementation.
 * Re-exported so config can reference: { module: "@b9g/platform-node", export: "DefaultCache" }
 */
export {MemoryCache as DefaultCache} from "@b9g/cache/memory";
