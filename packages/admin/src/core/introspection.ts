/**
 * @b9g/admin - Schema introspection utilities
 *
 * Thin wrapper around zen's introspection APIs for admin-specific needs.
 * Uses zen's raw schema/db APIs instead of deprecated cooked properties.
 */

import {isTable, z} from "@b9g/zen";
import type {Table, FieldMeta, ReferenceInfo} from "@b9g/zen";

// ============================================================================
// Admin-specific types (simplified for UI rendering)
// ============================================================================

/**
 * Simplified data type for admin UI rendering
 */
export type AdminDataType =
	| "string"
	| "number"
	| "boolean"
	| "date"
	| "datetime"
	| "json";

/**
 * Admin-specific column info (derived from zen's FieldMeta)
 */
export interface AdminColumnInfo {
	/** Field name */
	name: string;
	/** Simplified data type for UI */
	dataType: AdminDataType;
	/** Whether the field is required for insert */
	required: boolean;
	/** Whether the field has an auto-generated value */
	hasAutoValue: boolean;
	/** Whether this is the primary key */
	isPrimaryKey: boolean;
	/** Enum values if this is an enum field */
	enumValues?: string[];
	/** The raw zen FieldMeta for advanced use */
	fieldMeta: FieldMeta;
}

/**
 * Admin-specific table info
 */
export interface AdminTableInfo {
	/** Table name */
	name: string;
	/** Column info for each field */
	columns: AdminColumnInfo[];
	/** Primary key field name */
	primaryKey: string | null;
	/** Foreign key relationships */
	foreignKeys: {
		column: string;
		foreignTable: string;
		foreignColumn: string;
	}[];
	/** The raw zen Table for advanced use */
	table: Table<any>;
}

// ============================================================================
// Zod Schema Introspection
// ============================================================================

// Note: We use `unknown` for schema types to avoid Zod version compatibility issues.
// The zen package may use a different Zod internals ($ZodType vs ZodType).

/**
 * Unwrap a Zod schema to get the innermost type (strips optional, nullable, default, etc.)
 */
function unwrapZodSchema(schema: unknown): unknown {
	const s = schema as any;
	if (s instanceof z.ZodOptional || s instanceof z.ZodNullable) {
		return unwrapZodSchema(s.unwrap());
	}
	if (s instanceof z.ZodDefault) {
		return unwrapZodSchema(s._def.innerType);
	}
	return schema;
}

/**
 * Infer AdminDataType from a Zod schema
 */
function inferDataType(schema: unknown): AdminDataType {
	const inner = unwrapZodSchema(schema);

	if (inner instanceof z.ZodString) return "string";
	if (inner instanceof z.ZodNumber) return "number";
	if (inner instanceof z.ZodBoolean) return "boolean";
	if (inner instanceof z.ZodDate) return "date";
	if (inner instanceof z.ZodEnum) return "string";
	if (inner instanceof z.ZodObject || inner instanceof z.ZodArray)
		return "json";

	return "string"; // fallback
}

/**
 * Extract enum values from a Zod schema if it's an enum
 */
function extractEnumValues(schema: unknown): string[] | undefined {
	const inner = unwrapZodSchema(schema);
	if (inner instanceof z.ZodEnum) {
		return (inner as any).options as string[];
	}
	return undefined;
}

// ============================================================================
// Table Introspection
// ============================================================================

/**
 * Get admin-specific info for a zen table
 */
export function getAdminTableInfo(table: Table<any>): AdminTableInfo {
	const fieldsMeta = table.fields();
	const refs = table.references();
	const pk = table.primaryKey();

	// Filter to only actual column fields (have schema property)
	// table.fields() also returns relation accessors which don't have schema
	const columnEntries = Object.entries(fieldsMeta).filter(
		([, field]) => field && "schema" in field,
	) as [string, FieldMeta][];

	const columns: AdminColumnInfo[] = columnEntries.map(([name, field]) => {
		const isOptional = field.schema.isOptional();
		const hasAutoValue = !!(field.db.autoIncrement || field.db.inserted);

		return {
			name,
			dataType: inferDataType(field.schema),
			// Not required if optional or has auto value (db.inserted/db.autoIncrement)
			// Note: zen 0.1.6+ throws on Zod .default() in tables, so we don't check for it
			required: !isOptional && !hasAutoValue,
			hasAutoValue,
			isPrimaryKey: field.db.primaryKey ?? false,
			enumValues: extractEnumValues(field.schema),
			fieldMeta: field,
		};
	});

	const foreignKeys = refs.map((ref: ReferenceInfo) => ({
		column: ref.fieldName,
		foreignTable: ref.table.name,
		foreignColumn: ref.referencedField,
	}));

	return {
		name: table.name,
		columns,
		primaryKey: pk,
		foreignKeys,
		table,
	};
}

/**
 * Get admin info for all tables in a schema object
 */
export function getAdminSchemaInfo(
	schema: Record<string, unknown>,
): Map<string, AdminTableInfo> {
	const tables = new Map<string, AdminTableInfo>();

	for (const value of Object.values(schema)) {
		if (isTable(value)) {
			const info = getAdminTableInfo(value);
			tables.set(info.name, info);
		}
	}

	return tables;
}

// ============================================================================
// Display Utilities
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
