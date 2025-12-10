/**
 * @b9g/admin - Django-like admin interface for Shovel applications
 *
 * Provides automatic CRUD interfaces for Drizzle ORM schemas with:
 * - OAuth2 authentication (Google, GitHub, Microsoft)
 * - Session management via Cache API
 * - Crank.js + USWDS for the UI
 *
 * @example
 * ```typescript
 * import { Router } from '@b9g/router';
 * import { createAdmin } from '@b9g/admin';
 *
 * const admin = createAdmin({
 *   database: 'main',
 *   auth: {
 *     providers: ['google', 'github'],
 *     allowedDomains: ['mycompany.com'],
 *   },
 * });
 *
 * const router = new Router();
 * router.mount('/admin', admin);
 * ```
 */

// Re-export types
export type {
	AdminConfig,
	AuthConfig,
	AuthProvider,
	ModelConfig,
	BrandingConfig,
	AdminUser,
	AdminSession,
	AdminContext,
	TableMetadata,
	ColumnMetadata,
	ColumnDataType,
	ForeignKeyMetadata,
	RegisteredModel,
} from "./types.js";

// Re-export introspection utilities
export {
	isTable,
	introspectTable,
	introspectSchema,
	getDisplayName,
	getPluralDisplayName,
} from "./core/introspection.js";

// Main factory
export {createAdmin} from "./admin.js";
