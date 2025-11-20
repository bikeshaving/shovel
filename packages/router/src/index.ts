/**
 * @b9g/router - Universal request router built on web standards
 *
 * Features:
 * - Pure Request/Response routing (works anywhere)
 * - Chainable route builder API
 * - Generator-based middleware with yield continuation
 * - Integration with URLPattern and MatchPattern for enhanced URL matching
 * - Cache-aware routing
 * TODO:
 * - Portable param matching
 * - Typechecking
 */

import {MatchPattern} from "@b9g/match-pattern";
import {getLogger} from "@logtape/logtape";

const logger = getLogger(["router"]);

// ============================================================================
// TYPES
// ============================================================================

/**
 * Context object passed to handlers and middleware
 * Contains route parameters and cache access
 */
export interface RouteContext {
	/** Route parameters extracted from URL pattern matching */
	params: Record<string, string>;

	/** Named cache for this route (if configured) */
	cache?: import("@b9g/cache").Cache;

	/** Access to all registered caches */
	caches?: CacheStorage;

	/** Middleware can add arbitrary properties for context sharing */
	[key: string]: any;
}

/**
 * Handler function signature - terminal response producer
 * Handlers are terminal - must return a Response
 */
export type Handler = (
	request: Request,
	context: RouteContext,
) => Response | Promise<Response>;

/**
 * Generator middleware signature - uses yield for continuation
 * Provides clean syntax and eliminates control flow bugs
 */
export type GeneratorMiddleware = (
	request: Request,
	context: RouteContext,
) => AsyncGenerator<Request, Response | null | undefined, Response>;

/**
 * Function middleware signature - supports short-circuiting
 * Can modify request and context, and can return a Response to short-circuit
 * - Return Response: short-circuits, skipping remaining middleware and handler
 * - Return null/undefined: continues to next middleware (fallthrough)
 */
export type FunctionMiddleware = (
	request: Request,
	context: RouteContext,
) => null | undefined | Response | Promise<null | undefined | Response>;

/**
 * Union type for all supported middleware types
 * Framework automatically detects type and executes appropriately
 */
export type Middleware = GeneratorMiddleware | FunctionMiddleware;

/**
 * HTTP methods supported by the router
 */
export type HttpMethod =
	| "GET"
	| "POST"
	| "PUT"
	| "DELETE"
	| "PATCH"
	| "HEAD"
	| "OPTIONS";

/**
 * Cache configuration for routes
 */
export interface RouteCacheConfig {
	/** Name of the cache to use for this route */
	name: string;
	/** Cache query options */
	options?: import("@b9g/cache").CacheQueryOptions;
}

/**
 * Route configuration options
 */
export interface RouteConfig {
	/** URL pattern for the route */
	pattern: string;
	/** Cache configuration for this route */
	cache?: RouteCacheConfig;
}

/**
 * Router configuration options
 */
export interface RouterOptions {
	/** CacheStorage instance for cache-first routing */
	caches?: CacheStorage;
}

// Internal types (not exported from main package)

/**
 * Internal route entry stored by the router
 */
interface RouteEntry {
	pattern: import("@b9g/match-pattern").MatchPattern;
	method: string;
	handler: Handler;
	cache?: RouteCacheConfig;
}

/**
 * Internal middleware entry stored by the router
 */
interface MiddlewareEntry {
	middleware: Middleware;
}

/**
 * Result of route matching
 */
interface MatchResult {
	handler: Handler;
	context: RouteContext;
	cacheConfig?: RouteCacheConfig;
}

// ============================================================================
// IMPLEMENTATION
// ============================================================================

/**
 * LinearExecutor provides O(n) route matching by testing each route in order
 * This is the initial implementation - can be upgraded to trie-based matching later
 */
class LinearExecutor {
	constructor(private routes: RouteEntry[]) {}

	/**
	 * Find the first route that matches the request
	 * Returns null if no route matches
	 */
	match(request: Request): MatchResult | null {
		const url = new URL(request.url);
		const method = request.method.toUpperCase();

		for (const route of this.routes) {
			// Skip routes that don't match the HTTP method
			if (route.method !== method) {
				continue;
			}

			// Test if the URL pattern matches
			if (route.pattern.test(url)) {
				// Extract parameters using MatchPattern's enhanced exec
				const result = route.pattern.exec(url);
				if (result) {
					return {
						handler: route.handler,
						context: {
							params: result.params,
						},
						cacheConfig: route.cache,
					};
				}
			}
		}

		return null;
	}
}

/**
 * RouteBuilder provides a chainable API for defining routes with multiple HTTP methods
 *
 * Example:
 *   router.route('/api/users/:id')
 *     .get(getUserHandler)
 *     .put(updateUserHandler)
 *     .delete(deleteUserHandler);
 */
class RouteBuilder {
	#router: Router;
	#pattern: string;
	#cacheConfig?: RouteCacheConfig;

	constructor(router: Router, pattern: string, cacheConfig?: RouteCacheConfig) {
		this.#router = router;
		this.#pattern = pattern;
		this.#cacheConfig = cacheConfig;
	}

	/**
	 * Register a GET handler for this route pattern
	 */
	get(handler: Handler): RouteBuilder {
		this.#router.addRoute("GET", this.#pattern, handler, this.#cacheConfig);
		return this;
	}

	/**
	 * Register a POST handler for this route pattern
	 */
	post(handler: Handler): RouteBuilder {
		this.#router.addRoute("POST", this.#pattern, handler, this.#cacheConfig);
		return this;
	}

	/**
	 * Register a PUT handler for this route pattern
	 */
	put(handler: Handler): RouteBuilder {
		this.#router.addRoute("PUT", this.#pattern, handler, this.#cacheConfig);
		return this;
	}

	/**
	 * Register a DELETE handler for this route pattern
	 */
	delete(handler: Handler): RouteBuilder {
		this.#router.addRoute("DELETE", this.#pattern, handler, this.#cacheConfig);
		return this;
	}

	/**
	 * Register a PATCH handler for this route pattern
	 */
	patch(handler: Handler): RouteBuilder {
		this.#router.addRoute("PATCH", this.#pattern, handler, this.#cacheConfig);
		return this;
	}

	/**
	 * Register a HEAD handler for this route pattern
	 */
	head(handler: Handler): RouteBuilder {
		this.#router.addRoute("HEAD", this.#pattern, handler, this.#cacheConfig);
		return this;
	}

	/**
	 * Register an OPTIONS handler for this route pattern
	 */
	options(handler: Handler): RouteBuilder {
		this.#router.addRoute("OPTIONS", this.#pattern, handler, this.#cacheConfig);
		return this;
	}

	/**
	 * Register a handler for all HTTP methods on this route pattern
	 */
	all(handler: Handler): RouteBuilder {
		const methods: HttpMethod[] = [
			"GET",
			"POST",
			"PUT",
			"DELETE",
			"PATCH",
			"HEAD",
			"OPTIONS",
		];
		methods.forEach((method) => {
			this.#router.addRoute(method, this.#pattern, handler, this.#cacheConfig);
		});
		return this;
	}
}

/**
 * Router provides Request/Response routing with middleware support
 * Designed to work universally across all JavaScript runtimes
 */
export class Router {
	#routes: RouteEntry[];
	#middlewares: MiddlewareEntry[];
	#executor: LinearExecutor | null;
	#dirty: boolean;
	#caches?: CacheStorage;

	constructor(options?: RouterOptions) {
		this.#routes = [];
		this.#middlewares = [];
		this.#executor = null;
		this.#dirty = false;
		this.#caches = options?.caches;

		// Initialize handler implementation
		this.#handlerImpl = async (request: Request): Promise<Response> => {
			// Lazy compilation - build executor on first match
			if (this.#dirty || !this.#executor) {
				this.#executor = new LinearExecutor(this.#routes);
				this.#dirty = false;
			}

			// Find matching route
			const matchResult = this.#executor.match(request);

			if (matchResult) {
				// Route found - build context and execute middleware chain + handler
				const context = await this.#buildContext(
					matchResult.context,
					matchResult.cacheConfig,
				);
				const mutableRequest = this.#createMutableRequest(request);
				return this.#executeMiddlewareStack(
					this.#middlewares,
					mutableRequest,
					context,
					matchResult.handler,
					request.url,
					this.#executor,
				);
			} else {
				// No route found - execute global middleware with 404 fallback
				const notFoundHandler = async (): Promise<Response> => {
					return new Response("Not Found", {status: 404});
				};
				const mutableRequest = this.#createMutableRequest(request);
				return this.#executeMiddlewareStack(
					this.#middlewares,
					mutableRequest,
					{params: {}},
					notFoundHandler,
					request.url,
					this.#executor,
				);
			}
		};

		this.handler = this.#handlerImpl;
	}

	/**
	 * Register middleware that applies to all routes
	 * Middleware executes in the order it was registered
	 */
	use(middleware: Middleware): void;

	/**
	 * Register a handler for a specific pattern
	 */
	use(pattern: string, handler: Handler): void;

	use(patternOrMiddleware: string | Middleware, handler?: Handler): void {
		if (typeof patternOrMiddleware === "string" && handler) {
			// Pattern-based handler registration
			this.addRoute("GET", patternOrMiddleware, handler);
			this.addRoute("POST", patternOrMiddleware, handler);
			this.addRoute("PUT", patternOrMiddleware, handler);
			this.addRoute("DELETE", patternOrMiddleware, handler);
			this.addRoute("PATCH", patternOrMiddleware, handler);
			this.addRoute("HEAD", patternOrMiddleware, handler);
			this.addRoute("OPTIONS", patternOrMiddleware, handler);
		} else if (typeof patternOrMiddleware === "function") {
			// Validate middleware type
			if (!this.#isValidMiddleware(patternOrMiddleware)) {
				throw new Error(
					"Invalid middleware type. Must be function or async generator function.",
				);
			}

			// Global middleware registration with automatic type detection
			this.#middlewares.push({middleware: patternOrMiddleware});
			this.#dirty = true;
		} else {
			throw new Error(
				"Invalid middleware type. Must be function or async generator function.",
			);
		}
	}

	/**
	 * Create a route builder for the given pattern
	 * Returns a chainable interface for registering HTTP method handlers
	 *
	 * Example:
	 *   router.route('/api/users/:id')
	 *     .get(getUserHandler)
	 *     .put(updateUserHandler);
	 *
	 * With cache configuration:
	 *   router.route({ pattern: '/api/users/:id', cache: { name: 'users' } })
	 *     .get(getUserHandler);
	 */
	route(pattern: string): RouteBuilder;
	route(config: RouteConfig): RouteBuilder;
	route(patternOrConfig: string | RouteConfig): RouteBuilder {
		if (typeof patternOrConfig === "string") {
			return new RouteBuilder(this, patternOrConfig);
		} else {
			return new RouteBuilder(
				this,
				patternOrConfig.pattern,
				patternOrConfig.cache,
			);
		}
	}

	/**
	 * Internal method called by RouteBuilder to register routes
	 * Public for RouteBuilder access, but not intended for direct use
	 */
	addRoute(
		method: HttpMethod,
		pattern: string,
		handler: Handler,
		cache?: RouteCacheConfig,
	): void {
		const matchPattern = new MatchPattern(pattern);

		this.#routes.push({
			pattern: matchPattern,
			method: method.toUpperCase(),
			handler: handler,
			cache,
		});
		this.#dirty = true;
	}

	/**
	 * Handle a request - main entrypoint for ServiceWorker usage
	 * Returns a response or throws if no route matches
	 */
	handler: (request: Request) => Promise<Response>;
	#handlerImpl: (request: Request) => Promise<Response>;

	/**
	 * Match a request against registered routes and execute the handler chain
	 * Returns the response from the matched handler, or null if no route matches
	 * Note: Global middleware executes even if no route matches
	 */
	async match(request: Request): Promise<Response | null> {
		// Lazy compilation - build executor on first match
		if (this.#dirty || !this.#executor) {
			this.#executor = new LinearExecutor(this.#routes);
			this.#dirty = false;
		}

		// Create mutable request wrapper for URL modifications
		const mutableRequest = this.#createMutableRequest(request);
		const originalUrl = mutableRequest.url;

		// Try to find a route match first
		let matchResult = this.#executor.match(request);
		let handler: Handler;
		let context: RouteContext;

		if (matchResult) {
			// Route found - use its handler and context
			handler = matchResult.handler;
			context = await this.#buildContext(
				matchResult.context,
				matchResult.cacheConfig,
			);
		} else {
			// No route found - use 404 handler and empty context
			handler = async () => new Response("Not Found", {status: 404});
			context = {params: {}};
		}

		// Execute middleware chain with the handler
		const response = await this.#executeMiddlewareStack(
			this.#middlewares,
			mutableRequest,
			context,
			handler,
			originalUrl,
			this.#executor, // Pass executor for re-routing
		);

		// If no route was found originally, return null unless middleware handled it
		if (!matchResult && response?.status === 404) {
			return null;
		}

		return response;
	}

	/**
	 * Build the complete route context including cache access
	 */
	async #buildContext(
		baseContext: RouteContext,
		cacheConfig?: RouteCacheConfig,
	): Promise<RouteContext> {
		const context: RouteContext = {...baseContext};

		if (this.#caches) {
			context.caches = this.#caches;

			// Open the named cache if configured for this route
			if (cacheConfig?.name) {
				try {
					// CacheStorage.open() returns Web API Cache which is compatible with our Cache interface
					context.cache = (await this.#caches.open(
						cacheConfig.name,
					)) as import("@b9g/cache").Cache;
				} catch (error) {
					logger.warn("Failed to open cache", {cacheName: cacheConfig.name, error});
					// Continue without cache - don't fail the request
				}
			}
		}

		return context;
	}

	/**
	 * Get registered routes for debugging/introspection
	 */
	getRoutes(): RouteEntry[] {
		return [...this.#routes];
	}

	/**
	 * Get registered middleware for debugging/introspection
	 */
	getMiddlewares(): MiddlewareEntry[] {
		return [...this.#middlewares];
	}

	/**
	 * Mount a subrouter at a specific path prefix
	 * All routes from the subrouter will be prefixed with the mount path
	 *
	 * Example:
	 *   const apiRouter = new Router();
	 *   apiRouter.route('/users').get(getUsersHandler);
	 *   apiRouter.route('/users/:id').get(getUserHandler);
	 *
	 *   const mainRouter = new Router();
	 *   mainRouter.mount('/api/v1', apiRouter);
	 *   // Routes become: /api/v1/users, /api/v1/users/:id
	 */
	mount(mountPath: string, subrouter: Router): void {
		// Normalize mount path - ensure it starts with / and doesn't end with /
		const normalizedMountPath = this.#normalizeMountPath(mountPath);

		// Get all routes from the subrouter
		const subroutes = subrouter.getRoutes();

		// Add each subroute with the mount path prefix
		for (const subroute of subroutes) {
			// Combine mount path with subroute pattern
			const mountedPattern = this.#combinePaths(
				normalizedMountPath,
				subroute.pattern.pathname,
			);

			// Add the route to this router
			this.#routes.push({
				pattern: new MatchPattern(mountedPattern),
				method: subroute.method,
				handler: subroute.handler,
				cache: subroute.cache,
			});
		}

		// Get all middleware from the subrouter and add with mount path prefix
		const submiddlewares = subrouter.getMiddlewares();
		for (const submiddleware of submiddlewares) {
			// For now, add subrouter middleware globally
			// TODO: Could add path-specific middleware in the future
			this.#middlewares.push(submiddleware);
		}

		this.#dirty = true;
	}

	/**
	 * Normalize mount path: ensure it starts with / and doesn't end with /
	 */
	#normalizeMountPath(mountPath: string): string {
		if (!mountPath.startsWith("/")) {
			mountPath = "/" + mountPath;
		}
		if (mountPath.endsWith("/") && mountPath.length > 1) {
			mountPath = mountPath.slice(0, -1);
		}
		return mountPath;
	}

	/**
	 * Combine mount path with route pattern
	 */
	#combinePaths(mountPath: string, routePattern: string): string {
		// Handle root path specially
		if (routePattern === "/") {
			return mountPath;
		}

		// Ensure route pattern starts with /
		if (!routePattern.startsWith("/")) {
			routePattern = "/" + routePattern;
		}

		return mountPath + routePattern;
	}

	/**
	 * Validate that a function is valid middleware
	 */
	#isValidMiddleware(middleware: Middleware): boolean {
		const constructorName = middleware.constructor.name;
		return (
			constructorName === "AsyncGeneratorFunction" ||
			constructorName === "AsyncFunction" ||
			constructorName === "Function"
		);
	}

	/**
	 * Detect if a function is a generator middleware
	 */
	#isGeneratorMiddleware(middleware: Middleware): boolean {
		return middleware.constructor.name === "AsyncGeneratorFunction";
	}

	/**
	 * Execute middleware stack with guaranteed execution using Rack-style LIFO order
	 */
	async #executeMiddlewareStack(
		middlewares: MiddlewareEntry[],
		request: any,
		context: RouteContext,
		handler: Handler,
		originalUrl: string,
		executor?: LinearExecutor | null,
	): Promise<Response> {
		const runningGenerators: Array<{generator: AsyncGenerator; index: number}> =
			[];
		let currentResponse: Response | null = null;

		// Phase 1: Execute all middleware "before" phases (request processing)
		for (let i = 0; i < middlewares.length; i++) {
			const middleware = middlewares[i].middleware;

			if (this.#isGeneratorMiddleware(middleware)) {
				const generator = (middleware as GeneratorMiddleware)(request, context);
				const result = await generator.next();

				if (result.done) {
					// Early return (0 yields) - check if Response returned for short-circuiting
					if (result.value) {
						currentResponse = result.value;
						// Short-circuit: stop processing remaining middleware
						break;
					}
				} else {
					// Generator yielded - save for later resumption
					runningGenerators.push({generator, index: i});
				}
			} else {
				// Function middleware - execute and check for short-circuit
				const result = await (middleware as FunctionMiddleware)(
					request,
					context,
				);
				if (result) {
					// Function middleware returned a Response - short-circuit
					currentResponse = result;
					break;
				}
			}
		}

		// Phase 2: Get handler response if no middleware returned early
		if (!currentResponse) {
			// Check if URL was modified and re-route if needed
			let finalHandler = handler;
			let finalContext = context;

			if (request.url !== originalUrl && executor) {
				const newMatchResult = executor.match(
					new Request(request.url, {
						method: request.method,
						headers: request.headers,
						body: request.body,
					}),
				);

				if (newMatchResult) {
					finalHandler = newMatchResult.handler;
					finalContext = await this.#buildContext(
						newMatchResult.context,
						newMatchResult.cacheConfig || undefined,
					);
				}
			}

			// Execute handler
			let handlerError: Error | null = null;
			try {
				currentResponse = await finalHandler(request, finalContext);
			} catch (error) {
				handlerError = error as Error;
			}

			// Handle errors through generator stack if needed
			if (handlerError) {
				currentResponse = await this.#handleErrorThroughGenerators(
					handlerError,
					runningGenerators,
				);
			}
		}

		// Handle automatic redirects if URL was modified - do this before resuming generators
		// so that generators can process the redirect response
		if (request.url !== originalUrl && currentResponse) {
			currentResponse = this.#handleAutomaticRedirect(
				originalUrl,
				request.url,
				request.method,
			);
		}

		// Phase 3: Resume all generators in reverse order (LIFO - Last In First Out)
		// This implements the Rack-style guaranteed execution
		for (let i = runningGenerators.length - 1; i >= 0; i--) {
			const {generator} = runningGenerators[i];
			const result = await generator.next(currentResponse);
			if (result.value) {
				currentResponse = result.value;
			}
		}

		return currentResponse!;
	}

	/**
	 * Handle errors by trying generators in reverse order
	 */
	async #handleErrorThroughGenerators(
		error: Error,
		runningGenerators: Array<{generator: AsyncGenerator; index: number}>,
	): Promise<Response> {
		// Try error handling starting from the innermost middleware (reverse order)
		for (let i = runningGenerators.length - 1; i >= 0; i--) {
			const {generator} = runningGenerators[i];

			try {
				const result = await generator.throw(error);
				if (result.value) {
					// This generator handled the error - remove it from the stack
					// so it doesn't get resumed again in phase 3
					runningGenerators.splice(i, 1);
					return result.value;
				}
			} catch (generatorError) {
				// This generator rethrew - continue to next generator
				// Remove this generator from the stack since it failed
				runningGenerators.splice(i, 1);
				continue;
			}
		}

		// No generator handled the error
		throw error;
	}

	/**
	 * Create a mutable request wrapper that allows URL modification
	 */
	#createMutableRequest(request: Request): any {
		return {
			url: request.url,
			method: request.method,
			headers: new Headers(request.headers),
			body: request.body,
			bodyUsed: request.bodyUsed,
			cache: request.cache,
			credentials: request.credentials,
			destination: request.destination,
			integrity: request.integrity,
			keepalive: request.keepalive,
			mode: request.mode,
			redirect: request.redirect,
			referrer: request.referrer,
			referrerPolicy: request.referrerPolicy,
			signal: request.signal,
			// Add all other Request methods
			arrayBuffer: () => request.arrayBuffer(),
			blob: () => request.blob(),
			clone: () => request.clone(),
			formData: () => request.formData(),
			json: () => request.json(),
			text: () => request.text(),
		};
	}

	/**
	 * Handle automatic redirects when URL is modified
	 */
	#handleAutomaticRedirect(
		originalUrl: string,
		newUrl: string,
		method: string,
	): Response {
		const originalURL = new URL(originalUrl);
		const newURL = new URL(newUrl);

		// Security: Only allow same-origin redirects (allow protocol upgrades)
		if (
			originalURL.hostname !== newURL.hostname ||
			(originalURL.port !== newURL.port &&
				originalURL.port !== "" &&
				newURL.port !== "")
		) {
			throw new Error(
				`Cross-origin redirect not allowed: ${originalUrl} -> ${newUrl}`,
			);
		}

		// Choose appropriate redirect status code
		let status = 302; // Default temporary redirect

		// Protocol changes (http -> https) get 301 permanent
		if (originalURL.protocol !== newURL.protocol) {
			status = 301;
		}
		// Non-GET methods get 307 to preserve method and body
		else if (method.toUpperCase() !== "GET") {
			status = 307;
		}

		return new Response(null, {
			status,
			headers: {
				Location: newUrl,
			},
		});
	}

	/**
	 * Get route statistics
	 */
	getStats() {
		return {
			routeCount: this.#routes.length,
			middlewareCount: this.#middlewares.length,
			compiled: !this.#dirty && this.#executor !== null,
		};
	}
}
