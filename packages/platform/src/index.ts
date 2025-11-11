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
	PlatformDetection,
	PlatformRegistry,
} from "./types.js";

// Base platform class
export {BasePlatform} from "./types.js";

// ServiceWorker runtime
export {
	createServiceWorkerGlobals,
	type ShovelFetchEvent,
	type ShovelInstallEvent,
	type ShovelActivateEvent,
	type ShovelStaticEvent,
	type BucketStorage as BucketStorageInterface,
} from "./service-worker.js";

// ServiceWorker API components
export {ServiceWorkerRegistration} from "./service-worker-api.js";

// Bucket storage implementation
export {PlatformBucketStorage} from "./directory-storage.js";

// Import for local use
import {PlatformBucketStorage} from "./directory-storage.js";

// Bucket storage factory function for backwards compatibility
export function createBucketStorage(rootPath: string = "./dist") {
	return new PlatformBucketStorage(rootPath);
}

// Platform registry and detection
export {
	platformRegistry,
	detectPlatform,
	getPlatform,
	getPlatformAsync,
} from "./registry.js";

// Platform detection utilities
export {
	detectRuntime,
	detectDevelopmentPlatform,
	detectPlatforms,
	getBestPlatformDetection,
	resolvePlatform,
	createPlatform,
	displayPlatformInfo,
} from "./detection.js";

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
	ServiceWorkerRegistration,
	NavigationPreloadManager,
	Notification,
	NotificationEvent,
	PushEvent,
	PushMessageData,
	SyncEvent,
	ServiceWorkerAPI,
} from "./service-worker-api.js";
