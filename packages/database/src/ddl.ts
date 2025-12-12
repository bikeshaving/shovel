/**
 * DDL generation from table definitions.
 *
 * Generates CREATE TABLE statements for SQLite, PostgreSQL, and MySQL.
 */

import {ZodTypeAny} from "zod";
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
// Type Mapping
// ============================================================================

function mapZodToSQL(
	zodType: ZodTypeAny,
	dialect: SQLDialect,
): {sqlType: string; defaultValue?: string} {
	const {core, defaultValue} = unwrapType(zodType);
	const typeName = core._def.typeName;

	let sqlType: string;
	let sqlDefault: string | undefined;

	switch (typeName) {
		case "ZodString": {
			const checks = core._def.checks || [];
			let maxLength: number | undefined;

			for (const check of checks) {
				if (check.kind === "max") {
					maxLength = check.value;
				}
			}

			if (maxLength && maxLength <= 255 && dialect !== "sqlite") {
				sqlType = `VARCHAR(${maxLength})`;
			} else {
				sqlType = "TEXT";
			}

			if (defaultValue !== undefined) {
				sqlDefault = `'${String(defaultValue).replace(/'/g, "''")}'`;
			}
			break;
		}

		case "ZodNumber": {
			const checks = core._def.checks || [];
			const isInt = checks.some((c: any) => c.kind === "int");

			if (isInt) {
				sqlType = "INTEGER";
			} else {
				sqlType = dialect === "postgresql" ? "DOUBLE PRECISION" : "REAL";
			}

			if (defaultValue !== undefined) {
				sqlDefault = String(defaultValue);
			}
			break;
		}

		case "ZodBoolean":
			sqlType = dialect === "sqlite" ? "INTEGER" : "BOOLEAN";
			if (defaultValue !== undefined) {
				if (dialect === "sqlite") {
					sqlDefault = defaultValue ? "1" : "0";
				} else {
					sqlDefault = defaultValue ? "TRUE" : "FALSE";
				}
			}
			break;

		case "ZodDate":
			if (dialect === "postgresql") {
				sqlType = "TIMESTAMPTZ";
			} else if (dialect === "mysql") {
				sqlType = "DATETIME";
			} else {
				sqlType = "TEXT";
			}

			if (defaultValue !== undefined) {
				if (defaultValue instanceof Date || typeof defaultValue === "function") {
					if (dialect === "sqlite") {
						sqlDefault = "CURRENT_TIMESTAMP";
					} else if (dialect === "postgresql") {
						sqlDefault = "NOW()";
					} else {
						sqlDefault = "CURRENT_TIMESTAMP";
					}
				}
			}
			break;

		case "ZodEnum":
			sqlType = "TEXT";
			if (defaultValue !== undefined) {
				sqlDefault = `'${String(defaultValue).replace(/'/g, "''")}'`;
			}
			break;

		case "ZodArray":
		case "ZodObject":
			if (dialect === "postgresql") {
				sqlType = "JSONB";
			} else {
				sqlType = "TEXT";
			}
			if (defaultValue !== undefined) {
				sqlDefault = `'${JSON.stringify(defaultValue).replace(/'/g, "''")}'`;
			}
			break;

		default:
			sqlType = "TEXT";
			if (defaultValue !== undefined) {
				sqlDefault = `'${String(defaultValue).replace(/'/g, "''")}'`;
			}
	}

	return {sqlType, defaultValue: sqlDefault};
}

function unwrapType(zodType: ZodTypeAny): {
	core: ZodTypeAny;
	isOptional: boolean;
	isNullable: boolean;
	defaultValue?: unknown;
} {
	let core = zodType;
	let isOptional = false;
	let isNullable = false;
	let defaultValue: unknown = undefined;

	while (true) {
		const typeName = core._def.typeName;

		if (typeName === "ZodOptional") {
			isOptional = true;
			core = core._def.innerType;
		} else if (typeName === "ZodNullable") {
			isNullable = true;
			core = core._def.innerType;
		} else if (typeName === "ZodDefault") {
			defaultValue = core._def.defaultValue();
			core = core._def.innerType;
		} else if (typeName === "ZodEffects") {
			core = core._def.schema;
		} else if (typeName === "ZodPipeline") {
			core = core._def.in;
		} else if (typeName === "ZodBranded") {
			core = core._def.type;
		} else {
			break;
		}
	}

	return {core, isOptional, isNullable, defaultValue};
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
		const {isOptional, isNullable, defaultValue} = unwrapType(zodType as ZodTypeAny);
		const {sqlType, defaultValue: sqlDefault} = mapZodToSQL(zodType as ZodTypeAny, dialect);

		const column: ColumnDef = {
			name,
			sqlType,
			nullable: isOptional || isNullable || defaultValue !== undefined,
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
