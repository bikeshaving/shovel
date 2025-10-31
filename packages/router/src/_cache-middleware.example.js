/**
 * Example cache middleware for cache-first routing
 * This demonstrates how to implement automatic cache check/populate behavior
 */

/**
 * Basic cache middleware that checks cache first and populates on miss
 * Only caches successful GET requests
 */
export const cacheMiddleware = async (request, context, next) => {
	// Only cache GET requests
	if (request.method !== "GET" || !context.cache) {
		return next();
	}

	// Check cache first
	const cached = await context.cache.match(request);
	if (cached) {
		// Add a cache hit header for debugging
		const response = cached.clone();
		response.headers.set("X-Cache", "HIT");
		return response;
	}

	// Cache miss - get response from handler
	const response = await next();

	// Only cache successful responses
	if (response.ok && response.status < 300) {
		try {
			await context.cache.put(request, response.clone());
		} catch (error) {
			console.warn("Failed to cache response:", error);
			// Don't fail the request if caching fails
		}
	}

	// Add cache miss header for debugging
	response.headers.set("X-Cache", "MISS");
	return response;
};

/**
 * Advanced cache middleware with TTL and cache control support
 */
export const advancedCacheMiddleware = async (request, context, next) => {
	if (request.method !== "GET" || !context.cache) {
		return next();
	}

	// Check cache first
	const cached = await context.cache.match(request);
	if (cached) {
		// Check if cached response is still fresh
		const cacheControl = cached.headers.get("Cache-Control");
		const date = cached.headers.get("Date");

		if (isFresh(cacheControl, date)) {
			const response = cached.clone();
			response.headers.set("X-Cache", "HIT");
			return response;
		} else {
			// Cached response is stale, delete it
			await context.cache.delete(request);
		}
	}

	// Get fresh response
	const response = await next();

	// Cache successful responses that allow caching
	if (response.ok && shouldCache(response)) {
		try {
			// Add timestamp for TTL checking
			const responseToCache = response.clone();
			responseToCache.headers.set("Date", new Date().toISOString());

			await context.cache.put(request, responseToCache);
		} catch (error) {
			console.warn("Failed to cache response:", error);
		}
	}

	response.headers.set("X-Cache", "MISS");
	return response;
};

/**
 * Cache invalidation middleware for write operations
 * Clears related cache entries after successful mutations
 */
export const cacheInvalidationMiddleware = async (request, context, next) => {
	// For non-GET requests, we want to invalidate cache after the operation
	if (request.method === "GET") {
		return next();
	}

	const response = await next();

	// Only invalidate on successful mutations
	if (response.ok && context.cache) {
		try {
			const url = new URL(request.url);

			// Invalidate the specific resource
			await context.cache.delete(new Request(url.href, {method: "GET"}));

			// Also invalidate collection endpoints (basic heuristic)
			if (url.pathname.match(/\/\d+$/)) {
				// If URL ends with an ID, also invalidate the collection
				const collectionUrl = url.pathname.replace(/\/\d+$/, "");
				await context.cache.delete(
					new Request(`${url.origin}${collectionUrl}`, {method: "GET"}),
				);
			}

			console.info(`Invalidated cache for ${request.method} ${url.pathname}`);
		} catch (error) {
			console.warn("Failed to invalidate cache:", error);
		}
	}

	return response;
};

/**
 * Helper function to check if a cached response is still fresh
 */
function isFresh(cacheControl, dateHeader) {
	if (!cacheControl || !dateHeader) {
		return false;
	}

	const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
	if (!maxAgeMatch) {
		return false;
	}

	const maxAge = parseInt(maxAgeMatch[1], 10) * 1000; // Convert to milliseconds
	const responseDate = new Date(dateHeader).getTime();
	const now = Date.now();

	return now - responseDate < maxAge;
}

/**
 * Helper function to determine if a response should be cached
 */
function shouldCache(response) {
	// Don't cache if explicitly marked as no-cache
	const cacheControl = response.headers.get("Cache-Control");
	if (
		cacheControl &&
		(cacheControl.includes("no-cache") || cacheControl.includes("no-store"))
	) {
		return false;
	}

	// Only cache successful responses
	return response.ok && response.status < 300;
}

/**
 * Example usage of cache middleware with router
 */
export function exampleUsage() {
	// This is just for documentation - not actually runnable
	const router = new Router({caches});

	// Global cache middleware for all routes
	router.use(cacheMiddleware);
	router.use(cacheInvalidationMiddleware);

	// Routes with specific caches
	router
		.route({
			pattern: "/api/posts/:id",
			cache: {name: "posts"},
		})
		.get(async (request, context) => {
			const post = await getPost(context.params.id);
			return Response.json(post, {
				headers: {
					"Cache-Control": "max-age=300", // Cache for 5 minutes
				},
			});
		});

	router
		.route({
			pattern: "/api/posts/:id",
			cache: {name: "posts"},
		})
		.put(async (request, context) => {
			const data = await request.json();
			const post = await updatePost(context.params.id, data);

			// Cache invalidation middleware will automatically clear related caches
			return Response.json(post);
		});
}
