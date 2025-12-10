/**
 * @b9g/admin - Schema introspection utilities
 *
 * Extracts metadata from Drizzle ORM schemas for dynamic admin generation.
 * Supports SQLite, PostgreSQL, and MySQL dialects.
 */

import {isTable, getTableName, type Table} from "drizzle-orm";
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
 * Check if an object is a Drizzle table
 */
export {isTable};

// ============================================================================
// Data Type Mapping
// ============================================================================

/**
 * Map Drizzle's internal dataType to our normalized ColumnDataType
 */
function normalizeDataType(dataType: string, sqlType: string): ColumnDataType {
	// Drizzle uses these dataType values internally
	switch (dataType) {
		case "string":
			return "string";
		case "number":
			return "number";
		case "boolean":
			return "boolean";
		case "bigint":
			return "number";
		case "date":
			// Check SQL type to distinguish date vs datetime
			if (sqlType.toLowerCase().includes("timestamp") || sqlType.toLowerCase().includes("datetime")) {
				return "datetime";
			}
			return "date";
		case "json":
			return "json";
		case "custom":
			// Try to infer from SQL type
			return inferFromSqlType(sqlType);
		case "buffer":
		case "array":
			return "blob";
		default:
			return inferFromSqlType(sqlType);
	}
}

/**
 * Infer data type from SQL type string when dataType is unknown
 */
function inferFromSqlType(sqlType: string): ColumnDataType {
	const lower = sqlType.toLowerCase();

	if (lower.includes("int") || lower.includes("serial") || lower.includes("decimal") || lower.includes("numeric") || lower.includes("float") || lower.includes("double") || lower.includes("real")) {
		return "number";
	}

	if (lower.includes("bool")) {
		return "boolean";
	}

	if (lower.includes("timestamp") || lower.includes("datetime")) {
		return "datetime";
	}

	if (lower.includes("date")) {
		return "date";
	}

	if (lower.includes("json")) {
		return "json";
	}

	if (lower.includes("blob") || lower.includes("bytea") || lower.includes("binary")) {
		return "blob";
	}

	// Default to string for text, varchar, char, etc.
	return "string";
}

// ============================================================================
// Column Introspection
// ============================================================================

/**
 * Extract metadata from a Drizzle column
 *
 * @param key - The JavaScript property key on the table object
 * @param column - The column object from getTableConfig
 */
function introspectColumn(
	key: string,
	column: {
		name: string;
		primary: boolean;
		notNull: boolean;
		hasDefault: boolean;
		dataType: string;
		enumValues?: readonly string[];
		getSQLType(): string;
	},
): ColumnMetadata {
	const sqlType = column.getSQLType();

	return {
		name: column.name,
		key,
		dataType: normalizeDataType(column.dataType, sqlType),
		sqlType,
		notNull: column.notNull,
		hasDefault: column.hasDefault,
		isPrimaryKey: column.primary,
		enumValues: column.enumValues ? [...column.enumValues] : undefined,
	};
}

// ============================================================================
// Table Introspection
// ============================================================================

/**
 * Dialect-specific getTableConfig function type
 */
type GetTableConfigFn = (table: Table) => {
	columns: Array<{
		name: string;
		primary: boolean;
		notNull: boolean;
		hasDefault: boolean;
		dataType: string;
		enumValues?: readonly string[];
		getSQLType(): string;
	}>;
	foreignKeys: Array<{
		reference: () => {
			columns: Array<{name: string}>;
			foreignTable: Table;
			foreignColumns: Array<{name: string}>;
		};
	}>;
	primaryKeys: Array<{
		columns: Array<{name: string}>;
	}>;
	name: string;
};

/**
 * Extract metadata from a Drizzle table
 *
 * @param table - A Drizzle table definition
 * @param getTableConfig - Dialect-specific getTableConfig function
 */
export function introspectTable(
	table: Table,
	getTableConfig: GetTableConfigFn,
): TableMetadata {
	const config = getTableConfig(table);

	// Build a map from column object to JS property key
	const columnToKey = new Map<unknown, string>();
	for (const [key, value] of Object.entries(table)) {
		// Check if this is a column (has name property matching a config column)
		if (value && typeof value === "object" && "name" in value) {
			columnToKey.set(value, key);
		}
	}

	// Extract columns with their JS keys
	const columns: ColumnMetadata[] = config.columns.map((col) => {
		// Find the JS key by matching the column's name to table properties
		const key = columnToKey.get(col) || col.name;
		return introspectColumn(key, col);
	});

	// Determine primary key columns
	// First check composite primary keys, then individual column `primary` flags
	const primaryKey: string[] = [];

	// Composite primary keys from primaryKeys array
	for (const pk of config.primaryKeys) {
		for (const col of pk.columns) {
			if (!primaryKey.includes(col.name)) {
				primaryKey.push(col.name);
			}
		}
	}

	// Single-column primary keys from column.primary flag
	for (const col of columns) {
		if (col.isPrimaryKey && !primaryKey.includes(col.name)) {
			primaryKey.push(col.name);
		}
	}

	// Extract foreign keys
	const foreignKeys: ForeignKeyMetadata[] = config.foreignKeys.map((fk) => {
		const ref = fk.reference();
		return {
			columns: ref.columns.map((c) => c.name),
			foreignTable: getTableName(ref.foreignTable),
			foreignColumns: ref.foreignColumns.map((c) => c.name),
		};
	});

	return {
		name: config.name,
		columns,
		primaryKey,
		foreignKeys,
	};
}

// ============================================================================
// Schema Introspection
// ============================================================================

/**
 * Introspect an entire Drizzle schema object
 *
 * @param schema - An object containing Drizzle table definitions
 * @param getTableConfig - Dialect-specific getTableConfig function
 * @returns Map of table names to their metadata
 *
 * @example
 * ```typescript
 * import * as schema from './db/schema';
 * import { getTableConfig } from 'drizzle-orm/sqlite-core/utils';
 *
 * const metadata = introspectSchema(schema, getTableConfig);
 * for (const [name, table] of metadata) {
 *   console.log(name, table.columns);
 * }
 * ```
 */
export function introspectSchema(
	schema: Record<string, unknown>,
	getTableConfig: GetTableConfigFn,
): Map<string, TableMetadata> {
	const tables = new Map<string, TableMetadata>();

	for (const [key, value] of Object.entries(schema)) {
		if (isTable(value)) {
			const metadata = introspectTable(value, getTableConfig);
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
	if (singular.endsWith("s") || singular.endsWith("x") || singular.endsWith("ch") || singular.endsWith("sh")) {
		return singular + "es";
	}
	return singular + "s";
}
