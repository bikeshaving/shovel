/**
 * @b9g/admin - Type definitions
 *
 * Core interfaces for the admin package.
 */

// ============================================================================
// Admin Configuration
// ============================================================================

/**
 * OAuth2 provider names supported by the admin
 */
export type AuthProvider = "google" | "github" | "microsoft";

/**
 * Authentication configuration
 */
export interface AuthConfig {
	/** OAuth2 providers to enable */
	providers: AuthProvider[];
	/** Optional email domain whitelist (e.g., ['mycompany.com']) */
	allowedDomains?: string[];
	/** Session max age in seconds (default: 7 days) */
	sessionMaxAge?: number;
}

/**
 * Per-model display and behavior configuration
 */
export interface ModelConfig {
	/** Display name for the model (defaults to table name) */
	name?: string;
	/** Columns to show in list view (defaults to all non-blob columns) */
	listFields?: string[];
	/** Fields that can be searched */
	searchFields?: string[];
	/** Fields to hide from forms */
	excludeFields?: string[];
	/** Fields that cannot be edited */
	readOnlyFields?: string[];
	/** Items per page in list view (default: 25) */
	pageSize?: number;
}

/**
 * Admin branding customization
 */
export interface BrandingConfig {
	/** Admin panel title */
	title?: string;
	/** Logo URL */
	logo?: string;
}

/**
 * Main admin configuration
 */
export interface AdminConfig {
	/** Database name from shovel.json to use */
	database: string;
	/** Drizzle schema object containing table definitions */
	schema: Record<string, unknown>;
	/** Dialect-specific getTableConfig function */
	getTableConfig: (table: unknown) => unknown;
	/** Base path for admin routes (default: '/admin') */
	basePath?: string;
	/** Authentication configuration */
	auth: AuthConfig;
	/** Per-model customization keyed by table name */
	models?: Record<string, ModelConfig>;
	/** Branding customization */
	branding?: BrandingConfig;
}

// ============================================================================
// Schema Introspection
// ============================================================================

/**
 * Normalized column data type for UI rendering
 */
export type ColumnDataType =
	| "string"
	| "number"
	| "boolean"
	| "date"
	| "datetime"
	| "json"
	| "blob";

/**
 * Column metadata extracted from Drizzle schema
 */
export interface ColumnMetadata {
	/** Column name in the database (snake_case) */
	name: string;
	/** JavaScript property key on the table object (camelCase) */
	key: string;
	/** Normalized data type for UI */
	dataType: ColumnDataType;
	/** Original SQL type (e.g., 'varchar', 'integer', 'timestamp') */
	sqlType: string;
	/** Whether the column is NOT NULL */
	notNull: boolean;
	/** Whether the column has a default value */
	hasDefault: boolean;
	/** Whether this column is the primary key (or part of it) */
	isPrimaryKey: boolean;
	/** Enum values if this is an enum column */
	enumValues?: string[];
}

/**
 * Foreign key metadata
 */
export interface ForeignKeyMetadata {
	/** Column(s) in this table */
	columns: string[];
	/** Referenced table name */
	foreignTable: string;
	/** Referenced column(s) */
	foreignColumns: string[];
}

/**
 * Table metadata extracted from Drizzle schema
 */
export interface TableMetadata {
	/** Table name */
	name: string;
	/** All columns */
	columns: ColumnMetadata[];
	/** Primary key column names */
	primaryKey: string[];
	/** Foreign key relationships */
	foreignKeys: ForeignKeyMetadata[];
}

// ============================================================================
// Session and User
// ============================================================================

/**
 * Authenticated admin user
 */
export interface AdminUser {
	/** User ID from OAuth provider */
	id: string;
	/** User's email address */
	email: string;
	/** User's display name */
	name?: string;
	/** URL to user's avatar/picture */
	picture?: string;
	/** OAuth provider used to authenticate */
	provider: AuthProvider;
}

/**
 * Admin session data stored in cache
 */
export interface AdminSession {
	/** The authenticated user */
	user: AdminUser;
	/** Session creation timestamp */
	createdAt: number;
	/** Session expiration timestamp */
	expiresAt: number;
}

// ============================================================================
// Route Context Augmentation
// ============================================================================

/**
 * Context additions from auth middleware
 */
export interface AdminContext {
	/** Current authenticated user (set by auth middleware) */
	user: AdminUser;
	/** Current session (set by auth middleware) */
	session: AdminSession;
}

// ============================================================================
// Registry
// ============================================================================

/**
 * Registered model with merged metadata and config
 */
export interface RegisteredModel {
	/** Table metadata from introspection */
	metadata: TableMetadata;
	/** User configuration (merged with defaults) */
	config: Required<ModelConfig>;
}
