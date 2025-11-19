#!/usr/bin/env node
/**
 * Shovel Production Server
 * Uses platform abstraction for multi-worker ServiceWorker runtime
 */

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

console.info("🔧 Starting production server...");
console.info(`⚡ Workers: ${WORKER_COUNT}`);

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
console.info(`🚀 Server running at http://${HOST}:${PORT}`);
console.info(`⚡ Load balancing across ${WORKER_COUNT} workers`);

// Graceful shutdown
const shutdown = async () => {
	console.info("\n🛑 Shutting down server...");
	await serviceWorker.dispose();
	await platform.dispose();
	await server.close();
	console.info("✅ Server stopped");
	process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
