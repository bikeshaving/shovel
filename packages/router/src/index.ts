/** @b9g/router - Universal request router built on web standards */

import {
	MatchPattern,
	isSimplePattern,
	compilePathname,
	type CompiledPattern,
} from "@b9g/match-pattern";
import {
	HTTPError,
	isHTTPError,
	InternalServerError,
	NotFound,
} from "@b9g/http-errors";
import {getLogger} from "@logtape/logtape";

const logger = getLogger(["shovel", "router"]);

// ============================================================================
// TYPES
// ============================================================================

/**
 * Context object passed to handlers and middleware
 * Contains route parameters extracted from URL pattern matching
 * Augmentable via module declaration for middleware-specific properties
 */
export interface RouteContext {
	/** Route parameters extracted from URL pattern matching */
	params: Record<string, string>;
	/** Allow middleware to add arbitrary properties to context */
	[key: string]: unknown;
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
 * Function middleware signature
 * Can modify request and context, and can return a Response to short-circuit
 */
export type FunctionMiddleware = (
	request: Request,
	context: RouteContext,
) =>
	| Response
	| null
	| undefined
	| void
	| Promise<Response | null | undefined | void>;

/**
 * Generator middleware signature - uses yield for continuation.
 * Yield to pass control to the next middleware/handler, receive Response back.
 * Optionally yield a modified Request (or yield without value to use original).
 */
export type GeneratorMiddleware = (
	request: Request,
	context: RouteContext,
) =>
	| Generator<Request | undefined, Response | null | undefined | void, Response>
	| AsyncGenerator<
			Request | undefined,
			Response | null | undefined | void,
			Response
	  >;

/**
 * Union type for all supported middleware types
 * Framework automatically detects type and executes appropriately
 */
export type Middleware = GeneratorMiddleware | FunctionMiddleware;

/**
 * HTTP methods supported by the router
 */
export type HTTPMethod =
	| "GET"
	| "POST"
	| "PUT"
	| "DELETE"
	| "PATCH"
	| "HEAD"
	| "OPTIONS";

/**
 * Route options for configuring route metadata
 * Augmentable via module declaration for custom metadata
 */
export interface RouteOptions {
	/** Optional name for the route, useful for matching/identification */
	name?: string;
}

/**
 * Result of matching a URL against registered routes
 */
export interface RouteMatch {
	/** Route parameters extracted from URL pattern matching */
	params: Record<string, string>;
	/** HTTP methods registered for this pattern */
	methods: string[];
	/** Route name if provided */
	name?: string;
	/** Original pattern string */
	pattern: string;
}

/**
 * Route entry stored by the router
 */
export interface RouteEntry {
	pattern: import("@b9g/match-pattern").MatchPattern;
	method: string;
	handler?: Handler;
	name?: string;
	middlewares: Middleware[];
}

/**
 * Internal middleware entry stored by the router
 */
export interface MiddlewareEntry {
	middleware: Middleware;
	/** If set, middleware only runs for paths matching this prefix */
	pathPrefix?: string;
}

/**
 * Result of internal route matching (for handle)
 */
interface InternalMatchResult {
	handler?: Handler;
	context: RouteContext;
	entry: RouteEntry;
}

// ============================================================================
// IMPLEMENTATION
// ============================================================================

/**
 * Radix tree node for fast route matching
 * Supports static segments, named parameters, and wildcards
 */
class RadixNode {
	children: Map<string, RadixNode>; // char -> RadixNode
	routes: Map<string, RouteEntry>; // method -> RouteEntry
	paramName: string | null; // param name if this is a :param segment
	paramChild: RadixNode | null; // child node for :param
	wildcardChild: RadixNode | null; // child node for * wildcard

	constructor() {
		this.children = new Map();
		this.routes = new Map();
		this.paramName = null;
		this.paramChild = null;
		this.wildcardChild = null;
	}
}

/**
 * Route entry for complex patterns that need regex matching
 */
interface ComplexRouteEntry {
	compiled: CompiledPattern;
	route: RouteEntry;
}

/**
 * RadixTreeExecutor uses a radix tree for simple patterns and falls back
 * to regex matching for complex patterns (constraints, modifiers, etc.)
 *
 * Simple patterns: /users/:id, /api/health, /files/*
 * Complex patterns: /users/:id(\d+), /files/:path+, {/prefix}?/users
 */
class RadixTreeExecutor {
	#root: RadixNode;
	#complexRoutes: ComplexRouteEntry[];

	constructor(routes: RouteEntry[]) {
		this.#root = new RadixNode();
		this.#complexRoutes = [];
		for (const route of routes) {
			const pathname = route.pattern.pathname;

			if (isSimplePattern(pathname)) {
				// Simple pattern - add to radix tree
				this.#addToTree(pathname, route);
			} else {
				// Complex pattern - compile to regex
				const compiled = compilePathname(pathname);
				this.#complexRoutes.push({compiled, route});
			}
		}
	}

	/**
	 * Add a simple pattern to the radix tree
	 */
	#addToTree(pathname: string, route: RouteEntry): void {
		let node = this.#root;
		let i = 0;

		while (i < pathname.length) {
			const char = pathname[i];

			if (char === ":") {
				// Named parameter - find the param name
				const match = pathname.slice(i).match(/^:(\w+)/);
				if (match) {
					const paramName = match[1];

					if (!node.paramChild) {
						node.paramChild = new RadixNode();
						node.paramChild.paramName = paramName;
					}
					node = node.paramChild;
					i += match[0].length;
					continue;
				}
			}

			if (char === "*") {
				// Wildcard - matches rest of path
				if (!node.wildcardChild) {
					node.wildcardChild = new RadixNode();
				}
				node = node.wildcardChild;
				break; // Wildcard consumes everything
			}

			// Static character
			if (!node.children.has(char)) {
				node.children.set(char, new RadixNode());
			}
			node = node.children.get(char)!;
			i++;
		}

		node.routes.set(route.method, route);
	}

	/**
	 * Match a pathname against the radix tree (for URL matching)
	 */
	#matchTreeByPath(
		pathname: string,
	): {node: RadixNode; params: Record<string, string>} | null {
		const params: Record<string, string> = {};
		let node = this.#root;
		let i = 0;

		// Handle empty pathname
		if (!pathname) {
			return node.routes.size > 0 ? {node, params} : null;
		}

		while (i < pathname.length) {
			const char = pathname[i];

			// Try static match first
			if (node.children.has(char)) {
				node = node.children.get(char)!;
				i++;
				continue;
			}

			// Try param match
			if (node.paramChild) {
				// Find end of segment (next / or end of string)
				let j = i;
				while (j < pathname.length && pathname[j] !== "/") {
					j++;
				}

				const value = pathname.slice(i, j);
				if (value) {
					// Non-empty segment
					params[node.paramChild.paramName!] = value;
					node = node.paramChild;
					i = j;
					continue;
				}
			}

			// Try wildcard match
			if (node.wildcardChild) {
				// Wildcard captures rest of path (without leading /)
				const rest = pathname.slice(i);
				params["0"] = rest; // Use "0" as wildcard param name
				node = node.wildcardChild;
				break;
			}

			// No match
			return null;
		}

		// Check if this node has any routes or a wildcard child with routes
		if (node.routes.size > 0) {
			return {node, params};
		}

		// Check wildcard at terminal node (for patterns like /files/*)
		if (node.wildcardChild && node.wildcardChild.routes.size > 0) {
			params["0"] = ""; // Empty wildcard match
			return {node: node.wildcardChild, params};
		}

		return null;
	}

	/**
	 * Match a pathname against the radix tree (for request handling with method)
	 */
	#matchTree(
		pathname: string,
		method: string,
	): {entry: RouteEntry; params: Record<string, string>} | null {
		const result = this.#matchTreeByPath(pathname);
		if (!result) return null;

		const {node, params} = result;
		let entry = node.routes.get(method);
		// HEAD requests should fall back to GET handler (RFC 7231)
		if (!entry && method === "HEAD") {
			entry = node.routes.get("GET");
		}
		if (entry) {
			return {entry, params};
		}

		return null;
	}

	/**
	 * Match a URL against registered routes (returns RouteMatch info)
	 */
	matchURL(url: string | URL): RouteMatch | null {
		const urlObj =
			typeof url === "string" ? new URL(url, "http://localhost") : url;
		const pathname = urlObj.pathname;

		// Try radix tree first (fast path for simple routes)
		const treeResult = this.#matchTreeByPath(pathname);
		if (treeResult) {
			const {node, params} = treeResult;
			const methods = Array.from(node.routes.keys());
			// Get name from first route entry (all entries for same pattern should have same name)
			const firstEntry = node.routes.values().next().value;
			return {
				params,
				methods,
				name: firstEntry?.name,
				pattern: firstEntry?.pattern.pathname ?? "",
			};
		}

		// Fall back to regex for complex routes
		for (const {compiled, route} of this.#complexRoutes) {
			const match = pathname.match(compiled.regex);
			if (match) {
				const params: Record<string, string> = {};
				for (let i = 0; i < compiled.paramNames.length; i++) {
					if (match[i + 1] !== undefined) {
						params[compiled.paramNames[i]] = match[i + 1];
					}
				}
				// Collect all methods for this pattern
				const methods = this.#complexRoutes
					.filter((r) => r.route.pattern.pathname === route.pattern.pathname)
					.map((r) => r.route.method);
				return {
					params,
					methods,
					name: route.name,
					pattern: route.pattern.pathname,
				};
			}
		}

		return null;
	}

	/**
	 * Find the first route that matches the request (for handling)
	 */
	matchRequest(request: Request): InternalMatchResult | null {
		const url = new URL(request.url);
		const method = request.method.toUpperCase();
		const pathname = url.pathname;

		// Try radix tree first (fast path for simple routes)
		const treeResult = this.#matchTree(pathname, method);
		if (treeResult) {
			return {
				handler: treeResult.entry.handler,
				context: {params: treeResult.params},
				entry: treeResult.entry,
			};
		}

		// Fall back to regex for complex routes
		for (const {compiled, route} of this.#complexRoutes) {
			// HEAD requests should fall back to GET handler (RFC 7231)
			const methodMatches =
				route.method === method ||
				(method === "HEAD" && route.method === "GET");
			if (!methodMatches) {
				continue;
			}

			const match = pathname.match(compiled.regex);
			if (match) {
				const params: Record<string, string> = {};
				for (let i = 0; i < compiled.paramNames.length; i++) {
					if (match[i + 1] !== undefined) {
						params[compiled.paramNames[i]] = match[i + 1];
					}
				}
				return {
					handler: route.handler,
					context: {params},
					entry: route,
				};
			}
		}

		return null;
	}
}

/**
 * RouteBuilder provides a chainable API for defining routes with multiple HTTP methods
 *
 * Example:
 *   router.route('/api/users/:id', { name: 'user' })
 *     .use(authMiddleware)
 *     .get(getUserHandler)
 *     .put(updateUserHandler)
 *     .delete(deleteUserHandler);
 */
export class RouteBuilder {
	#router: Router;
	#pattern: string;
	#name?: string;
	#middlewares: Middleware[];

	constructor(router: Router, pattern: string, options?: RouteOptions) {
		this.#router = router;
		this.#pattern = pattern;
		this.#name = options?.name;
		this.#middlewares = [];
	}

	/**
	 * Add route-scoped middleware that only runs when this pattern matches
	 */
	use(middleware: Middleware): RouteBuilder {
		this.#middlewares.push(middleware);
		return this;
	}

	/**
	 * Register a GET handler for this route pattern
	 */
	get(handler?: Handler): RouteBuilder {
		this.#router.addRoute(
			"GET",
			this.#pattern,
			handler,
			this.#name,
			this.#middlewares,
		);
		return this;
	}

	/**
	 * Register a POST handler for this route pattern
	 */
	post(handler?: Handler): RouteBuilder {
		this.#router.addRoute(
			"POST",
			this.#pattern,
			handler,
			this.#name,
			this.#middlewares,
		);
		return this;
	}

	/**
	 * Register a PUT handler for this route pattern
	 */
	put(handler?: Handler): RouteBuilder {
		this.#router.addRoute(
			"PUT",
			this.#pattern,
			handler,
			this.#name,
			this.#middlewares,
		);
		return this;
	}

	/**
	 * Register a DELETE handler for this route pattern
	 */
	delete(handler?: Handler): RouteBuilder {
		this.#router.addRoute(
			"DELETE",
			this.#pattern,
			handler,
			this.#name,
			this.#middlewares,
		);
		return this;
	}

	/**
	 * Register a PATCH handler for this route pattern
	 */
	patch(handler?: Handler): RouteBuilder {
		this.#router.addRoute(
			"PATCH",
			this.#pattern,
			handler,
			this.#name,
			this.#middlewares,
		);
		return this;
	}

	/**
	 * Register a HEAD handler for this route pattern
	 */
	head(handler?: Handler): RouteBuilder {
		this.#router.addRoute(
			"HEAD",
			this.#pattern,
			handler,
			this.#name,
			this.#middlewares,
		);
		return this;
	}

	/**
	 * Register an OPTIONS handler for this route pattern
	 */
	options(handler?: Handler): RouteBuilder {
		this.#router.addRoute(
			"OPTIONS",
			this.#pattern,
			handler,
			this.#name,
			this.#middlewares,
		);
		return this;
	}

	/**
	 * Register a handler for all HTTP methods on this route pattern
	 */
	all(handler?: Handler): RouteBuilder {
		const methods: HTTPMethod[] = [
			"GET",
			"POST",
			"PUT",
			"DELETE",
			"PATCH",
			"HEAD",
			"OPTIONS",
		];
		methods.forEach((method) => {
			this.#router.addRoute(
				method,
				this.#pattern,
				handler,
				this.#name,
				this.#middlewares,
			);
		});
		return this;
	}
}

/**
 * Router provides Request/Response routing with middleware support
 * Designed to work universally across all JavaScript runtimes
 */
export class Router {
	readonly routes: RouteEntry[];
	readonly middlewares: MiddlewareEntry[];
	#executor: RadixTreeExecutor | null;

	constructor() {
		this.routes = [];
		this.middlewares = [];
		this.#executor = null;
	}

	/**
	 * Ensure the executor is compiled and up to date
	 */
	#ensureCompiled(): RadixTreeExecutor {
		if (!this.#executor) {
			this.#executor = new RadixTreeExecutor(this.routes);
		}
		return this.#executor;
	}

	/**
	 * Register middleware that applies to all routes
	 * Middleware executes in the order it was registered
	 */
	use(middleware: Middleware): void;

	/**
	 * Register middleware that only applies to routes matching the path prefix
	 */
	use(pathPrefix: string, middleware: Middleware): void;

	use(
		pathPrefixOrMiddleware: string | Middleware,
		maybeMiddleware?: Middleware,
	): void {
		if (typeof pathPrefixOrMiddleware === "string") {
			// Path-scoped middleware
			const middleware = maybeMiddleware!;
			if (!this.#isValidMiddleware(middleware)) {
				throw new Error(
					"Invalid middleware type. Must be function or async generator function.",
				);
			}
			this.middlewares.push({
				middleware,
				pathPrefix: pathPrefixOrMiddleware,
			});
		} else {
			// Global middleware
			if (!this.#isValidMiddleware(pathPrefixOrMiddleware)) {
				throw new Error(
					"Invalid middleware type. Must be function or async generator function.",
				);
			}
			this.middlewares.push({middleware: pathPrefixOrMiddleware});
		}
		this.#executor = null;
	}

	/**
	 * Create a route builder for the given pattern
	 * Returns a chainable interface for registering HTTP method handlers
	 *
	 * Example:
	 *   router.route('/api/users/:id', { name: 'user' })
	 *     .use(authMiddleware)
	 *     .get(getUserHandler)
	 *     .put(updateUserHandler);
	 */
	route(pattern: string, options?: RouteOptions): RouteBuilder {
		return new RouteBuilder(this, pattern, options);
	}

	/**
	 * Internal method called by RouteBuilder to register routes
	 * Public for RouteBuilder access, but not intended for direct use
	 */
	addRoute(
		method: HTTPMethod,
		pattern: string,
		handler?: Handler,
		name?: string,
		middlewares: Middleware[] = [],
	): void {
		const matchPattern = new MatchPattern(pattern);

		this.routes.push({
			pattern: matchPattern,
			method: method.toUpperCase(),
			handler,
			name,
			middlewares: middlewares,
		});
		this.#executor = null;
	}

	/**
	 * Match a URL against registered routes
	 * Returns route info (params, methods, name, pattern) or null if no match
	 * Does not execute handlers - use handle() for that
	 */
	match(url: string | URL): RouteMatch | null {
		const executor = this.#ensureCompiled();
		return executor.matchURL(url);
	}

	/**
	 * Handle a request - main entrypoint for ServiceWorker usage
	 * Executes the matched handler with middleware chain
	 */
	async handle(request: Request): Promise<Response> {
		const executor = this.#ensureCompiled();

		try {
			// Find matching route
			const matchResult = executor.matchRequest(request);

			let handler: Handler;
			let context: RouteContext;
			let routeMiddleware: Middleware[] = [];

			if (matchResult) {
				// Route found - use its handler and context
				if (!matchResult.handler) {
					throw new NotFound("Route has no handler");
				}
				handler = matchResult.handler;
				context = matchResult.context;
				routeMiddleware = matchResult.entry.middlewares;
			} else {
				// No route found - use 404 handler and empty context
				handler = async () => {
					throw new NotFound();
				};
				context = {params: {}};
			}

			// Execute middleware chain with the handler
			let response = await this.#executeMiddlewareStack(
				this.middlewares,
				routeMiddleware,
				request,
				context,
				handler,
			);

			// HEAD requests should return headers only, no body (RFC 7231)
			if (request.method.toUpperCase() === "HEAD") {
				response = new Response(null, {
					status: response.status,
					statusText: response.statusText,
					headers: response.headers,
				});
			}

			return response;
		} catch (error) {
			// Final catch-all for unhandled errors
			return this.#createErrorResponse(error as Error);
		}
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
		const subroutes = subrouter.routes;

		// Add each subroute with the mount path prefix
		for (const subroute of subroutes) {
			// Combine mount path with subroute pattern
			const mountedPattern = this.#combinePaths(
				normalizedMountPath,
				subroute.pattern.pathname,
			);

			// Add the route to this router
			this.routes.push({
				pattern: new MatchPattern(mountedPattern),
				method: subroute.method,
				handler: subroute.handler,
				name: subroute.name,
				middlewares: subroute.middlewares,
			});
		}

		// Get all middleware from the subrouter and add with mount path prefix
		const submiddlewares = subrouter.middlewares;
		for (const submiddleware of submiddlewares) {
			// Compose the mount path with any existing pathPrefix
			// If subrouter middleware has pathPrefix "/inner", and we mount at "/outer",
			// the composed prefix becomes "/outer/inner"
			let composedPrefix: string;
			if (submiddleware.pathPrefix) {
				composedPrefix = this.#combinePaths(
					normalizedMountPath,
					submiddleware.pathPrefix,
				);
			} else {
				// Subrouter global middleware becomes scoped to mount path
				composedPrefix = normalizedMountPath;
			}
			this.middlewares.push({
				middleware: submiddleware.middleware,
				pathPrefix: composedPrefix,
			});
		}

		this.#executor = null;
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
			constructorName === "GeneratorFunction" ||
			constructorName === "AsyncFunction" ||
			constructorName === "Function"
		);
	}

	/**
	 * Detect if a function is a generator middleware
	 */
	#isGeneratorMiddleware(middleware: Middleware): boolean {
		const name = middleware.constructor.name;
		return name === "GeneratorFunction" || name === "AsyncGeneratorFunction";
	}

	/**
	 * Check if a request pathname matches a middleware's path prefix
	 * Matches on segment boundaries: /admin matches /admin, /admin/, /admin/users
	 * but NOT /administrator
	 */
	#matchesPathPrefix(pathname: string, pathPrefix: string): boolean {
		// Exact match
		if (pathname === pathPrefix) {
			return true;
		}

		// Check if pathname starts with prefix followed by / or end of string
		if (pathname.startsWith(pathPrefix)) {
			const nextChar = pathname[pathPrefix.length];
			// Must be followed by / or be at end (for trailing slash case)
			return nextChar === "/" || nextChar === undefined;
		}

		return false;
	}

	/**
	 * Execute a single middleware and track generator state
	 * Returns true if middleware short-circuited (returned Response early)
	 */
	async #executeMiddleware(
		middleware: Middleware,
		request: Request,
		context: RouteContext,
		runningGenerators: Array<{generator: ReturnType<GeneratorMiddleware>}>,
	): Promise<Response | null> {
		if (this.#isGeneratorMiddleware(middleware)) {
			const generator = (middleware as GeneratorMiddleware)(request, context);
			const result = await generator.next();

			if (result.done) {
				// Early return (0 yields) - check if Response returned for short-circuiting
				if (result.value) {
					return result.value;
				}
			} else {
				// Generator yielded - save for later resumption
				runningGenerators.push({generator});
			}
		} else {
			// Function middleware - execute and check for short-circuit
			const result = await (middleware as FunctionMiddleware)(request, context);
			if (result) {
				// Function middleware returned a Response - short-circuit
				return result;
			}
		}
		return null;
	}

	/**
	 * Execute middleware stack with guaranteed execution using Rack-style LIFO order
	 * Global/path middleware runs first, then route-scoped middleware, then handler
	 */
	async #executeMiddlewareStack(
		globalMiddlewares: MiddlewareEntry[],
		routeMiddlewares: Middleware[],
		request: Request,
		context: RouteContext,
		handler: Handler,
	): Promise<Response> {
		const runningGenerators: Array<{
			generator: ReturnType<GeneratorMiddleware>;
		}> = [];
		let currentResponse: Response | null = null;

		// Extract pathname from request URL for prefix matching
		const requestPathname = new URL(request.url).pathname;

		// Phase 1a: Execute global/path-scoped middleware "before" phases
		for (const entry of globalMiddlewares) {
			// Skip middleware if it has a pathPrefix that doesn't match
			if (
				entry.pathPrefix &&
				!this.#matchesPathPrefix(requestPathname, entry.pathPrefix)
			) {
				continue;
			}

			currentResponse = await this.#executeMiddleware(
				entry.middleware,
				request,
				context,
				runningGenerators,
			);
			if (currentResponse) break; // Short-circuit
		}

		// Phase 1b: Execute route-scoped middleware "before" phases
		if (!currentResponse) {
			for (const middleware of routeMiddlewares) {
				currentResponse = await this.#executeMiddleware(
					middleware,
					request,
					context,
					runningGenerators,
				);
				if (currentResponse) break; // Short-circuit
			}
		}

		// Phase 2: Get handler response if no middleware returned early
		if (!currentResponse) {
			// Execute handler
			let handlerError: Error | null = null;
			try {
				currentResponse = await handler(request, context);
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

		// Phase 3: Resume all generators in reverse order (LIFO - Last In First Out)
		// This implements the Rack-style guaranteed execution
		for (let i = runningGenerators.length - 1; i >= 0; i--) {
			const {generator} = runningGenerators[i];
			// currentResponse should always be set by this point (from handler or short-circuit)
			// Use non-null assertion since generators expect a Response
			const result = await generator.next(currentResponse!);
			// result.value is the return value (Response | null | undefined), not the yield (Request)
			if (result.value && result.done) {
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
		runningGenerators: Array<{generator: ReturnType<GeneratorMiddleware>}>,
	): Promise<Response> {
		// Try error handling starting from the innermost middleware (reverse order)
		for (let i = runningGenerators.length - 1; i >= 0; i--) {
			const {generator} = runningGenerators[i];

			try {
				const result = await generator.throw(error);
				// When done=true, value is the return type (Response | null | undefined)
				// When done=false, value is the yield type (Request) - generator caught and re-yielded
				if (result.done && result.value) {
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
	 * Create an error response for unhandled errors
	 * Uses HTTPError.toResponse() for consistent error formatting
	 */
	#createErrorResponse(error: Error): Response {
		// Log the error in development for debugging
		const isDev = import.meta.env?.MODE !== "production";
		if (isDev && !isHTTPError(error)) {
			logger.error`Unhandled error: ${error}`;
		}

		// Convert to HTTPError for consistent response format
		const httpError = isHTTPError(error)
			? (error as HTTPError)
			: new InternalServerError(error.message, {cause: error});

		return httpError.toResponse(isDev);
	}
}
