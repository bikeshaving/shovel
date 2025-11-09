/**
 * Reqback - Shovel Node.js Example
 * HTTP request echo and debugging API using Shovel router abstraction
 */

import {Router} from "@b9g/router";

// Import helper functions from original reqback logic
import {
	getRequestInfo,
	parseBody, 
	parseCorsHeader,
	handleAuthSimulation,
	handleRedirectSimulation,
	handleCacheSimulation,
	HOMEPAGE_HTML
} from "./index.ts";

// Create router for Shovel platform
const router = new Router();

// Homepage route
router.route("/").get(async (request, context) => {
	return new Response(HOMEPAGE_HTML, {
		headers: { "Content-Type": "text/html" },
	});
});

// Echo API route - all HTTP methods
router.route("/echo").all(async (request, context) => {
	const corsHeader = request.headers.get("x-reqback-cors");
	
	// Handle preflight
	if (request.method === "OPTIONS") {
		const corsHeadersToUse = parseCorsHeader(corsHeader);
		
		if (!corsHeadersToUse) {
			return new Response(null, { status: 204 });
		}
		
		return new Response(null, {
			status: 204,
			headers: corsHeadersToUse,
		});
	}

	// Check for auth simulation first
	const authHeader = request.headers.get("x-reqback-auth");
	if (authHeader) {
		const authResponse = handleAuthSimulation(request, authHeader);
		if (authResponse) {
			const corsHeadersToUse = parseCorsHeader(corsHeader);
			return new Response(authResponse.body, {
				status: authResponse.status,
				headers: {
					"Content-Type": "application/json",
					...(corsHeadersToUse || {}),
				},
			});
		}
	}

	// Check for redirect simulation
	const redirectHeader = request.headers.get("x-reqback-redirect");
	if (redirectHeader) {
		const redirectResponse = handleRedirectSimulation(redirectHeader);
		if (redirectResponse) {
			const corsHeadersToUse = parseCorsHeader(corsHeader);
			return new Response(null, {
				status: redirectResponse.status,
				headers: {
					"Location": redirectResponse.location,
					...(corsHeadersToUse || {}),
				},
			});
		}
	}

	// Get request info
	const info = getRequestInfo(request);
	const body = await parseBody(request);

	// Check for control headers
	const delayHeader = request.headers.get("x-reqback-delay");
	const statusHeader = request.headers.get("x-reqback-status");

	let delay = 0;
	let statusCode = 200;

	// Parse delay
	if (delayHeader) {
		const parsedDelay = parseInt(delayHeader);
		if (isNaN(parsedDelay) || parsedDelay < 1 || parsedDelay > 10) {
			return Response.json(
				{ error: "X-Reqback-Delay must be between 1 and 10" },
				{ status: 400, headers: parseCorsHeader(null) }
			);
		}
		delay = parsedDelay;
	}

	// Parse status code
	if (statusHeader) {
		const parsedStatus = parseInt(statusHeader);
		if (isNaN(parsedStatus) || parsedStatus < 100 || parsedStatus > 599) {
			return Response.json(
				{ error: "X-Reqback-Status must be between 100 and 599" },
				{ status: 400, headers: parseCorsHeader(null) }
			);
		}
		statusCode = parsedStatus;
	}

	// Apply delay if requested
	if (delay > 0) {
		await new Promise(resolve => setTimeout(resolve, delay * 1000));
	}

	// Build response
	const response = {
		...info,
		body,
		contentType: request.headers.get("content-type") || null,
	};

	// Add metadata about control headers if used
	if (delay > 0) {
		response.delayed = `${delay} seconds`;
	}
	if (statusCode !== 200) {
		response.requestedStatus = statusCode;
	}

	const corsHeadersToUse = parseCorsHeader(corsHeader);
	const cacheHeader = request.headers.get("x-reqback-cache");
	const cacheHeaders = handleCacheSimulation(cacheHeader);
	const contentTypeHeader = request.headers.get("x-reqback-content-type");
	
	const responseHeaders = {
		...(corsHeadersToUse || {}),
		...cacheHeaders,
	};
	
	// Override content type if specified
	if (contentTypeHeader) {
		responseHeaders["Content-Type"] = contentTypeHeader;
	} else {
		responseHeaders["Content-Type"] = "application/json";
	}

	return Response.json(response, {
		status: statusCode,
		headers: responseHeaders,
	});
});

// 404 handler for all other routes
router.use(async function* notFoundHandler(request, context) {
	const url = new URL(request.url);
	const response = yield request;
	
	// If no previous handler matched, return 404
	if (!response) {
		return Response.json(
			{
				error: "Not found",
				path: url.pathname,
				suggestion: "Try /echo or see / for documentation",
			},
			{ 
				status: 404,
				headers: parseCorsHeader(null),
			}
		);
	}
	
	return response;
});

// ServiceWorker install event
self.addEventListener("install", (event) => {
	console.info("[Reqback] ServiceWorker installed");
});

// ServiceWorker activate event 
self.addEventListener("activate", (event) => {
	console.info("[Reqback] ServiceWorker activated");
});

// ServiceWorker fetch event - handle HTTP requests
self.addEventListener("fetch", (event) => {
	try {
		const responsePromise = router.handler(event.request);
		event.respondWith(responsePromise);
	} catch (error) {
		console.error("[Reqback] Error handling request:", error);
		event.respondWith(
			new Response(
				JSON.stringify({
					error: "Internal server error", 
					message: error.message
				}), 
				{
					status: 500,
					headers: {"Content-Type": "application/json"}
				}
			)
		);
	}
});