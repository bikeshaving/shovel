/**
 * @b9g/platform-node - Node.js platform adapter for Shovel
 *
 * Provides hot reloading, ESBuild integration, and optimized caching for Node.js environments.
 */

// Node.js built-ins
import * as HTTP from "node:http";
import {builtinModules} from "node:module";
import {tmpdir} from "node:os";
import * as Path from "node:path";

// External packages
import {getLogger} from "@logtape/logtape";

// Internal @b9g/* packages
import {CustomCacheStorage} from "@b9g/cache";
import {MemoryCache} from "@b9g/cache/memory";
import {CustomDirectoryStorage} from "@b9g/filesystem";
import {NodeFSDirectory} from "@b9g/filesystem/node-fs";
import {InternalServerError, isHTTPError, HTTPError} from "@b9g/http-errors";
import {
	BasePlatform,
	type PlatformConfig,
	type PlatformDefaults,
	type Handler,
	type Server,
	type ServerOptions,
	type PlatformESBuildConfig,
	type EntryPoints,
	ServiceWorkerPool,
	CustomLoggerStorage,
	CustomDatabaseStorage,
	createDatabaseFactory,
	mergeConfigWithDefaults,
} from "@b9g/platform";
import {
	ShovelServiceWorkerRegistration,
	kServiceWorker,
	createCacheFactory,
	createDirectoryFactory,
	type ShovelConfig,
} from "@b9g/platform/runtime";

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
	#cacheStorage?: CustomCacheStorage;
	#registration?: ShovelServiceWorkerRegistration;
	#readyPromise: Promise<ServiceWorkerRegistration>;
	#readyResolve?: (registration: ServiceWorkerRegistration) => void;

	// Standard ServiceWorkerContainer properties
	readonly controller: ServiceWorker | null;
	oncontrollerchange: ((ev: Event) => unknown) | null;
	onmessage: ((ev: MessageEvent) => unknown) | null;
	onmessageerror: ((ev: MessageEvent) => unknown) | null;

	constructor(platform: NodePlatform) {
		super();
		this.#platform = platform;
		this.#readyPromise = new Promise((resolve) => {
			this.#readyResolve = resolve;
		});
		this.controller = null;
		this.oncontrollerchange = null;
		this.onmessage = null;
		this.onmessageerror = null;
	}

	/**
	 * Register a ServiceWorker script
	 * Spawns worker threads and runs lifecycle
	 */
	async register(
		scriptURL: string | URL,
		options?: RegistrationOptions,
	): Promise<ServiceWorkerRegistration> {
		const urlStr =
			typeof scriptURL === "string" ? scriptURL : scriptURL.toString();
		const scope = options?.scope ?? "/";

		// Convert file:// URL to filesystem path, or resolve relative path
		let entryPath: string;
		if (urlStr.startsWith("file://")) {
			// Use URL to properly parse the file:// URL
			entryPath = new URL(urlStr).pathname;
		} else {
			entryPath = Path.resolve(this.#platform.options.cwd, urlStr);
		}

		// Try to load config.js for cache coordination (exists in built output)
		let config = this.#platform.options.config;
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
		if (!this.#cacheStorage && config?.caches) {
			this.#cacheStorage = new CustomCacheStorage(
				createCacheFactory({configs: config.caches}),
			);
		}

		// Terminate any existing pool
		if (this.#pool) {
			await this.#pool.terminate();
		}

		// Create worker pool with cache storage
		this.#pool = new ServiceWorkerPool(
			{
				workerCount: this.#platform.options.workers,
				createWorker: (entrypoint) => this.#platform.createWorker(entrypoint),
			},
			entryPath,
			this.#cacheStorage,
		);

		// Initialize workers (waits for ready)
		await this.#pool.init();

		// Create registration to track state
		this.#registration = new ShovelServiceWorkerRegistration(scope, urlStr);
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
		if (
			scope === undefined ||
			scope === "/" ||
			scope === this.#registration?.scope
		) {
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
	 * Internal: Terminate workers and dispose cache storage
	 */
	async terminate(): Promise<void> {
		await this.#pool?.terminate();
		this.#pool = undefined;

		// Dispose cache storage (closes Redis connections, etc.)
		await this.#cacheStorage?.dispose();
		this.#cacheStorage = undefined;
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
	async createWorker(entrypoint: string): Promise<Worker> {
		const {Worker: NodeWebWorker} = await import("@b9g/node-webworker");
		// Cast to Worker - our shim implements the core functionality but not all Web Worker APIs
		return new NodeWebWorker(entrypoint) as unknown as Worker;
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
	 * Create cache storage for Node.js
	 *
	 * Default: MemoryCache (in-process LRU cache).
	 * Override via shovel.json caches config.
	 * Note: Used for dev/testing - production uses generated config module.
	 */
	async createCaches(): Promise<CustomCacheStorage> {
		const defaults = {default: {impl: MemoryCache}};
		const configs = mergeConfigWithDefaults(
			defaults,
			this.#options.config?.caches,
		);
		return new CustomCacheStorage(createCacheFactory({configs}));
	}

	/**
	 * Create directory storage for Node.js
	 *
	 * Defaults:
	 * - server: NodeFSDirectory at cwd (app files)
	 * - public: NodeFSDirectory at cwd (static assets)
	 * - tmp: NodeFSDirectory at OS temp dir
	 *
	 * Override via shovel.json directories config.
	 */
	async createDirectories(): Promise<CustomDirectoryStorage> {
		const defaults = {
			server: {impl: NodeFSDirectory, path: this.#options.cwd},
			public: {impl: NodeFSDirectory, path: this.#options.cwd},
			tmp: {impl: NodeFSDirectory, path: tmpdir()},
		};
		const configs = mergeConfigWithDefaults(
			defaults,
			this.#options.config?.directories,
		);
		return new CustomDirectoryStorage(createDirectoryFactory(configs));
	}

	/**
	 * Create logger storage for Node.js
	 *
	 * Uses LogTape for structured logging.
	 */
	async createLoggers(): Promise<CustomLoggerStorage> {
		return new CustomLoggerStorage((categories) => getLogger(categories));
	}

	/**
	 * Create database storage for Node.js
	 *
	 * Returns undefined if no databases configured in shovel.json.
	 * Supports SQLite via better-sqlite3.
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
	 * @deprecated Use serviceWorker.reloadWorkers() instead
	 * @param entrypoint - Path to the new entrypoint (hashed filename)
	 */
	async reloadWorkers(entrypoint: string): Promise<void> {
		await this.serviceWorker.reloadWorkers(entrypoint);
	}

	/**
	 * Get entry points for bundling.
	 *
	 * Development mode:
	 * - worker.js: Single worker with message loop (develop command acts as supervisor)
	 *
	 * Production mode:
	 * - index.js: Supervisor that spawns workers and owns the HTTP server
	 * - worker.js: Worker that handles requests via message loop
	 */
	getEntryPoints(
		userEntryPath: string,
		mode: "development" | "production",
	): EntryPoints {
		// Worker code is shared between dev and prod (message loop pattern)
		const workerCode = `// Node.js Worker
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

		if (mode === "development") {
			// Development: single worker file (develop command manages the process)
			return {worker: workerCode};
		}

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
		// Close server first
		await this.close();

		// Dispose ServiceWorker container (terminates workers, closes cache storage)
		await this.serviceWorker.terminate();

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
