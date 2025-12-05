/**
 * Worker Entry Point for MultiThreadedRuntime
 *
 * This is the explicit entry point for worker threads spawned by MultiThreadedRuntime.
 * It sets up message handling and initializes the ServiceWorker runtime.
 *
 * This file is loaded directly as a Worker script - no detection needed.
 *
 * BOOTSTRAP ORDER:
 * 1. Create placeholder caches/buckets with deferred factories
 * 2. Create and install ServiceWorkerGlobals (provides `self`, `addEventListener`, etc.)
 * 3. Set up message handlers using `self.addEventListener`
 * 4. Wait for "init" message to configure factories with real config
 * 5. Wait for "load" message to load and activate ServiceWorker
 */

import {resolve} from "path";
import {getLogger} from "@logtape/logtape";
import {CustomBucketStorage, type BucketFactory} from "@b9g/filesystem";
import {CustomCacheStorage, type CacheFactory, Cache} from "@b9g/cache";
import {handleCacheResponse, PostMessageCache} from "@b9g/cache/postmessage";
import {
	ServiceWorkerGlobals,
	ShovelServiceWorkerRegistration,
	configureLogging,
	type CacheConfig,
	type BucketConfig,
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

function getBucketConfig(config: ShovelConfig, name: string): BucketConfig {
	return matchPattern(name, config.buckets) || {};
}

// ============================================================================
// Bucket Factory
// ============================================================================

// Well-known bucket path conventions
const WELL_KNOWN_BUCKET_PATHS: Record<string, (baseDir: string) => string> = {
	static: (baseDir) => resolve(baseDir, "../static"),
	server: (baseDir) => baseDir,
};

const BUILTIN_BUCKET_PROVIDERS: Record<string, string> = {
	node: "@b9g/filesystem/node.js",
	memory: "@b9g/filesystem/memory.js",
	s3: "@b9g/filesystem-s3",
};

export interface BucketFactoryOptions {
	/** Base directory for path resolution (entrypoint directory) - REQUIRED */
	baseDir: string;
	/** Shovel configuration for overrides */
	config?: ShovelConfig;
}

/**
 * Creates a bucket factory function for CustomBucketStorage.
 */
export function createBucketFactory(options: BucketFactoryOptions) {
	const {baseDir, config} = options;

	return async (name: string): Promise<FileSystemDirectoryHandle> => {
		const bucketConfig = config ? getBucketConfig(config, name) : {};

		// Determine bucket path: config override > well-known > default convention
		let bucketPath: string;
		if (bucketConfig.path) {
			bucketPath = String(bucketConfig.path);
		} else if (WELL_KNOWN_BUCKET_PATHS[name]) {
			bucketPath = WELL_KNOWN_BUCKET_PATHS[name](baseDir);
		} else {
			bucketPath = resolve(baseDir, `../${name}`);
		}

		const provider = String(bucketConfig.provider || "node");
		const modulePath = BUILTIN_BUCKET_PROVIDERS[provider] || provider;

		// Special handling for built-in node bucket (most common case)
		if (modulePath === "@b9g/filesystem/node.js") {
			const {NodeBucket} = await import("@b9g/filesystem/node.js");
			return new NodeBucket(bucketPath);
		}

		// Special handling for built-in memory bucket
		if (modulePath === "@b9g/filesystem/memory.js") {
			const {MemoryBucket} = await import("@b9g/filesystem/memory.js");
			return new MemoryBucket(name);
		}

		// Dynamic import for all other providers
		const module = await import(modulePath);
		const BucketClass =
			module.default ||
			module.S3Bucket ||
			module.Bucket ||
			Object.values(module).find(
				(v: any) => typeof v === "function" && v.name?.includes("Bucket"),
			);

		if (!BucketClass) {
			throw new Error(
				`Bucket module "${modulePath}" does not export a valid bucket class.`,
			);
		}

		const {provider: _, path: __, ...bucketOptions} = bucketConfig;
		return new BucketClass(name, {path: bucketPath, ...bucketOptions});
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
let resolveBucketFactory: (factory: BucketFactory) => void;
const cacheFactoryPromise = new Promise<CacheFactory>((resolve) => {
	resolveCacheFactory = resolve;
});
const bucketFactoryPromise = new Promise<BucketFactory>((resolve) => {
	resolveBucketFactory = resolve;
});

// Create storage with async deferred factories (open() waits for init)
const caches = new CustomCacheStorage(async (name) => {
	const factory = await cacheFactoryPromise;
	return factory(name);
});
const buckets = new CustomBucketStorage(async (name) => {
	const factory = await bucketFactoryPromise;
	return factory(name);
});

// Create and install ServiceWorkerGlobals immediately to provide `self`
// Registration is mutable for hot reload support
let registration = new ShovelServiceWorkerRegistration();
let scope: ServiceWorkerGlobals | null = new ServiceWorkerGlobals({
	registration,
	caches,
	buckets,
});
scope.install();

// Logger is configured in initializeRuntime when we receive the config
const logger = getLogger(["server"]);

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
		return await registration.handleRequest(request);
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
			scope = new ServiceWorkerGlobals({registration, caches, buckets});
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

		// Resolve the deferred factories - this unblocks any pending caches.open() / buckets.open() calls
		logger.info(`[Worker-${workerId}] Configuring cache factory`);
		resolveCacheFactory(createCacheFactory({config, usePostMessage: true}));

		logger.info(`[Worker-${workerId}] Configuring bucket factory`);
		resolveBucketFactory(createBucketFactory({baseDir, config}));

		logger.info(`[Worker-${workerId}] Runtime initialized successfully`);
	} catch (error) {
		logger.error(`[Worker-${workerId}] Failed to initialize runtime`, {error});
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
