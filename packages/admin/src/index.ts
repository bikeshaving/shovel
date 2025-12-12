/**
 * @b9g/admin - Django-like admin interface for Shovel applications
 *
 * Provides automatic CRUD interfaces for @b9g/database collections with:
 * - OAuth2 authentication (Google, GitHub, Microsoft)
 * - Session management via Cache API
 * - Crank.js + USWDS for the UI
 *
 * @example
 * ```typescript
 * import { Router } from '@b9g/router';
 * import { createAdmin } from '@b9g/admin';
 * import * as schema from './schema.js';
 *
 * const admin = createAdmin({
 *   database: 'main',
 *   schema,
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
	isCollection,
	introspectCollection,
	introspectSchema,
	getDisplayName,
	getPluralDisplayName,
} from "./core/introspection.js";

// Main factory
export {createAdmin} from "./admin.jsx";
