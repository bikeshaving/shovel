#!/usr/bin/env node
/**
 * Shovel Production Server (Multi-Worker)
 * Spawns WORKER_COUNT real Worker threads for true concurrency
 */

import {Worker, workerData} from "worker_threads";
import {fileURLToPath} from "url";
import {dirname, join} from "path";

// Platform-specific imports - use static imports so esbuild can bundle them
declare const PLATFORM: string;
let Platform: any;
if (PLATFORM === "bun") {
	Platform = (await import("@b9g/platform-bun")).default;
} else {
	Platform = (await import("@b9g/platform-node")).default;
}
const mainPlatform = new Platform();

// Check if this is being run as the main executable (not a worker thread)
if (!workerData?.isWorker) {
	console.info("🔧 Starting multi-worker server...");
	console.info(`⚡ Spawning ${WORKER_COUNT} worker threads...`);

	const workers: Worker[] = [];
	const workerRequests = new Map<
		number,
		{resolve: (value: Response) => void; reject: (error: Error) => void}
	>();
	let currentWorker = 0;
	let requestId = 0;

	// Get the path to the current script to use as worker script
	const __filename = fileURLToPath(import.meta.url);

	// Create worker threads
	for (let i = 0; i < WORKER_COUNT; i++) {
		const worker = new Worker(__filename, {
			workerData: {
				workerId: i,
				isWorker: true,
			},
		});

		worker.on("message", (message: any) => {
			if (message.type === "worker-ready") {
				console.info(`✅ Worker ${i} ready`);
			} else if (message.type === "response") {
				const pending = workerRequests.get(message.requestId);
				if (pending) {
					workerRequests.delete(message.requestId);

					// Convert serialized response back to Response object
					const response = new Response(message.body, {
						status: message.status,
						statusText: message.statusText,
						headers: new Headers(message.headers),
					});

					pending.resolve(response);
				}
			}
		});

		worker.on("error", (error: Error) => {
			console.error(`❌ Worker ${i} error:`, error);
		});

		workers.push(worker);
	}

	// Round-robin load balancer
	function getNextWorker(): Worker {
		const worker = workers[currentWorker];
		currentWorker = (currentWorker + 1) % workers.length;
		return worker;
	}

	// Handle request via workers
	async function handleRequest(request: Request): Promise<Response> {
		const worker = getNextWorker();
		const reqId = ++requestId;

		// Serialize request body if it exists
		const requestBody = request.body ? await request.text() : null;

		return new Promise((resolve, reject) => {
			workerRequests.set(reqId, {resolve, reject});

			// Serialize request for worker thread
			worker.postMessage({
				type: "request",
				requestId: reqId,
				url: request.url,
				method: request.method,
				headers: Array.from(request.headers.entries()),
				body: requestBody,
			});

			// Timeout after 30 seconds
			setTimeout(() => {
				if (workerRequests.has(reqId)) {
					workerRequests.delete(reqId);
					reject(new Error("Request timeout"));
				}
			}, 30000);
		});
	}

	// Create HTTP server that load balances across workers using platform abstraction
	const PORT = parseInt(process.env.PORT || "8080", 10);
	const HOST = process.env.HOST || "0.0.0.0";

	const server = mainPlatform.createServer(
		async (request) => {
			return await handleRequest(request);
		},
		{port: PORT, host: HOST},
	);

	await server.listen();
	console.info(`🚀 Multi-worker server running at http://${HOST}:${PORT}`);
	console.info(`⚡ Load balancing across ${WORKER_COUNT} workers`);

	// Graceful shutdown
	const shutdown = async () => {
		console.info("\n🛑 Shutting down multi-worker server...");

		// Terminate all workers
		await Promise.all(
			workers.map((worker) => {
				return new Promise<void>((resolve) => {
					worker
						.terminate()
						.then(() => resolve())
						.catch(() => resolve());
				});
			}),
		);

		await server.close();
		console.info("✅ All workers terminated");
		process.exit(0);
	};

	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
}

// WORKER THREAD CODE - this needs to be at top level for imports
import {
	ShovelServiceWorkerRegistration,
	ShovelGlobalScope,
} from "@b9g/platform";
import {FileSystemRegistry, CustomBucketStorage} from "@b9g/filesystem";
import {parentPort} from "worker_threads";

if (workerData?.isWorker && parentPort) {
	console.info(`[Worker ${workerData.workerId}] Starting ServiceWorker...`);

	// Set up ServiceWorker environment in worker thread
	const registration = new ShovelServiceWorkerRegistration();

	// Set up bucket storage - registry-only
	const executableDir = dirname(fileURLToPath(import.meta.url));
	const distDir = dirname(executableDir);

	// Register well-known buckets using platform-specific bucket implementation
	// Both Node and Bun use NodeBucket
	const {NodeBucket} = await import("@b9g/filesystem/node.js");
	const BucketImpl = NodeBucket;

	FileSystemRegistry.register("dist", new BucketImpl(distDir));
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

	// Import user's ServiceWorker code
	// USER_CODE_IMPORT will be replaced during build with actual import statement
	USER_CODE_IMPORT;

	// Initialize ServiceWorker
	await registration.install();
	await registration.activate();

	// Handle messages from main thread
	parentPort.on("message", async (message: any) => {
		if (message.type === "request") {
			try {
				// Reconstruct request object
				const request = new Request(message.url, {
					method: message.method,
					headers: new Headers(message.headers),
					body: message.body,
				});

				const response = await registration.handleRequest(request);

				// Serialize response for main thread
				const responseBody = response.body ? await response.text() : null;

				parentPort!.postMessage({
					type: "response",
					requestId: message.requestId,
					status: response.status,
					statusText: response.statusText,
					headers: Array.from(response.headers.entries()),
					body: responseBody,
				});
			} catch (error) {
				console.error(`[Worker ${workerData.workerId}] Request error:`, error);

				parentPort!.postMessage({
					type: "response",
					requestId: message.requestId,
					status: 500,
					statusText: "Internal Server Error",
					headers: [["Content-Type", "text/plain"]],
					body: "Internal Server Error",
				});
			}
		}
	});

	// Signal that worker is ready
	parentPort.postMessage({type: "worker-ready"});
	console.info(`[Worker ${workerData.workerId}] Ready to handle requests`);
}
