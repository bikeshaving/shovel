/**
 * DDL generation from Zod schemas.
 *
 * Generates CREATE TABLE statements for SQLite, PostgreSQL, and MySQL.
 */

import {z, ZodTypeAny} from "zod";
import type {Collection} from "./collection.js";

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

/**
 * Map Zod types to SQL types based on dialect.
 */
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

			// Use VARCHAR for constrained lengths in Postgres/MySQL
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
			// SQLite uses INTEGER for booleans
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
				sqlType = "TEXT"; // SQLite stores as ISO string
			}

			if (defaultValue !== undefined) {
				// Default to CURRENT_TIMESTAMP for "now" defaults
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
			// Store enums as TEXT, could use native ENUM for MySQL/Postgres
			sqlType = "TEXT";
			if (defaultValue !== undefined) {
				sqlDefault = `'${String(defaultValue).replace(/'/g, "''")}'`;
			}
			break;

		case "ZodArray":
		case "ZodObject":
			// Store complex types as JSON
			if (dialect === "postgresql") {
				sqlType = "JSONB";
			} else {
				sqlType = "TEXT"; // JSON stored as text
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

/**
 * Unwrap optional/nullable/default to get core type and metadata.
 */
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
			// Use input type for SQL type detection
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
// Metadata Extraction (duplicated from collection.ts for now)
// ============================================================================

const DB_META = Symbol.for("@b9g/database:meta");

interface FieldDbMeta {
	primaryKey?: boolean;
	unique?: boolean;
	indexed?: boolean;
}

function collectMeta(zodType: ZodTypeAny): FieldDbMeta {
	const result: FieldDbMeta = {};

	function walk(type: ZodTypeAny): void {
		const meta = (type as any)[DB_META];
		if (meta) {
			Object.assign(result, meta);
		}

		const typeName = type._def.typeName;

		if (typeName === "ZodPipeline") {
			walk((type as any)._def.in);
			walk((type as any)._def.out);
		} else if (typeName === "ZodEffects") {
			walk((type as any)._def.schema);
		} else if (typeName === "ZodOptional" || typeName === "ZodNullable") {
			walk((type as any)._def.innerType);
		} else if (typeName === "ZodDefault") {
			walk((type as any)._def.innerType);
		} else if (typeName === "ZodBranded") {
			walk((type as any)._def.type);
		}
	}

	walk(zodType);
	return result;
}

// ============================================================================
// DDL Generation
// ============================================================================

/**
 * Quote an identifier for the given dialect.
 */
function quoteIdent(name: string, dialect: SQLDialect): string {
	if (dialect === "mysql") {
		return `\`${name}\``;
	}
	return `"${name}"`;
}

/**
 * Generate CREATE TABLE DDL from a collection.
 */
export function generateDDL<T extends Collection<any>>(
	collection: T,
	options: DDLOptions = {},
): string {
	const {dialect = "sqlite", ifNotExists = true} = options;
	const shape = collection.schema.shape;

	const columns: ColumnDef[] = [];
	const primaryKeys: string[] = [];
	const uniqueConstraints: string[] = [];

	// Process each field
	for (const [name, zodType] of Object.entries(shape)) {
		const meta = collectMeta(zodType as ZodTypeAny);
		const {core, isOptional, isNullable, defaultValue} = unwrapType(zodType as ZodTypeAny);
		const {sqlType, defaultValue: sqlDefault} = mapZodToSQL(zodType as ZodTypeAny, dialect);

		const column: ColumnDef = {
			name,
			sqlType,
			nullable: isOptional || isNullable || defaultValue !== undefined,
			primaryKey: meta.primaryKey === true,
			unique: meta.unique === true,
			defaultValue: sqlDefault,
		};

		columns.push(column);

		if (column.primaryKey) {
			primaryKeys.push(name);
		}

		// Standalone unique (not part of primary key)
		if (column.unique && !column.primaryKey) {
			uniqueConstraints.push(name);
		}
	}

	// Build column definitions
	const columnDefs: string[] = [];

	for (const col of columns) {
		let def = `${quoteIdent(col.name, dialect)} ${col.sqlType}`;

		// NOT NULL (unless nullable or has default)
		if (!col.nullable) {
			def += " NOT NULL";
		}

		// DEFAULT
		if (col.defaultValue !== undefined) {
			def += ` DEFAULT ${col.defaultValue}`;
		}

		// Inline PRIMARY KEY for single-column PK in SQLite
		if (col.primaryKey && primaryKeys.length === 1 && dialect === "sqlite") {
			def += " PRIMARY KEY";
		}

		// Inline UNIQUE for single columns
		if (col.unique && !col.primaryKey) {
			def += " UNIQUE";
		}

		columnDefs.push(def);
	}

	// Composite PRIMARY KEY constraint
	if (primaryKeys.length > 1 || (primaryKeys.length === 1 && dialect !== "sqlite")) {
		const pkCols = primaryKeys.map((k) => quoteIdent(k, dialect)).join(", ");
		columnDefs.push(`PRIMARY KEY (${pkCols})`);
	}

	// Build CREATE TABLE
	const tableName = quoteIdent(collection.name, dialect);
	const exists = ifNotExists ? "IF NOT EXISTS " : "";
	let sql = `CREATE TABLE ${exists}${tableName} (\n  ${columnDefs.join(",\n  ")}\n);`;

	// Add indexes
	const indexedFields = columns.filter((c) => {
		const meta = collectMeta((shape as any)[c.name] as ZodTypeAny);
		return meta.indexed === true;
	});

	for (const col of indexedFields) {
		const indexName = `idx_${collection.name}_${col.name}`;
		sql += `\n\nCREATE INDEX ${exists}${quoteIdent(indexName, dialect)} ON ${tableName} (${quoteIdent(col.name, dialect)});`;
	}

	// Add compound indexes from collection options
	for (const indexCols of collection.indexes) {
		const indexName = `idx_${collection.name}_${indexCols.join("_")}`;
		const cols = indexCols.map((c) => quoteIdent(c, dialect)).join(", ");
		sql += `\n\nCREATE INDEX ${exists}${quoteIdent(indexName, dialect)} ON ${tableName} (${cols});`;
	}

	return sql;
}

/**
 * Add ddl() method to collection.
 */
export function ddl(collection: Collection<any>, dialect: SQLDialect = "sqlite"): string {
	return generateDDL(collection, {dialect});
}
