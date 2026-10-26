/**
 * @b9g/admin - Django-like admin interface for Shovel applications
 *
 * Provides automatic CRUD interfaces for @b9g/zen tables with:
 * - A required authorization check on every route
 * - Same-origin CSRF protection for form submissions
 * - Crank.js + USWDS for the UI
 *
 * @example
 * ```typescript
 * import { Router } from '@b9g/router';
 * import { AdminRouter } from '@b9g/admin';
 * import * as schema from './schema.js';
 *
 * const admin = new AdminRouter({
 *   database: 'main',
 *   schema,
 *   // Called for every admin request; return true to allow
 *   authorize: async (request) => {
 *     const session = await getSession(request);
 *     return session?.user.isAdmin ?? false;
 *   },
 * });
 *
 * // Access introspected models
 * console.log(admin.models);
 *
 * // Mount on a path
 * const router = new Router();
 * router.mount('/admin', admin);
 * ```
 */

export {
	AdminRouter,
	createAdmin,
	type AdminConfig,
	type AdminAuthorize,
	type ModelConfig,
	type BrandingConfig,
} from "./admin.jsx";
