/**
 * @b9g/platform - Platform interface for ServiceWorker entrypoint loading
 *
 * Platform = "ServiceWorker entrypoint loader for JavaScript runtimes"
 * Core responsibility: Take a ServiceWorker-style app file and make it run in this environment.
 */

// Core types and interfaces
export type {
	Platform,
	CacheConfig,
	CacheBackendConfig,
	ServerOptions,
	CorsConfig,
	Handler,
	Server,
	ServiceWorkerOptions,
	ServiceWorkerInstance,
	FilesystemConfig,
	StaticConfig,
	PlatformConfig,
} from "./base-platform.js";

// Base platform class
export {
	BasePlatform,
	CACHE_ALIASES,
	FILESYSTEM_ALIASES,
	resolveCacheAdapter,
	resolveFilesystemAdapter,
} from "./base-platform.js";

// Platform detection types and utilities
export type {PlatformDetection, PlatformRegistry} from "./detection.js";
export {
	detectRuntime,
	detectDevelopmentPlatform,
	detectPlatforms,
	getBestPlatformDetection,
	resolvePlatform,
	createPlatform,
	displayPlatformInfo,
} from "./detection.js";

// ServiceWorker runtime
export {
	type ShovelFetchEvent,
	type ShovelInstallEvent,
	type ShovelActivateEvent,
	type ShovelStaticEvent,
	type BucketStorage as BucketStorageInterface,
} from "./service-worker.js";

// ServiceWorker global scope
export {
	ShovelGlobalScope,
	type ShovelGlobalScopeOptions,
} from "./shovel-global-scope.js";

// ServiceWorker API components
export {ServiceWorkerRegistration} from "./service-worker-api.js";

// Bucket storage
export {CustomBucketStorage, type BucketFactory} from "@b9g/filesystem";

// Platform registry and detection
export {
	platformRegistry,
	detectPlatform,
	getPlatform,
	getPlatformAsync,
} from "./registry.js";

// Utility functions
export {
	parseTTL,
	mergeCacheConfig,
	validateCacheConfig,
	createCorsHeaders,
	mergeHeaders,
	isPreflightRequest,
	createPreflightResponse,
} from "./utils.js";

// File System Access API
export {
	getDirectoryHandle,
	getBucket,
	getFileSystemRoot,
} from "./filesystem.js";

// Worker management
export {
	WorkerPool,
	type PlatformWorker,
	type WorkerPoolOptions,
} from "./worker-pool.js";

// Complete ServiceWorker API type shims
export {
	Client,
	Clients,
	WindowClient,
	ExtendableMessageEvent,
	ServiceWorker,
	ServiceWorkerContainer,
	NavigationPreloadManager,
	Notification,
	NotificationEvent,
	PushEvent,
	PushMessageData,
	SyncEvent,
	ServiceWorkerAPI,
} from "./service-worker-api.js";
