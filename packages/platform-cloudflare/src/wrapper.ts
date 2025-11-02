/**
 * Cloudflare Workers ES Module wrapper
 * Converts ServiceWorker code to ES Module format for Cloudflare Workers
 */

/**
 * Generate banner code for ServiceWorker → ES Module conversion
 */
export const cloudflareWorkerBanner = `// Cloudflare Worker ES Module wrapper
let serviceWorkerGlobals = null;

// Set up ServiceWorker environment
if (typeof globalThis.self === 'undefined') {
	globalThis.self = globalThis;
}

// Capture fetch event handlers
const fetchHandlers = [];
const originalAddEventListener = globalThis.addEventListener;
globalThis.addEventListener = function(type, handler, options) {
	if (type === 'fetch') {
		fetchHandlers.push(handler);
	} else {
		originalAddEventListener?.call(this, type, handler, options);
	}
};

// Create a promise-based FetchEvent that can be awaited
class FetchEvent {
	constructor(type, init) {
		this.type = type;
		this.request = init.request;
		this._response = null;
		this._responsePromise = new Promise((resolve) => {
			this._resolveResponse = resolve;
		});
	}
	
	respondWith(response) {
		this._response = response;
		this._resolveResponse(response);
	}
	
	async waitUntil(promise) {
		await promise;
	}
}`;

/**
 * Generate footer code for ServiceWorker → ES Module conversion
 */
export const cloudflareWorkerFooter = `
// Export ES Module for Cloudflare Workers
export default {
	async fetch(request, env, ctx) {
		// Set up ServiceWorker-like dirs API using R2
		if (!globalThis.self.dirs) {
			globalThis.self.dirs = {
				async open(bucketName) {
					if (bucketName === 'assets' && env.ASSETS) {
						return env.ASSETS;
					}
					throw new Error(\`Bucket \${bucketName} not configured\`);
				}
			};
		}
		
		// Set up caches API
		if (!globalThis.self.caches) {
			globalThis.self.caches = globalThis.caches;
		}
		
		// Ensure request.url is a string
		if (typeof request.url !== 'string') {
			return new Response('Invalid request URL: ' + typeof request.url, { status: 500 });
		}
		
		// Create proper FetchEvent-like object
		let responseReceived = null;
		const event = { 
			request, 
			respondWith: (response) => { responseReceived = response; }
		};
		
		// Dispatch to ServiceWorker fetch handlers
		for (const handler of fetchHandlers) {
			try {
				await handler(event);
				if (responseReceived) {
					return responseReceived;
				}
			} catch (error) {
				return new Response('ServiceWorker error: ' + error.message, { status: 500 });
			}
		}
		
		return new Response('No ServiceWorker handler', { status: 404 });
	}
};`;