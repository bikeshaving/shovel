/**
 * Context object passed to handlers and middleware
 * Contains route parameters and cache access
 */
export interface RouteContext {
  /** Route parameters extracted from URL pattern matching */
  params: Record<string, string>;
  
  /** Named cache for this route (if configured) */
  cache?: import('@b9g/cache').Cache;
  
  /** Access to all registered caches */
  caches?: import('@b9g/cache').CacheStorage;
}

/**
 * Handler function signature - terminal response producer
 * No next() function - handlers must return a Response
 */
export type Handler = (
  request: Request, 
  context: RouteContext
) => Response | Promise<Response>;

/**
 * Middleware function signature - can pass control to next middleware/handler
 * Has next() function for flow control
 */
export type Middleware = (
  request: Request,
  context: RouteContext,
  next: () => Promise<Response>
) => Response | Promise<Response>;

/**
 * HTTP methods supported by the router
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';

/**
 * Cache configuration for routes
 */
export interface RouteCacheConfig {
  /** Name of the cache to use for this route */
  name: string;
  /** Cache query options */
  options?: import('@b9g/cache').CacheQueryOptions;
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
  caches?: import('@b9g/cache').CacheStorage;
}

// Internal types (not exported from main package)

/**
 * Internal route entry stored by the router
 */
export interface RouteEntry {
  pattern: import('@b9g/match-pattern').MatchPattern;
  method: string;
  handler: Handler;
  cache?: RouteCacheConfig;
}

/**
 * Internal middleware entry stored by the router
 */
export interface MiddlewareEntry {
  middleware: Middleware;
}

/**
 * Result of route matching
 */
export interface MatchResult {
  handler: Handler;
  context: RouteContext;
  cacheConfig?: RouteCacheConfig;
}