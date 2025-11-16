#!/usr/bin/env node
/**
 * Shovel Production Server (Single Worker)
 * Self-contained build with bundled dependencies
 */

import {
	ServiceWorkerRegistration,
	ShovelGlobalScope,
} from "@b9g/platform";
import {
	FileSystemRegistry,
	NodeBucket,
	CustomBucketStorage,
} from "@b9g/filesystem";
import {fileURLToPath} from "url";
import {dirname, join} from "path";
import {realpath} from "fs";
import {promisify} from "util";

const realpathAsync = promisify(realpath);

// Production server setup
const registration = new ServiceWorkerRegistration();

// Set up bucket storage - registry-only, no on-demand creation
const executableDir = dirname(fileURLToPath(import.meta.url));
const distDir = dirname(executableDir);

// Register well-known buckets
FileSystemRegistry.register("dist", new NodeBucket(distDir));
// Also register assets bucket (points to dist/assets directory)
FileSystemRegistry.register("assets", new NodeBucket(join(distDir, "assets")));

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

			// Create HTTP server
			const {createServer} = await import("http");
			const PORT = process.env.PORT || 8080;
			const HOST = process.env.HOST || "0.0.0.0";

			const httpServer = createServer(async (req, res) => {
				try {
					const url = `http://${req.headers.host}${req.url}`;
					const request = new Request(url, {
						method: req.method,
						headers: req.headers,
						body:
							req.method !== "GET" && req.method !== "HEAD" ? req : undefined,
					});

					const response = await registration.handleRequest(request);

					res.statusCode = response.status;
					res.statusMessage = response.statusText;
					response.headers.forEach((value, key) => {
						res.setHeader(key, value);
					});

					if (response.body) {
						const reader = response.body.getReader();
						const pump = async () => {
							const {done, value} = await reader.read();
							if (done) {
								res.end();
							} else {
								res.write(value);
								await pump();
							}
						};
						await pump();
					} else {
						res.end();
					}
				} catch (error) {
					console.error("Request error:", error);
					res.statusCode = 500;
					res.setHeader("Content-Type", "text/plain");
					res.end("Internal Server Error");
				}
			});

			httpServer.listen(PORT, HOST, () => {
				console.info(
					`🚀 Single-worker server running at http://${HOST}:${PORT}`,
				);
			});

			// Graceful shutdown
			const shutdown = async () => {
				console.info("\n🛑 Shutting down single-worker server...");
				await new Promise((resolve) => httpServer.close(resolve));
				process.exit(0);
			};

			process.on("SIGINT", shutdown);
			process.on("SIGTERM", shutdown);
		}, 0);
	}
} catch (error) {
	console.error("🚨 Error in main executable check:", error);
}
