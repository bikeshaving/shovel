/**
 * DDL generation from table definitions.
 *
 * Generates CREATE TABLE statements for SQLite, PostgreSQL, and MySQL.
 * Uses only Zod's public APIs - no _def access.
 */

import {z} from "zod";
import type {Table} from "./table.js";

// ============================================================================
// Types
// ============================================================================

export type SQLDialect = "sqlite" | "postgresql" | "mysql";

export interface DDLOptions {
	dialect?: SQLDialect;
	ifNotExists?: boolean;
}

interface ColumnDef {
	name: string;
	sqlType: string;
	nullable: boolean;
	primaryKey: boolean;
	unique: boolean;
	defaultValue?: string;
}

// ============================================================================
// Type Mapping (using only public Zod APIs)
// ============================================================================

interface UnwrapResult {
	core: z.ZodType;
	isOptional: boolean;
	isNullable: boolean;
	hasDefault: boolean;
	defaultValue?: unknown;
}

/**
 * Unwrap wrapper types (Optional, Nullable, Default, etc.) using public APIs.
 */
function unwrapType(schema: z.ZodType): UnwrapResult {
	let core: z.ZodType = schema;
	let isOptional = false;
	let isNullable = false;
	let hasDefault = false;
	let defaultValue: unknown = undefined;

	// Use public isOptional/isNullable first
	isOptional = schema.isOptional();
	isNullable = schema.isNullable();

	// Unwrap layers using public methods
	while (true) {
		// Check for ZodDefault (has removeDefault method)
		if (typeof (core as any).removeDefault === "function") {
			hasDefault = true;
			// Get default value by parsing undefined
			try {
				defaultValue = core.parse(undefined);
			} catch {
				// If parse fails, default might be a function that throws
			}
			core = (core as any).removeDefault();
			continue;
		}

		// Check for ZodOptional/ZodNullable (has unwrap method)
		if (typeof (core as any).unwrap === "function") {
			core = (core as any).unwrap();
			continue;
		}

		// Check for ZodEffects (has innerType method)
		if (typeof (core as any).innerType === "function") {
			core = (core as any).innerType();
			continue;
		}

		// No more wrappers to unwrap
		break;
	}

	return {core, isOptional, isNullable, hasDefault, defaultValue};
}

/**
 * Map a Zod type to SQL type using instanceof checks and public properties.
 */
function mapZodToSQL(
	schema: z.ZodType,
	dialect: SQLDialect,
): {sqlType: string; defaultValue?: string} {
	const {core, hasDefault, defaultValue} = unwrapType(schema);

	let sqlType: string;
	let sqlDefault: string | undefined;

	// Use instanceof checks instead of _def.typeName
	if (core instanceof z.ZodString) {
		// Use public maxLength property
		const maxLength = (core as any).maxLength as number | undefined;

		if (maxLength && maxLength <= 255 && dialect !== "sqlite") {
			sqlType = `VARCHAR(${maxLength})`;
		} else {
			sqlType = "TEXT";
		}

		if (hasDefault && defaultValue !== undefined) {
			sqlDefault = `'${String(defaultValue).replace(/'/g, "''")}'`;
		}
	} else if (core instanceof z.ZodNumber) {
		// Use public isInt property
		const isInt = (core as any).isInt as boolean | undefined;

		if (isInt) {
			sqlType = "INTEGER";
		} else {
			sqlType = dialect === "postgresql" ? "DOUBLE PRECISION" : "REAL";
		}

		if (hasDefault && defaultValue !== undefined) {
			sqlDefault = String(defaultValue);
		}
	} else if (core instanceof z.ZodBoolean) {
		sqlType = dialect === "sqlite" ? "INTEGER" : "BOOLEAN";
		if (hasDefault && defaultValue !== undefined) {
			if (dialect === "sqlite") {
				sqlDefault = defaultValue ? "1" : "0";
			} else {
				sqlDefault = defaultValue ? "TRUE" : "FALSE";
			}
		}
	} else if (core instanceof z.ZodDate) {
		if (dialect === "postgresql") {
			sqlType = "TIMESTAMPTZ";
		} else if (dialect === "mysql") {
			sqlType = "DATETIME";
		} else {
			sqlType = "TEXT";
		}

		if (hasDefault) {
			// Date defaults are usually functions (new Date()), use DB default
			if (dialect === "sqlite") {
				sqlDefault = "CURRENT_TIMESTAMP";
			} else if (dialect === "postgresql") {
				sqlDefault = "NOW()";
			} else {
				sqlDefault = "CURRENT_TIMESTAMP";
			}
		}
	} else if (core instanceof z.ZodEnum) {
		sqlType = "TEXT";
		if (hasDefault && defaultValue !== undefined) {
			sqlDefault = `'${String(defaultValue).replace(/'/g, "''")}'`;
		}
	} else if (core instanceof z.ZodArray || core instanceof z.ZodObject) {
		if (dialect === "postgresql") {
			sqlType = "JSONB";
		} else {
			sqlType = "TEXT";
		}
		if (hasDefault && defaultValue !== undefined) {
			sqlDefault = `'${JSON.stringify(defaultValue).replace(/'/g, "''")}'`;
		}
	} else {
		// Fallback for unknown types
		sqlType = "TEXT";
		if (hasDefault && defaultValue !== undefined) {
			sqlDefault = `'${String(defaultValue).replace(/'/g, "''")}'`;
		}
	}

	return {sqlType, defaultValue: sqlDefault};
}

// ============================================================================
// DDL Generation
// ============================================================================

function quoteIdent(name: string, dialect: SQLDialect): string {
	if (dialect === "mysql") {
		return `\`${name}\``;
	}
	return `"${name}"`;
}

/**
 * Generate CREATE TABLE DDL from a table definition.
 */
export function generateDDL<T extends Table<any>>(
	table: T,
	options: DDLOptions = {},
): string {
	const {dialect = "sqlite", ifNotExists = true} = options;
	const shape = table.schema.shape;
	const meta = table._meta;

	const columns: ColumnDef[] = [];

	for (const [name, zodType] of Object.entries(shape)) {
		const fieldMeta = meta.fields[name] || {};
		const {isOptional, isNullable, hasDefault} = unwrapType(zodType as z.ZodType);
		const {sqlType, defaultValue: sqlDefault} = mapZodToSQL(zodType as z.ZodType, dialect);

		const column: ColumnDef = {
			name,
			sqlType,
			nullable: isOptional || isNullable || hasDefault,
			primaryKey: fieldMeta.primaryKey === true,
			unique: fieldMeta.unique === true,
			defaultValue: sqlDefault,
		};

		columns.push(column);
	}

	// Build column definitions
	const columnDefs: string[] = [];

	for (const col of columns) {
		let def = `${quoteIdent(col.name, dialect)} ${col.sqlType}`;

		if (!col.nullable) {
			def += " NOT NULL";
		}

		if (col.defaultValue !== undefined) {
			def += ` DEFAULT ${col.defaultValue}`;
		}

		if (col.primaryKey && dialect === "sqlite") {
			def += " PRIMARY KEY";
		}

		if (col.unique && !col.primaryKey) {
			def += " UNIQUE";
		}

		columnDefs.push(def);
	}

	// PRIMARY KEY constraint for non-SQLite or composite keys
	if (meta.primary && dialect !== "sqlite") {
		columnDefs.push(`PRIMARY KEY (${quoteIdent(meta.primary, dialect)})`);
	}

	// FOREIGN KEY constraints
	for (const ref of meta.references) {
		const fkColumn = quoteIdent(ref.fieldName, dialect);
		const refTable = quoteIdent(ref.table.name, dialect);
		const refColumn = quoteIdent(ref.referencedField, dialect);

		let fk = `FOREIGN KEY (${fkColumn}) REFERENCES ${refTable}(${refColumn})`;

		// Add ON DELETE behavior
		if (ref.onDelete) {
			const onDeleteSQL = ref.onDelete === "set null" ? "SET NULL" : ref.onDelete.toUpperCase();
			fk += ` ON DELETE ${onDeleteSQL}`;
		}

		columnDefs.push(fk);
	}

	// Build CREATE TABLE
	const tableName = quoteIdent(table.name, dialect);
	const exists = ifNotExists ? "IF NOT EXISTS " : "";
	let sql = `CREATE TABLE ${exists}${tableName} (\n  ${columnDefs.join(",\n  ")}\n);`;

	// Add indexes for indexed fields
	for (const indexedField of meta.indexed) {
		const indexName = `idx_${table.name}_${indexedField}`;
		sql += `\n\nCREATE INDEX ${exists}${quoteIdent(indexName, dialect)} ON ${tableName} (${quoteIdent(indexedField, dialect)});`;
	}

	// Add compound indexes from table options
	for (const indexCols of table.indexes) {
		const indexName = `idx_${table.name}_${indexCols.join("_")}`;
		const cols = indexCols.map((c) => quoteIdent(c, dialect)).join(", ");
		sql += `\n\nCREATE INDEX ${exists}${quoteIdent(indexName, dialect)} ON ${tableName} (${cols});`;
	}

	return sql;
}

/**
 * Convenience function for generating DDL.
 */
export function ddl(table: Table<any>, dialect: SQLDialect = "sqlite"): string {
	return generateDDL(table, {dialect});
}
