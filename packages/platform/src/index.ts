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

// ServiceWorker runtime
export {
	ServiceWorkerRuntime,
	createServiceWorkerGlobals,
	type ShovelFetchEvent,
	type ShovelInstallEvent,
	type ShovelActivateEvent,
	type ShovelStaticEvent,
	type DirectoryStorage,
} from "./service-worker.js";

// Directory storage implementation
export {
	PlatformDirectoryStorage,
	createDirectoryStorage,
} from "./directory-storage.js";

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
export {getFileSystemRoot} from "./filesystem.js";
