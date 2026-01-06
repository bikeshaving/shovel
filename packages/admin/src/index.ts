/**
 * @b9g/admin - Django-like admin interface for Shovel applications
 *
 * Provides automatic CRUD interfaces for @b9g/zen tables with:
 * - OAuth2 authentication (Google, GitHub, Microsoft)
 * - Session management via Cache API
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
 *   auth: {
 *     providers: ['google', 'github'],
 *     allowedDomains: ['mycompany.com'],
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
	type AuthConfig,
	type AuthProvider,
	type ModelConfig,
	type BrandingConfig,
} from "./admin.jsx";
