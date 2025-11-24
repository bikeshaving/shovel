/**
 * Shovel Production Server
 * Uses platform abstraction for multi-worker ServiceWorker runtime
 *
 * Run with: node index.js (Node.js) or bun index.js (Bun)
 */

import {getLogger} from "@logtape/logtape";

const logger = getLogger(["worker"]);

// Platform-specific imports - use static imports so esbuild can bundle them
declare const PLATFORM: string;
let Platform: any;
if (PLATFORM === "bun") {
	Platform = (await import("@b9g/platform-bun")).default;
} else {
	Platform = (await import("@b9g/platform-node")).default;
}

// Configuration from environment
const PORT = parseInt(process.env.PORT || "8080", 10);
const HOST = process.env.HOST || "0.0.0.0";

logger.info("Starting production server", {});
logger.info("Workers", {count: WORKER_COUNT});

// Create platform instance
const platform = new Platform();

// Get the path to the user's ServiceWorker code
// Convert file:// URL to file path for loadServiceWorker
const userCodeUrl = new URL("./server.js", import.meta.url);
const userCodePath = userCodeUrl.pathname;

// Load ServiceWorker with worker pool
const serviceWorker = await platform.loadServiceWorker(userCodePath, {
	workerCount: WORKER_COUNT,
});

// Create HTTP server
const server = platform.createServer(serviceWorker.handleRequest, {
	port: PORT,
	host: HOST,
});

await server.listen();
logger.info("Server running", {url: `http://${HOST}:${PORT}`});
logger.info("Load balancing", {workers: WORKER_COUNT});

// Graceful shutdown
const shutdown = async () => {
	logger.info("Shutting down server", {});
	await serviceWorker.dispose();
	await platform.dispose();
	await server.close();
	logger.info("Server stopped", {});
	process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
