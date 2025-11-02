/**
 * @b9g/assets - Universal assets middleware using Web APIs only
 *
 * Runtime middleware for serving assets using the self.dirs ServiceWorker API.
 * Works on all platforms: Node.js, Bun, Cloudflare Workers.
 */

// Runtime middleware (Web APIs only)
export {
	createAssetsMiddleware,
	type AssetsConfig,
	default as assets,
} from "./middleware.js";