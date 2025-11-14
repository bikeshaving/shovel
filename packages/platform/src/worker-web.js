/**
 * Web Worker compatible template for ServiceWorker execution
 * Works with both native Web Workers and web-worker shim
 */

// Initialize worker environment - Web Worker API only (native or shimmed)
async function initializeWorker() {
	// Use Web Worker globals - works with native Web Workers or web-worker shim
	let messagePort = self;
	let sendMessage = (message) => postMessage(message);

	// Handle incoming messages
	onmessage = function (event) {
		handleMessage(event.data);
	};

	return {messagePort, sendMessage};
}

// Import platform modules
const {ShovelGlobalScope, ServiceWorkerRegistration, CustomBucketStorage} =
	await import("./index.js");
const {CustomCacheStorage, PostMessageCache} = await import("@b9g/cache");
const {FileSystemRegistry} = await import("@b9g/filesystem");

// Create worker-aware cache storage using PostMessage coordination
const caches = new CustomCacheStorage((name) => {
	return new PostMessageCache(name, {
		maxEntries: 1000,
		maxAge: 60 * 60 * 1000, // 1 hour
	});
});

// Create bucket storage using FileSystemRegistry
const buckets = new CustomBucketStorage(async (name) => {
	const registered = FileSystemRegistry.get(name);
	if (registered) return registered;
	throw new Error(`Bucket '${name}' not registered`);
});

// Create ServiceWorker runtime
let registration = new ServiceWorkerRegistration();
let scope = new ShovelGlobalScope({registration, caches, buckets});
scope.install();

let _workerSelf = scope;
let currentApp = null;
let serviceWorkerReady = false;
let loadedVersion = null;

async function handleFetchEvent(request) {
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

async function loadServiceWorker(version, entrypoint) {
	try {
		console.info("[Worker] loadServiceWorker called with:", {
			version,
			entrypoint,
		});

		const entrypointPath =
			process.env.SERVICEWORKER_PATH ||
			entrypoint ||
			`${process.cwd()}/dist/server/app.js`;
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
			workerSelf = scope;
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
let sendMessage;

async function handleMessage(message) {
	try {
		if (message.type === "load") {
			await loadServiceWorker(message.version, message.entrypoint);
			sendMessage({type: "ready", version: message.version});
		} else if (message.type === "request") {
			console.info(
				`[Worker-${workerId}] Handling request:`,
				message.request.url,
			);

			const request = new Request(message.request.url, {
				method: message.request.method,
				headers: message.request.headers,
				body: message.request.body,
			});

			const response = await handleFetchEvent(request);

			sendMessage({
				type: "response",
				response: {
					status: response.status,
					statusText: response.statusText,
					headers: Object.fromEntries(response.headers.entries()),
					body: await response.text(),
				},
				requestId: message.requestId,
			});
	}
	// Ignore all other message types (cache: messages handled directly by MemoryCache)
	} catch (error) {
		sendMessage({
			type: "error",
			error: error.message,
			stack: error.stack,
			requestId: message.requestId,
		});
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
