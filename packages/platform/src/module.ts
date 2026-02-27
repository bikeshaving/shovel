/**
 * Platform Module Interface
 *
 * Platforms are modules, not classes. Each platform exports functions
 * that the CLI and generated entry code use.
 *
 * Build-time functions: Used by CLI/bundler, never bundled into prod
 * Runtime functions: Imported by generated entry code, bundled into prod
 *
 * This separation enables tree-shaking - dev dependencies like Miniflare
 * never end up in production bundles.
 */

// ============================================================================
// BUILD-TIME TYPES (used by CLI/bundler)
// ============================================================================

/**
 * Entry points returned by getEntryPoints().
 * Maps output filename (without .js) to source code.
 */
export type EntryPoints = Record<string, string>;

/**
 * ESBuild configuration that platforms can customize.
 */
export interface ESBuildConfig {
	/** Target platform: "node" or "browser" */
	platform?: "node" | "browser";
	/** Export conditions for package.json resolution */
	conditions?: string[];
	/** Modules to exclude from bundling */
	external?: string[];
	/** Define replacements */
	define?: Record<string, string>;
}

/**
 * Platform defaults for config generation.
 * Module paths that get statically imported at build time.
 */
export interface PlatformDefaults {
	caches?: Record<
		string,
		{module: string; export?: string; [key: string]: unknown}
	>;
	directories?: Record<
		string,
		{module: string; export?: string; [key: string]: unknown}
	>;
	broadcastChannel?: {module: string; export?: string; [key: string]: unknown};
}

// ============================================================================
// DEV-TIME TYPES (used by CLI develop command)
// ============================================================================

/**
 * Options for creating a dev server.
 */
export interface DevServerOptions {
	/** Port to listen on */
	port: number;
	/** Host to bind to */
	host: string;
	/** Path to the built worker entry */
	workerPath: string;
	/** Number of workers (Node/Bun only) */
	workers?: number;
}

/**
 * Dev server instance returned by createDevServer().
 * Abstracts over Miniflare, worker pools, etc.
 */
export interface DevServer {
	/** Server URL */
	readonly url: string;
	/** Reload workers with new entry */
	reload(workerPath: string): Promise<void>;
	/** Shut down the server */
	close(): Promise<void>;
}

// ============================================================================
// RUNTIME TYPES (used by generated entry code)
// ============================================================================

/**
 * Result from installGlobals().
 */
export interface RuntimeContext {
	/** ServiceWorker registration for dispatching events */
	registration: ServiceWorkerRegistration;
}

/**
 * Server instance for Node/Bun.
 */
export interface Server {
	/** Start listening */
	listen(): Promise<void>;
	/** Stop the server */
	close(): Promise<void>;
	/** Server address */
	readonly url: string;
}

/**
 * Handler function type for HTTP requests.
 */
export type RequestHandler = (request: Request) => Response | Promise<Response>;

/**
 * Fetch handler for Cloudflare Workers.
 * ExecutionContext is Cloudflare-specific, so we use a generic type here.
 */
export type FetchHandler = (
	request: Request,
	env: unknown,
	ctx: {
		waitUntil(promise: Promise<unknown>): void;
		passThroughOnException(): void;
	},
) => Response | Promise<Response>;

// ============================================================================
// PLATFORM MODULE SHAPE
// ============================================================================

/**
 * What a platform module exports.
 *
 * This is not enforced at runtime - it's documentation of the contract.
 * Each platform module should export these functions.
 *
 * Build-time exports (from main module):
 *   - name: string
 *   - getEntryPoints(userPath, mode): EntryPoints
 *   - getESBuildConfig(): ESBuildConfig
 *   - getDefaults(): PlatformDefaults
 *   - createDevServer(options): Promise<DevServer>
 *
 * Runtime exports (from /runtime subpath):
 *   - installGlobals(config): Promise<RuntimeContext>
 *   - Platform-specific: createServer, createFetchHandler, etc.
 */
export interface PlatformModule {
	/** Platform identifier */
	readonly name: string;

	/** Generate entry point code for bundling */
	getEntryPoints(
		userEntryPath: string,
		mode: "development" | "production",
	): EntryPoints;

	/** Get ESBuild configuration for this platform */
	getESBuildConfig(): ESBuildConfig;

	/** Get default configs for caches, directories, etc. */
	getDefaults(): PlatformDefaults;

	/** Create a dev server (imports heavy deps like Miniflare) */
	createDevServer(options: DevServerOptions): Promise<DevServer>;
}

/**
 * What a platform runtime module exports.
 *
 * Each platform's /runtime subpath exports these.
 * The specific functions vary by platform.
 */
export interface PlatformRuntimeModule {
	/** Install ServiceWorker globals (caches, directories, loggers) */
	installGlobals(config: unknown): Promise<RuntimeContext>;
}
