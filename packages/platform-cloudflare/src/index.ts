/**
 * @b9g/platform-cloudflare - Cloudflare Workers platform adapter for Shovel
 *
 * Provides ServiceWorker-native deployment for Cloudflare Workers with KV/R2/D1 integration.
 */

export {
	CloudflarePlatform,
	createCloudflarePlatform,
	type CloudflarePlatformOptions,
} from "./platform.js";
export {createOptionsFromEnv, generateWranglerConfig} from "./wrangler.js";
export {cloudflareWorkerBanner, cloudflareWorkerFooter} from "./wrapper.js";

// Re-export common platform types
export type {
	Platform,
	CacheConfig,
	StaticConfig,
	Handler,
	Server,
	ServerOptions,
	ServiceWorkerOptions,
	ServiceWorkerInstance,
} from "@b9g/platform";
