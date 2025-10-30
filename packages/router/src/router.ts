import { MatchPattern } from '@b9g/match-pattern';
import type { 
  Handler, 
  Middleware, 
  RouteEntry, 
  MiddlewareEntry, 
  RouteContext,
  HttpMethod,
  MatchResult,
  RouterOptions,
  RouteConfig,
  RouteCacheConfig
} from './_types.js';

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
              params: result.params
            },
            cacheConfig: route.cache
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
  private middleware: Middleware[] = [];
  
  constructor(
    private router: Router,
    private pattern: string,
    private cacheConfig?: RouteCacheConfig
  ) {}

  /**
   * Add middleware to this route
   */
  use(middleware: Middleware): RouteBuilder {
    this.middleware.push(middleware);
    return this;
  }

  /**
   * Register a GET handler for this route pattern
   */
  get(handler: Handler): RouteBuilder {
    this.router.addRoute('GET', this.pattern, handler, this.cacheConfig, this.middleware);
    return this;
  }

  /**
   * Register a POST handler for this route pattern
   */
  post(handler: Handler): RouteBuilder {
    this.router.addRoute('POST', this.pattern, handler, this.cacheConfig, this.middleware);
    return this;
  }

  /**
   * Register a PUT handler for this route pattern
   */
  put(handler: Handler): RouteBuilder {
    this.router.addRoute('PUT', this.pattern, handler, this.cacheConfig, this.middleware);
    return this;
  }

  /**
   * Register a DELETE handler for this route pattern
   */
  delete(handler: Handler): RouteBuilder {
    this.router.addRoute('DELETE', this.pattern, handler, this.cacheConfig, this.middleware);
    return this;
  }

  /**
   * Register a PATCH handler for this route pattern
   */
  patch(handler: Handler): RouteBuilder {
    this.router.addRoute('PATCH', this.pattern, handler, this.cacheConfig, this.middleware);
    return this;
  }

  /**
   * Register a HEAD handler for this route pattern
   */
  head(handler: Handler): RouteBuilder {
    this.router.addRoute('HEAD', this.pattern, handler, this.cacheConfig, this.middleware);
    return this;
  }

  /**
   * Register an OPTIONS handler for this route pattern
   */
  options(handler: Handler): RouteBuilder {
    this.router.addRoute('OPTIONS', this.pattern, handler, this.cacheConfig, this.middleware);
    return this;
  }

  /**
   * Register a handler for all HTTP methods on this route pattern
   */
  all(handler: Handler): RouteBuilder {
    const methods: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
    methods.forEach(method => {
      this.router.addRoute(method, this.pattern, handler, this.cacheConfig, this.middleware);
    });
    return this;
  }
}

/**
 * Router provides Request/Response routing with middleware support
 * Designed to work universally across all JavaScript runtimes
 */
export class Router {
  private routes: RouteEntry[] = [];
  private middlewares: MiddlewareEntry[] = [];
  private executor: LinearExecutor | null = null;
  private dirty = false;
  private caches?: import('@b9g/cache').CacheStorage;

  constructor(options?: RouterOptions) {
    this.caches = options?.caches;
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
    if (typeof patternOrMiddleware === 'string' && handler) {
      // Pattern-based handler registration
      this.addRoute('GET', patternOrMiddleware, handler);
      this.addRoute('POST', patternOrMiddleware, handler);
      this.addRoute('PUT', patternOrMiddleware, handler);
      this.addRoute('DELETE', patternOrMiddleware, handler);
      this.addRoute('PATCH', patternOrMiddleware, handler);
      this.addRoute('HEAD', patternOrMiddleware, handler);
      this.addRoute('OPTIONS', patternOrMiddleware, handler);
    } else if (typeof patternOrMiddleware === 'function') {
      // Global middleware registration
      this.middlewares.push({ middleware: patternOrMiddleware });
      this.dirty = true;
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
    if (typeof patternOrConfig === 'string') {
      return new RouteBuilder(this, patternOrConfig);
    } else {
      return new RouteBuilder(this, patternOrConfig.pattern, patternOrConfig.cache);
    }
  }

  /**
   * Internal method called by RouteBuilder to register routes
   * Public for RouteBuilder access, but not intended for direct use
   */
  addRoute(method: HttpMethod, pattern: string, handler: Handler, cache?: RouteCacheConfig, middleware?: Middleware[]): void {
    const matchPattern = new MatchPattern(pattern);
    
    // Create composite handler that runs middleware chain before final handler
    const compositeHandler: Handler = async (request: Request, context: RouteContext) => {
      if (!middleware || middleware.length === 0) {
        return handler(request, context);
      }
      
      let middlewareIndex = 0;
      const next = async (): Promise<Response> => {
        if (middlewareIndex >= middleware.length) {
          return handler(request, context);
        }
        const currentMiddleware = middleware[middlewareIndex++];
        return currentMiddleware(request, context, next);
      };
      
      return next();
    };
    
    this.routes.push({
      pattern: matchPattern,
      method: method.toUpperCase(),
      handler: compositeHandler,
      cache
    });
    this.dirty = true;
  }

  /**
   * Handle a request - main entrypoint for ServiceWorker usage
   * Returns a response or throws if no route matches
   */
  handler = async (request: Request): Promise<Response> => {
    // Lazy compilation - build executor on first match
    if (this.dirty || !this.executor) {
      this.executor = new LinearExecutor(this.routes);
      this.dirty = false;
    }

    // Find matching route
    const matchResult = this.executor.match(request);
    
    if (matchResult) {
      // Route found - build context and execute middleware chain + handler
      const context = await this.buildContext(matchResult.context, matchResult.cacheConfig);
      return this.executeMiddlewareChain(request, context, matchResult.handler);
    } else {
      // No route found - execute global middleware with 404 fallback
      const notFoundHandler = async (): Promise<Response> => {
        return new Response('Not Found', { status: 404 });
      };
      return this.executeMiddlewareChain(request, {}, notFoundHandler);
    }
  };

  /**
   * Match a request against registered routes and execute the handler chain
   * Returns the response from the matched handler, or null if no route matches
   */
  async match(request: Request): Promise<Response | null> {
    // Lazy compilation - build executor on first match
    if (this.dirty || !this.executor) {
      this.executor = new LinearExecutor(this.routes);
      this.dirty = false;
    }

    // Find matching route
    const matchResult = this.executor.match(request);
    if (!matchResult) {
      return null;
    }

    // Build complete context with cache access
    const context = await this.buildContext(matchResult.context, matchResult.cacheConfig);

    // Execute middleware chain followed by the handler
    return this.executeMiddlewareChain(request, context, matchResult.handler);
  }

  /**
   * Build the complete route context including cache access
   */
  private async buildContext(baseContext: RouteContext, cacheConfig?: RouteCacheConfig): Promise<RouteContext> {
    const context: RouteContext = { ...baseContext };

    if (this.caches) {
      context.caches = this.caches;

      // Open the named cache if configured for this route
      if (cacheConfig?.name) {
        try {
          context.cache = await this.caches.open(cacheConfig.name);
        } catch (error) {
          console.warn(`Failed to open cache '${cacheConfig.name}':`, error);
          // Continue without cache - don't fail the request
        }
      }
    }

    return context;
  }

  /**
   * Execute the middleware chain and final handler
   * Each middleware can short-circuit by returning a Response without calling next()
   */
  private async executeMiddlewareChain(
    request: Request,
    context: RouteContext,
    handler: Handler
  ): Promise<Response> {
    let middlewareIndex = 0;

    const next = async (): Promise<Response> => {
      // If we've executed all middleware, call the final handler
      if (middlewareIndex >= this.middlewares.length) {
        return handler(request, context);
      }

      // Execute the next middleware
      const middleware = this.middlewares[middlewareIndex++];
      return middleware.middleware(request, context, next);
    };

    return next();
  }

  /**
   * Get registered routes for debugging/introspection
   */
  getRoutes(): RouteEntry[] {
    return [...this.routes];
  }

  /**
   * Get registered middleware for debugging/introspection  
   */
  getMiddlewares(): MiddlewareEntry[] {
    return [...this.middlewares];
  }

  /**
   * Get route statistics
   */
  getStats() {
    return {
      routeCount: this.routes.length,
      middlewareCount: this.middlewares.length,
      compiled: !this.dirty && this.executor !== null
    };
  }
}