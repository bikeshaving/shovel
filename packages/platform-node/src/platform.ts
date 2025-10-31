/**
 * Node.js platform implementation - ServiceWorker entrypoint loader for Node.js
 *
 * Handles the complex ESBuild VM system, hot reloading, and module linking
 * to make ServiceWorker-style apps run in Node.js environments.
 */

import {
	Platform,
	CacheConfig,
	Handler,
	Server,
	ServerOptions,
	ServiceWorkerOptions,
	ServiceWorkerInstance,
} from "@b9g/platform";
import {CacheStorage} from "@b9g/cache/cache-storage";
import {MemoryCache} from "@b9g/cache/memory-cache";
import {FilesystemCache} from "@b9g/cache/filesystem-cache";
import * as Http from "http";
import * as Path from "path";
import {MemoryCacheManager} from "@b9g/shovel/memory-cache-manager";
import {Worker} from "worker_threads";
import {fileURLToPath} from "url";

// ES module dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = Path.dirname(__filename);

export interface NodePlatformOptions {
	/** Enable hot reloading (default: true in development) */
	hotReload?: boolean;
	/** Port for development server (default: 3000) */
	port?: number;
	/** Host for development server (default: localhost) */
	host?: string;
	/** Working directory for file resolution */
	cwd?: string;
}

/**
 * Worker Manager - handles Node.js Worker threads for ServiceWorker execution
 * Uses the worker.js from shovel package
 */
class WorkerManager {
	private workers: Worker[] = [];
	private currentWorker = 0;
	private requestId = 0;
	private pendingRequests = new Map<
		number,
		{resolve: (response: Response) => void; reject: (error: Error) => void}
	>();
	private memoryCacheManager: MemoryCacheManager;
	private options: Required<NodePlatformOptions>;

	constructor(
		cacheStorage: CacheStorage,
		options: Required<NodePlatformOptions>,
		workerCount = 1,
		private entrypoint?: string,
	) {
		this.memoryCacheManager = new MemoryCacheManager();
		this.options = options;
		console.info(
			"[WorkerManager] Constructor called with entrypoint:",
			entrypoint,
		);
		this.initWorkers(workerCount);
	}

	private initWorkers(count: number) {
		for (let i = 0; i < count; i++) {
			this.createWorker();
		}
	}

	private createWorker() {
		// Resolve worker script from shovel package using modern ES module resolution
		let workerScript: string;

		try {
			const workerUrl = import.meta.resolve("@b9g/shovel/worker.js");
			workerScript = fileURLToPath(workerUrl);
		} catch (error) {
			throw new Error(
				`Could not resolve @b9g/shovel/worker.js: ${error.message}`,
			);
		}

		const worker = new Worker(workerScript);

		// Node.js Worker thread message handling
		worker.on("message", (message) => {
			// Handle memory cache operations (only MemoryCache needs coordination)
			if (message.type?.startsWith("cache:")) {
				this.memoryCacheManager.handleMessage(worker, message);
			} else {
				this.handleWorkerMessage(message);
			}
		});

		worker.on("error", (error) => {
			console.error("[Platform-Node] Worker error:", error);
		});

		this.workers.push(worker);
		return worker;
	}

	private handleWorkerMessage(message: any) {
		if (message.type === "response" && message.requestId) {
			const pending = this.pendingRequests.get(message.requestId);
			if (pending) {
				// Reconstruct Response object from serialized data
				const response = new Response(message.response.body, {
					status: message.response.status,
					statusText: message.response.statusText,
					headers: message.response.headers,
				});
				pending.resolve(response);
				this.pendingRequests.delete(message.requestId);
			}
		} else if (message.type === "error" && message.requestId) {
			const pending = this.pendingRequests.get(message.requestId);
			if (pending) {
				pending.reject(new Error(message.error));
				this.pendingRequests.delete(message.requestId);
			}
		} else if (message.type === "ready") {
			console.info(`[Platform-Node] ServiceWorker ready (v${message.version})`);
		} else if (message.type === "worker-ready") {
			console.info("[Platform-Node] Worker initialized");
		}
	}

	/**
	 * Handle HTTP request using round-robin Worker selection
	 */
	async handleRequest(request: Request): Promise<Response> {
		// Round-robin worker selection (ready for pooling)
		const worker = this.workers[this.currentWorker];
		this.currentWorker = (this.currentWorker + 1) % this.workers.length;

		const requestId = ++this.requestId;

		return new Promise((resolve, reject) => {
			// Track pending request
			this.pendingRequests.set(requestId, {resolve, reject});

			// Serialize request for Worker thread (can't clone Request objects)
			worker.postMessage({
				type: "request",
				request: {
					url: request.url,
					method: request.method,
					headers: Object.fromEntries(request.headers.entries()),
					body: request.body,
				},
				requestId,
			});

			// Timeout after 30 seconds
			setTimeout(() => {
				if (this.pendingRequests.has(requestId)) {
					this.pendingRequests.delete(requestId);
					reject(new Error("Request timeout"));
				}
			}, 30000);
		});
	}

	/**
	 * Reload ServiceWorker with new version (hot reload simulation)
	 */
	async reloadWorkers(version = Date.now()): Promise<void> {
		console.info(`[Platform-Node] Reloading ServiceWorker (v${version})`);

		const loadPromises = this.workers.map((worker) => {
			return new Promise<void>((resolve) => {
				const handleReady = (message: any) => {
					if (message.type === "ready" && message.version === version) {
						worker.off("message", handleReady);
						resolve();
					}
				};

				console.info("[Platform-Node] Sending load message:", {
					version,
					entrypoint: this.entrypoint,
				});
				worker.on("message", handleReady);
				worker.postMessage({
					type: "load",
					version,
					entrypoint: this.entrypoint,
				});
			});
		});

		await Promise.all(loadPromises);
		console.info(`[Platform-Node] All Workers reloaded (v${version})`);
	}

	/**
	 * Graceful shutdown
	 */
	async terminate(): Promise<void> {
		const terminatePromises = this.workers.map((worker) => worker.terminate());
		await Promise.allSettled(terminatePromises);
		await this.memoryCacheManager.dispose();
		this.workers = [];
		this.pendingRequests.clear();
	}
}

/**
 * Node.js platform implementation
 * ServiceWorker entrypoint loader for Node.js with ESBuild VM system
 */
export class NodePlatform implements Platform {
	readonly name = "node";

	private options: Required<NodePlatformOptions>;
	private watcher?: Watcher;
	private workerManager?: WorkerManager;
	private cacheStorage?: CacheStorage;

	constructor(options: NodePlatformOptions = {}) {
		this.options = {
			hotReload: process.env.NODE_ENV !== "production",
			port: 3000,
			host: "localhost",
			cwd: process.cwd(),
			...options,
		};
	}

	/**
	 * THE MAIN JOB - Load and run a ServiceWorker-style entrypoint in Node.js
	 * Uses Worker threads with coordinated cache storage for isolation and standards compliance
	 */
	async loadServiceWorker(
		entrypoint: string,
		options: ServiceWorkerOptions = {},
	): Promise<ServiceWorkerInstance> {
		const entryPath = Path.resolve(this.options.cwd, entrypoint);

		// Create shared cache storage if not already created
		if (!this.cacheStorage) {
			this.cacheStorage = this.createCaches(options.caches);
		}

		// Create WorkerManager with shared cache storage
		// Always create a new WorkerManager to ensure correct entrypoint
		if (this.workerManager) {
			await this.workerManager.terminate();
		}
		const workerCount = options.workerCount || 1;
		console.info(
			"[Platform-Node] Creating WorkerManager with entryPath:",
			entryPath,
		);
		this.workerManager = new WorkerManager(
			this.cacheStorage,
			this.options,
			workerCount,
			entryPath,
		);

		// Load ServiceWorker in all workers
		const version = Date.now();
		await this.workerManager.reloadWorkers(version);

		const instance: ServiceWorkerInstance = {
			runtime: this.workerManager,
			handleRequest: async (request: Request) => {
				if (!this.workerManager) {
					throw new Error("WorkerManager not initialized");
				}
				return this.workerManager.handleRequest(request);
			},
			install: async () => {
				console.info(
					"[Platform-Node] ServiceWorker installed via Worker threads",
				);
			},
			activate: async () => {
				console.info(
					"[Platform-Node] ServiceWorker activated via Worker threads",
				);
			},
			collectStaticRoutes: async () => {
				// TODO: Implement static route collection
				return [];
			},
			get ready() {
				return this.workerManager !== undefined;
			},
			dispose: async () => {
				if (this.workerManager) {
					await this.workerManager.terminate();
					this.workerManager = undefined;
				}
				console.info("[Platform-Node] ServiceWorker disposed");
			},
		};

		console.info(
			"[Platform-Node] ServiceWorker loaded with Worker threads and coordinated caches",
		);
		return instance;
	}

	/**
	 * SUPPORTING UTILITY - Create cache storage optimized for Node.js
	 */
	createCaches(config: CacheConfig = {}): CacheStorage {
		const caches = new CacheStorage();

		// Register default caches optimized for Node.js
		caches.register(
			"memory",
			() =>
				new MemoryCache("memory", {
					maxEntries: config.maxEntries || 1000,
					maxSize: config.maxSize || 50 * 1024 * 1024, // 50MB
				}),
		);

		caches.register(
			"filesystem",
			() =>
				new FilesystemCache("filesystem", {
					cacheDir: config.cacheDir || Path.join(this.options.cwd, ".cache"),
					maxEntries: config.maxEntries || 10000,
					maxSize: config.maxSize || 500 * 1024 * 1024, // 500MB
				}),
		);

		return caches;
	}

	/**
	 * SUPPORTING UTILITY - Create HTTP server for Node.js
	 */
	createServer(handler: Handler, options: ServerOptions = {}): Server {
		const port = options.port ?? this.options.port;
		const host = options.host ?? this.options.host;

		// Create HTTP server with Web API Request/Response conversion
		const httpServer = Http.createServer(async (req, res) => {
			try {
				// Convert Node.js request to Web API Request
				const url = `http://${req.headers.host}${req.url}`;
				const request = new Request(url, {
					method: req.method,
					headers: req.headers as HeadersInit,
					body: req.method !== "GET" && req.method !== "HEAD" ? req : undefined,
				});

				// Handle request via provided handler
				const response = await handler(request);

				// Convert Web API Response to Node.js response
				res.statusCode = response.status;
				res.statusMessage = response.statusText;

				// Set headers
				response.headers.forEach((value, key) => {
					res.setHeader(key, value);
				});

				// Stream response body
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
				console.error("[Platform-Node] Request error:", error);
				res.statusCode = 500;
				res.setHeader("Content-Type", "text/plain");
				res.end("Internal Server Error");
			}
		});

		return {
			listen: () => {
				return new Promise<void>((resolve) => {
					httpServer.listen(port, host, () => {
						console.info(`🚀 Server running at http://${host}:${port}`);
						resolve();
					});
				});
			},
			close: () =>
				new Promise<void>((resolve) => {
					httpServer.close(() => resolve());
				}),
			address: () => ({port, host}),
		};
	}

	/**
	 * Dispose of platform resources
	 */
	async dispose(): Promise<void> {
		if (this.watcher) {
			await this.watcher.dispose();
			this.watcher = undefined;
		}

		if (this.workerManager) {
			await this.workerManager.terminate();
			this.workerManager = undefined;
		}
	}
}

/**
 * Create a Node.js platform instance
 */
export function createNodePlatform(
	options?: NodePlatformOptions,
): NodePlatform {
	return new NodePlatform(options);
}

/**
 * Default export for easy importing
 */
export default createNodePlatform;
