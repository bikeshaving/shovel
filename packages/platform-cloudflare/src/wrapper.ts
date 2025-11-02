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
		try {
			// Set up ServiceWorker-like dirs API for bundled deployment
			if (!globalThis.self.dirs) {
				// For bundled deployment, assets are served via static middleware
				// not through the dirs API
				globalThis.self.dirs = {
					async open(directoryName) {
						if (directoryName === 'assets') {
							// Return a minimal interface that indicates no files available
							// The assets middleware will fall back to dev mode behavior
							return {
								async getFileHandle(fileName) {
									throw new Error(\`NotFoundError: \${fileName} not found in bundled assets\`);
								}
							};
						}
						throw new Error(\`Directory \${directoryName} not available in bundled deployment\`);
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
					console.log('[Wrapper] Calling handler for:', request.url);
					await handler(event);
					console.log('[Wrapper] Handler completed, response:', !!responseReceived);
					if (responseReceived) {
						return responseReceived;
					}
				} catch (error) {
					console.error('[Wrapper] Handler error:', error);
					console.error('[Wrapper] Error stack:', error.stack);
					// Return detailed error in response body for debugging
					return new Response(JSON.stringify({
						error: error.message,
						stack: error.stack,
						name: error.name,
						url: request.url
					}, null, 2), { 
						status: 500,
						headers: { 'Content-Type': 'application/json' }
					});
				}
			}
			
			return new Response('No ServiceWorker handler', { status: 404 });
		} catch (topLevelError) {
			console.error('[Wrapper] Top-level error:', topLevelError);
			return new Response(JSON.stringify({
				error: 'Top-level wrapper error: ' + topLevelError.message,
				stack: topLevelError.stack,
				name: topLevelError.name,
				url: request?.url || 'unknown'
			}, null, 2), { 
				status: 500,
				headers: { 'Content-Type': 'application/json' }
			});
		}
	}
};`;