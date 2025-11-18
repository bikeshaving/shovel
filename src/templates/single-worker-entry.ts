#!/usr/bin/env node
/**
 * Shovel Production Server (Single Worker)
 * Self-contained build with bundled dependencies
 */

import {
	ShovelServiceWorkerRegistration,
	ShovelGlobalScope,
} from "@b9g/platform";
import {FileSystemRegistry, CustomBucketStorage} from "@b9g/filesystem";
import {fileURLToPath} from "url";
import {dirname, join} from "path";
import {realpath} from "fs";
import {promisify} from "util";

const realpathAsync = promisify(realpath);

// Platform-specific imports
declare const PLATFORM: string;
const platformPackage =
	PLATFORM === "bun" ? "@b9g/platform-bun" : "@b9g/platform-node";
const {default: Platform} = await import(platformPackage);
const platform = new Platform();

// Production server setup
const registration = new ShovelServiceWorkerRegistration();

// Set up bucket storage - registry-only, no on-demand creation
const executableDir = dirname(fileURLToPath(import.meta.url));
const distDir = dirname(executableDir);

// Register well-known buckets using platform-specific bucket implementation
const BucketImpl =
	PLATFORM === "bun"
		? (await import("@b9g/filesystem/bun.js")).BunBucket
		: (await import("@b9g/filesystem/node.js")).NodeBucket;

FileSystemRegistry.register("dist", new BucketImpl(distDir));
// Also register assets bucket (points to dist/assets directory)
FileSystemRegistry.register("assets", new BucketImpl(join(distDir, "assets")));

// Create bucket storage using registry
const buckets = new CustomBucketStorage(async (name) => {
	const registered = FileSystemRegistry.get(name);
	if (registered) return registered;
	throw new Error(
		`Bucket '${name}' not registered. Available buckets: ${FileSystemRegistry.getAdapterNames().join(", ")}`,
	);
});

// Create and install ServiceWorker global scope
const scope = new ShovelGlobalScope({
	registration,
	buckets,
});
scope.install();

// Dynamically import user's ServiceWorker code after globals are set up
await import(USER_ENTRYPOINT);

// Check if this is being run as the main executable
try {
	const currentFile = await realpathAsync(fileURLToPath(import.meta.url));
	const mainFile = await realpathAsync(process.argv[1]);

	if (currentFile === mainFile) {
		// Wait for ServiceWorker to be defined, then start server
		setTimeout(async () => {
			console.info("🔧 Starting single-worker server...");
			await registration.install();
			await registration.activate();

			// Create HTTP server using platform abstraction
			const PORT = parseInt(process.env.PORT || "8080", 10);
			const HOST = process.env.HOST || "0.0.0.0";

			const server = platform.createServer(
				async (request) => {
					return await registration.handleRequest(request);
				},
				{port: PORT, host: HOST},
			);

			await server.listen();
			console.info(`🚀 Single-worker server running at http://${HOST}:${PORT}`);

			// Graceful shutdown
			const shutdown = async () => {
				console.info("\n🛑 Shutting down single-worker server...");
				await server.close();
				process.exit(0);
			};

			process.on("SIGINT", shutdown);
			process.on("SIGTERM", shutdown);
		}, 0);
	}
} catch (error) {
	console.error("🚨 Error in main executable check:", error);
}
