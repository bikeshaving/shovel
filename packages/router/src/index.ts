/**
 * @b9g/router - Universal request router built on web standards
 * 
 * Features:
 * - Pure Request/Response routing (works anywhere)
 * - Middleware chain with next() continuation
 * - Chainable route builder API
 * - Integration with @b9g/match-pattern for enhanced URL matching
 * - Prepared for future cache-first architecture
 */

// Main router class
export { Router } from './router.js';

// Public types for TypeScript users
export type { 
  Handler, 
  Middleware, 
  RouteContext,
  HttpMethod,
  RouterOptions,
  RouteConfig,
  RouteCacheConfig
} from './_types.js';