/**
 * @b9g/admin - Schema introspection utilities
 *
 * Extracts metadata from @b9g/database collections for dynamic admin generation.
 */

import type {Collection, FieldMeta} from "@b9g/database";
import type {
	ColumnMetadata,
	ColumnDataType,
	TableMetadata,
	ForeignKeyMetadata,
} from "../types.js";

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if an object is a @b9g/database collection
 */
export function isCollection(value: unknown): value is Collection<any> {
	return (
		value !== null &&
		typeof value === "object" &&
		"name" in value &&
		"schema" in value &&
		"fields" in value &&
		typeof (value as any).fields === "function"
	);
}

// ============================================================================
// Data Type Mapping
// ============================================================================

/**
 * Map @b9g/database field type to admin ColumnDataType
 */
function mapFieldType(fieldType: FieldMeta["type"]): ColumnDataType {
	switch (fieldType) {
		case "text":
		case "textarea":
		case "email":
		case "url":
		case "tel":
		case "password":
		case "hidden":
			return "string";
		case "number":
		case "integer":
			return "number";
		case "checkbox":
			return "boolean";
		case "date":
			return "date";
		case "datetime":
		case "time":
			return "datetime";
		case "json":
			return "json";
		case "select":
			return "string"; // enums are strings
		default:
			return "string";
	}
}

// ============================================================================
// Collection Introspection
// ============================================================================

/**
 * Extract metadata from a @b9g/database collection
 */
export function introspectCollection(collection: Collection<any>): TableMetadata {
	const fieldsMeta = collection.fields();
	const refs = collection.references();

	// Convert fields to columns
	const columns: ColumnMetadata[] = Object.entries(fieldsMeta).map(
		([key, field]) => ({
			name: key, // field name is the key
			key,
			dataType: mapFieldType(field.type),
			sqlType: field.type, // Use field type as SQL type hint
			notNull: field.required,
			hasDefault: field.default !== undefined,
			isPrimaryKey: field.primaryKey ?? false,
			enumValues: field.options ? [...field.options] : undefined,
		}),
	);

	// Get primary key
	const pk = collection.primaryKey();
	const primaryKey: string[] = pk
		? Array.isArray(pk)
			? pk
			: [pk]
		: [];

	// Convert references to foreign keys
	const foreignKeys: ForeignKeyMetadata[] = refs.map((ref) => ({
		columns: [ref.fieldName],
		foreignTable: ref.collection.name,
		foreignColumns: [ref.referencedField],
	}));

	return {
		name: collection.name,
		columns,
		primaryKey,
		foreignKeys,
	};
}

// ============================================================================
// Schema Introspection
// ============================================================================

/**
 * Introspect an entire schema object containing collections
 *
 * @param schema - An object containing @b9g/database collection definitions
 * @returns Map of table names to their metadata
 *
 * @example
 * ```typescript
 * import * as schema from './db/schema';
 *
 * const metadata = introspectSchema(schema);
 * for (const [name, table] of metadata) {
 *   console.log(name, table.columns);
 * }
 * ```
 */
export function introspectSchema(
	schema: Record<string, unknown>,
): Map<string, TableMetadata> {
	const tables = new Map<string, TableMetadata>();

	for (const value of Object.values(schema)) {
		if (isCollection(value)) {
			const metadata = introspectCollection(value);
			tables.set(metadata.name, metadata);
		}
	}

	return tables;
}

// ============================================================================
// Utility Exports
// ============================================================================

/**
 * Get the display name for a table (converts snake_case to Title Case)
 */
export function getDisplayName(tableName: string): string {
	return tableName
		.split("_")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
}

/**
 * Get the plural display name for a table
 */
export function getPluralDisplayName(tableName: string): string {
	const singular = getDisplayName(tableName);
	// Simple pluralization - handles most cases
	if (singular.endsWith("y")) {
		return singular.slice(0, -1) + "ies";
	}
	if (
		singular.endsWith("s") ||
		singular.endsWith("x") ||
		singular.endsWith("ch") ||
		singular.endsWith("sh")
	) {
		return singular + "es";
	}
	return singular + "s";
}
