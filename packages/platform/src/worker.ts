/**
 * Worker Entry Point for MultiThreadedRuntime
 *
 * This is the explicit entry point for worker threads spawned by MultiThreadedRuntime.
 * It sets up message handling and initializes the ServiceWorker runtime.
 *
 * This file is loaded directly as a Worker script - no detection needed.
 *
 * BOOTSTRAP ORDER:
 * 1. Create placeholder caches/directories with deferred factories
 * 2. Create and install ServiceWorkerGlobals (provides `self`, `addEventListener`, etc.)
 * 3. Set up message handlers using `self.addEventListener`
 * 4. Wait for "init" message to configure factories with real config
 * 5. Wait for "load" message to load and activate ServiceWorker
 */

import {resolve} from "path";
import {getLogger} from "@logtape/logtape";
import {CustomDirectoryStorage, type DirectoryFactory} from "@b9g/filesystem";
import {CustomCacheStorage, type CacheFactory, Cache} from "@b9g/cache";
import {handleCacheResponse, PostMessageCache} from "@b9g/cache/postmessage";
import {
	ServiceWorkerGlobals,
	ShovelServiceWorkerRegistration,
	ShovelFetchEvent,
	CustomLoggerStorage,
	configureLogging,
	type CacheConfig,
	type DirectoryConfig,
	type ShovelConfig,
} from "./runtime.js";
import type {
	WorkerMessage,
	WorkerInitMessage,
	WorkerLoadMessage,
	WorkerRequest,
	WorkerResponse,
	WorkerErrorMessage,
} from "./index.js";

// ============================================================================
// Pattern Matching
// ============================================================================

/**
 * Match a name against pattern-keyed config
 * Patterns use glob-like syntax (* for wildcards)
 */
function matchPattern<T>(
	name: string,
	patterns: Record<string, T> | undefined,
): T | undefined {
	if (!patterns) return undefined;

	// Exact match first
	if (patterns[name]) return patterns[name];

	// Try pattern matching
	for (const [pattern, value] of Object.entries(patterns)) {
		if (pattern.includes("*")) {
			const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
			if (regex.test(name)) return value;
		}
	}

	return undefined;
}

function getCacheConfig(config: ShovelConfig, name: string): CacheConfig {
	return matchPattern(name, config.caches) || {};
}

function getDirectoryConfig(
	config: ShovelConfig,
	name: string,
): DirectoryConfig {
	return matchPattern(name, config.directories) || {};
}

// ============================================================================
// Directory Factory
// ============================================================================

// Well-known directory path conventions
const WELL_KNOWN_DIRECTORY_PATHS: Record<string, (baseDir: string) => string> =
	{
		static: (baseDir) => resolve(baseDir, "../static"),
		server: (baseDir) => baseDir,
	};

const BUILTIN_DIRECTORY_PROVIDERS: Record<string, string> = {
	"node-fs": "@b9g/filesystem/node-fs.js",
	memory: "@b9g/filesystem/memory.js",
	s3: "@b9g/filesystem-s3",
};

export interface DirectoryFactoryOptions {
	/** Base directory for path resolution (entrypoint directory) - REQUIRED */
	baseDir: string;
	/** Shovel configuration for overrides */
	config?: ShovelConfig;
}

/**
 * Creates a directory factory function for CustomDirectoryStorage.
 */
export function createDirectoryFactory(options: DirectoryFactoryOptions) {
	const {baseDir, config} = options;

	return async (name: string): Promise<FileSystemDirectoryHandle> => {
		const dirConfig = config ? getDirectoryConfig(config, name) : {};

		// Determine directory path: config override > well-known > default convention
		let dirPath: string;
		if (dirConfig.path) {
			dirPath = String(dirConfig.path);
		} else if (WELL_KNOWN_DIRECTORY_PATHS[name]) {
			dirPath = WELL_KNOWN_DIRECTORY_PATHS[name](baseDir);
		} else {
			dirPath = resolve(baseDir, `../${name}`);
		}

		const provider = String(dirConfig.provider || "node-fs");
		const modulePath = BUILTIN_DIRECTORY_PROVIDERS[provider] || provider;

		// Special handling for built-in node-fs directory (most common case)
		if (modulePath === "@b9g/filesystem/node-fs.js") {
			const {NodeFSDirectory} = await import("@b9g/filesystem/node-fs.js");
			return new NodeFSDirectory(dirPath);
		}

		// Special handling for built-in memory directory
		if (modulePath === "@b9g/filesystem/memory.js") {
			const {MemoryDirectory} = await import("@b9g/filesystem/memory.js");
			return new MemoryDirectory(name);
		}

		// Dynamic import for all other providers
		const module = await import(modulePath);
		const DirectoryClass =
			module.default ||
			module.S3Directory ||
			module.Directory ||
			Object.values(module).find(
				(v: any) => typeof v === "function" && v.name?.includes("Directory"),
			);

		if (!DirectoryClass) {
			throw new Error(
				`Directory module "${modulePath}" does not export a valid directory class.`,
			);
		}

		const {provider: _, path: __, ...dirOptions} = dirConfig;
		return new DirectoryClass(name, {path: dirPath, ...dirOptions});
	};
}

// ============================================================================
// Cache Factory
// ============================================================================

const BUILTIN_CACHE_PROVIDERS: Record<string, string> = {
	memory: "@b9g/cache/memory.js",
	redis: "@b9g/cache-redis",
};

export interface CacheFactoryOptions {
	/** Shovel configuration for cache settings */
	config?: ShovelConfig;
	/** Default provider when not specified in config. Defaults to "memory". */
	defaultProvider?: string;
	/** If true, use PostMessageCache for memory caches (for workers) */
	usePostMessage?: boolean;
}

/**
 * Creates a cache factory function for CustomCacheStorage.
 */
export function createCacheFactory(options: CacheFactoryOptions = {}) {
	const {config, defaultProvider = "memory", usePostMessage = false} = options;

	return async (name: string): Promise<Cache> => {
		const cacheConfig = config ? getCacheConfig(config, name) : {};
		const provider = String(cacheConfig.provider || defaultProvider);

		// Native Cloudflare caches
		if (provider === "cloudflare") {
			const nativeCaches =
				(globalThis as any).__cloudflareCaches ?? globalThis.caches;
			if (!nativeCaches) {
				throw new Error(
					"Cloudflare cache provider requires native caches API.",
				);
			}
			return nativeCaches.open(name);
		}

		// For memory caches in workers, use PostMessageCache to forward to main thread
		if (provider === "memory" && usePostMessage) {
			return new PostMessageCache(name);
		}

		const {provider: _, ...cacheOptions} = cacheConfig;
		const modulePath = BUILTIN_CACHE_PROVIDERS[provider] || provider;

		const module = await import(modulePath);
		const CacheClass =
			module.default ||
			module.RedisCache ||
			module.MemoryCache ||
			module.Cache ||
			Object.values(module).find(
				(v: any) => typeof v === "function" && v.name?.includes("Cache"),
			);

		if (!CacheClass) {
			throw new Error(
				`Cache module "${modulePath}" does not export a valid cache class.`,
			);
		}

		return new CacheClass(name, cacheOptions);
	};
}

// ============================================================================
// Worker State
// ============================================================================

const workerId = Math.random().toString(36).substring(2, 8);

// Deferred factory initialization - resolved when initializeRuntime receives config
let resolveCacheFactory: (factory: CacheFactory) => void;
let resolveDirectoryFactory: (factory: DirectoryFactory) => void;
const cacheFactoryPromise = new Promise<CacheFactory>((resolve) => {
	resolveCacheFactory = resolve;
});
const directoryFactoryPromise = new Promise<DirectoryFactory>((resolve) => {
	resolveDirectoryFactory = resolve;
});

// Create storage with async deferred factories (open() waits for init)
const caches = new CustomCacheStorage(async (name) => {
	const factory = await cacheFactoryPromise;
	return factory(name);
});
const directories = new CustomDirectoryStorage(async (name) => {
	const factory = await directoryFactoryPromise;
	return factory(name);
});
const loggers = new CustomLoggerStorage((...categories) =>
	getLogger(categories),
);

// Create and install ServiceWorkerGlobals immediately to provide `self`
// Registration is mutable for hot reload support
let registration = new ShovelServiceWorkerRegistration();
let scope: ServiceWorkerGlobals | null = new ServiceWorkerGlobals({
	registration,
	caches,
	directories,
	loggers,
});
scope.install();

// Logger for worker infrastructure code (outside ServiceWorker context)
const logger = getLogger(["platform"]);

// Runtime state
let sendMessage: (message: WorkerMessage, transfer?: Transferable[]) => void;
let serviceWorkerReady = false;
let loadedEntrypoint: string | null = null;

// ============================================================================
// Message Handling
// ============================================================================

async function handleFetchEvent(request: Request): Promise<Response> {
	if (!serviceWorkerReady) {
		throw new Error("ServiceWorker not ready");
	}

	try {
		const event = new ShovelFetchEvent(request);
		return await registration.handleRequest(event);
	} catch (error) {
		logger.error("[Worker] ServiceWorker request failed: {error}", {error});
		console.error("[Worker] ServiceWorker request failed:", error);
		return new Response("ServiceWorker request failed", {status: 500});
	}
}

async function loadServiceWorker(entrypoint: string): Promise<void> {
	try {
		logger.debug("loadServiceWorker called", {entrypoint, loadedEntrypoint});

		logger.info("[Worker] Loading from", {entrypoint});

		if (loadedEntrypoint !== null && loadedEntrypoint !== entrypoint) {
			logger.info(
				`[Worker] Hot reload detected: ${loadedEntrypoint} -> ${entrypoint}`,
			);
			logger.info("[Worker] Creating completely fresh ServiceWorker context");

			// Create a completely new runtime instance with fresh registration
			registration = new ShovelServiceWorkerRegistration();
			scope = new ServiceWorkerGlobals({
				registration,
				caches,
				directories,
				loggers,
			});
			scope.install();
		}

		loadedEntrypoint = entrypoint;

		// Import the ServiceWorker module
		const app = await import(entrypoint);
		logger.debug("[Worker] ServiceWorker module loaded", {
			exports: Object.keys(app),
		});

		// Run lifecycle events
		logger.info("[Worker] Running install event");
		await registration.install();

		logger.info("[Worker] Running activate event");
		await registration.activate();

		serviceWorkerReady = true;
		logger.info("[Worker] ServiceWorker ready", {entrypoint});
	} catch (error) {
		logger.error("[Worker] Failed to load ServiceWorker: {error}", {
			error,
			entrypoint,
		});
		serviceWorkerReady = false;
		throw error;
	}
}

async function initializeRuntime(config: any, baseDir: string): Promise<void> {
	try {
		// Reconfigure logging if config specifies logging options
		if (config?.logging) {
			await configureLogging(config.logging, {reset: true});
		}

		logger.info(`[Worker-${workerId}] Initializing runtime`, {config, baseDir});

		// Resolve the deferred factories - this unblocks any pending caches.open() / directories.open() calls
		logger.info(`[Worker-${workerId}] Configuring cache factory`);
		resolveCacheFactory(createCacheFactory({config, usePostMessage: true}));

		logger.info(`[Worker-${workerId}] Configuring directory factory`);
		resolveDirectoryFactory(createDirectoryFactory({baseDir, config}));

		logger.info(`[Worker-${workerId}] Runtime initialized successfully`);
	} catch (error) {
		logger.error(`[Worker-${workerId}] Failed to initialize runtime: {error}`, {
			error,
		});
		throw error;
	}
}

async function handleMessage(message: WorkerMessage): Promise<void> {
	try {
		logger.info(`[Worker-${workerId}] Received message`, {type: message.type});

		if (message.type === "init") {
			const initMsg = message as WorkerInitMessage;
			await initializeRuntime(initMsg.config, initMsg.baseDir);
			logger.info(`[Worker-${workerId}] Sending initialized message`);
			sendMessage({type: "initialized"});
		} else if (message.type === "load") {
			const loadMsg = message as WorkerLoadMessage;
			await loadServiceWorker(loadMsg.entrypoint);
			sendMessage({type: "ready", entrypoint: loadMsg.entrypoint});
		} else if (message.type === "request") {
			const reqMsg = message as WorkerRequest;

			const request = new Request(reqMsg.request.url, {
				method: reqMsg.request.method,
				headers: reqMsg.request.headers,
				body: reqMsg.request.body,
			});

			const response = await handleFetchEvent(request);

			// Use arrayBuffer for zero-copy transfer
			const body = await response.arrayBuffer();

			// Ensure Content-Type is preserved
			const headers = Object.fromEntries(response.headers.entries());
			if (!headers["Content-Type"] && !headers["content-type"]) {
				headers["Content-Type"] = "text/plain; charset=utf-8";
			}

			const responseMsg: WorkerResponse = {
				type: "response",
				response: {
					status: response.status,
					statusText: response.statusText,
					headers,
					body,
				},
				requestID: reqMsg.requestID,
			};
			// Transfer the ArrayBuffer (zero-copy)
			sendMessage(responseMsg, [body]);
		}
		// Ignore other message types (cache messages handled by PostMessageCache)
	} catch (error) {
		const errorMsg: WorkerErrorMessage = {
			type: "error",
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
			requestID: (message as any).requestID,
		};
		sendMessage(errorMsg);
	}
}

// ============================================================================
// Worker Initialization - Runs unconditionally when this file is loaded
// ============================================================================

// Set up message handling via addEventListener
// ServiceWorkerGlobals delegates non-ServiceWorker events (like "message") to the native handler
self.addEventListener("message", (event: MessageEvent) => {
	const msg = event.data;
	// Forward cache responses directly to PostMessageCache handler
	if (msg?.type === "cache:response" || msg?.type === "cache:error") {
		logger.debug(`[Worker-${workerId}] Forwarding cache message`, {
			type: msg.type,
			requestID: msg.requestID,
		});
		handleCacheResponse(msg);
		return;
	}
	void handleMessage(event.data);
});

// Set up sendMessage function
sendMessage = (message: WorkerMessage, transfer?: Transferable[]) => {
	if (transfer && transfer.length > 0) {
		postMessage(message, transfer);
	} else {
		postMessage(message);
	}
};

// Signal that the worker is ready
sendMessage({type: "worker-ready"});
