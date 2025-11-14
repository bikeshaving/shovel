/**
 * Worker Bootstrap - ServiceWorker execution environment
 *
 * This script runs inside each worker thread to set up the ServiceWorker runtime
 * and handle requests from the main thread via postMessage protocol.
 */

import type {
	WorkerMessage,
	WorkerRequest,
	WorkerResponse,
	WorkerLoadMessage,
	WorkerErrorMessage,
} from "./worker-pool.js";

// Initialize worker environment - Web Worker API only (native or shimmed)
async function initializeWorker() {
	// Use Web Worker globals - works with native Web Workers or web-worker shim
	const messagePort = self;
	const sendMessage = (message: WorkerMessage) => postMessage(message);

	// Handle incoming messages
	onmessage = function (event: MessageEvent) {
		void handleMessage(event.data);
	};

	return {messagePort, sendMessage};
}

// Import platform modules
const {ShovelGlobalScope, ServiceWorkerRegistration, CustomBucketStorage} =
	await import("./index.js");
const {CustomCacheStorage, PostMessageCache} = await import("@b9g/cache");
const {FileSystemRegistry} = await import("@b9g/filesystem");

// Create worker-aware cache storage using PostMessage coordination
const caches: CacheStorage = new CustomCacheStorage((name: string) => {
	return new PostMessageCache(name, {
		maxEntries: 1000,
		maxAge: 60 * 60 * 1000, // 1 hour
	});
});

// Create bucket storage using FileSystemRegistry
const buckets = new CustomBucketStorage(async (name: string) => {
	const registered = FileSystemRegistry.get(name);
	if (registered) return registered;
	throw new Error(`Bucket '${name}' not registered`);
});

// Create ServiceWorker runtime
let registration = new ServiceWorkerRegistration();
let scope = new ShovelGlobalScope({registration, caches, buckets});
scope.install();

let _workerSelf: typeof scope = scope;
let currentApp: any = null;
let serviceWorkerReady = false;
let loadedVersion: number | string | null = null;

async function handleFetchEvent(request: Request): Promise<Response> {
	if (!currentApp || !serviceWorkerReady) {
		throw new Error("ServiceWorker not ready");
	}

	try {
		const response = await registration.handleRequest(request);
		return response;
	} catch (error) {
		console.error("[Worker] ServiceWorker request failed:", error);
		const response = new Response("ServiceWorker request failed", {
			status: 500,
		});
		return response;
	}
}

async function loadServiceWorker(
	version: number | string,
	entrypoint?: string,
): Promise<void> {
	try {
		console.info("[Worker] loadServiceWorker called with:", {
			version,
			entrypoint,
		});

		const entrypointPath =
			process.env.SERVICEWORKER_PATH ||
			entrypoint ||
			`${process.cwd()}/dist/server/server.js`;
		console.info("[Worker] Loading from:", entrypointPath);

		if (loadedVersion !== null && loadedVersion !== version) {
			console.info(
				`[Worker] Hot reload detected: ${loadedVersion} -> ${version}`,
			);
			console.info("[Worker] Creating completely fresh ServiceWorker context");

			// Create a completely new runtime instance instead of trying to reset
			registration = new ServiceWorkerRegistration();
			scope = new ShovelGlobalScope({registration, caches, buckets});
			scope.install();
			_workerSelf = scope;
			currentApp = null;
			serviceWorkerReady = false;
		}

		if (loadedVersion === version) {
			console.info(
				"[Worker] ServiceWorker already loaded for version",
				version,
			);
			return;
		}

		// Import the application
		const appModule = await import(`${entrypointPath}?v=${version}`);

		loadedVersion = version;
		currentApp = appModule;

		// Run ServiceWorker lifecycle
		await registration.install();
		await registration.activate();
		serviceWorkerReady = true;

		console.info(
			`[Worker] ServiceWorker loaded and activated (v${version}) from ${entrypointPath}`,
		);
	} catch (error) {
		console.error("[Worker] Failed to load ServiceWorker:", error);
		serviceWorkerReady = false;
		throw error;
	}
}

const workerId = Math.random().toString(36).substring(2, 8);
let sendMessage: (message: WorkerMessage) => void;

async function handleMessage(message: WorkerMessage): Promise<void> {
	try {
		if (message.type === "load") {
			const loadMsg = message as WorkerLoadMessage;
			await loadServiceWorker(loadMsg.version, loadMsg.entrypoint);
			sendMessage({type: "ready", version: loadMsg.version});
		} else if (message.type === "request") {
			const reqMsg = message as WorkerRequest;
			console.info(
				`[Worker-${workerId}] Handling request:`,
				reqMsg.request.url,
			);

			const request = new Request(reqMsg.request.url, {
				method: reqMsg.request.method,
				headers: reqMsg.request.headers,
				body: reqMsg.request.body,
			});

			const response = await handleFetchEvent(request);

			const responseMsg: WorkerResponse = {
				type: "response",
				response: {
					status: response.status,
					statusText: response.statusText,
					headers: Object.fromEntries(response.headers.entries()),
					body: await response.text(),
				},
				requestId: reqMsg.requestId,
			};
			sendMessage(responseMsg);
		}
		// Ignore all other message types (cache: messages handled directly by MemoryCache)
	} catch (error) {
		const errorMsg: WorkerErrorMessage = {
			type: "error",
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
			requestId: (message as any).requestId,
		};
		sendMessage(errorMsg);
	}
}

// Initialize the worker environment and send ready signal
initializeWorker()
	.then(({messagePort: _messagePort, sendMessage: send}) => {
		sendMessage = send;
		sendMessage({type: "worker-ready"});
	})
	.catch((error) => {
		console.error("[Worker] Failed to initialize:", error);
	});
