/**
 * Query layer - tagged template SQL with parameterized queries.
 *
 * Generates SELECT statements with prefixed column aliases for entity normalization.
 */

import type {Table} from "./table.js";

// ============================================================================
// Types
// ============================================================================

export type SQLDialect = "sqlite" | "postgresql" | "mysql";

export interface QueryOptions {
	dialect?: SQLDialect;
}

export interface ParsedQuery {
	sql: string;
	params: unknown[];
}

// ============================================================================
// SQL Fragments
// ============================================================================

const SQL_FRAGMENT = Symbol.for("@b9g/database:fragment");

/**
 * A SQL fragment with embedded parameters.
 *
 * When interpolated in a tagged template, the SQL is injected directly
 * and params are added to the parameter list.
 */
export interface SQLFragment {
	readonly [SQL_FRAGMENT]: true;
	readonly sql: string;
	readonly params: readonly unknown[];
}

/**
 * Check if a value is a SQL fragment.
 */
export function isSQLFragment(value: unknown): value is SQLFragment {
	return (
		value !== null &&
		typeof value === "object" &&
		SQL_FRAGMENT in value &&
		(value as any)[SQL_FRAGMENT] === true
	);
}

/**
 * Create a SQL fragment from raw SQL and parameters.
 *
 * @internal Used by fragment helpers (where, set, on, etc.)
 */
export function createFragment(sql: string, params: unknown[] = []): SQLFragment {
	return {
		[SQL_FRAGMENT]: true,
		sql,
		params,
	};
}

// ============================================================================
// Query Building
// ============================================================================

function quoteIdent(name: string, dialect: SQLDialect): string {
	if (dialect === "mysql") {
		return `\`${name}\``;
	}
	return `"${name}"`;
}

function placeholder(index: number, dialect: SQLDialect): string {
	if (dialect === "postgresql") {
		return `$${index}`;
	}
	return "?";
}

/**
 * Build SELECT clause with prefixed column aliases.
 *
 * @example
 * buildSelectColumns([posts, users], "sqlite")
 * // SELECT "posts"."id" AS "posts.id", "posts"."title" AS "posts.title", ...
 */
export function buildSelectColumns(
	tables: Table<any>[],
	dialect: SQLDialect = "sqlite",
): string {
	const columns: string[] = [];

	for (const table of tables) {
		const tableName = table.name;
		const shape = table.schema.shape;

		for (const fieldName of Object.keys(shape)) {
			const qualifiedCol = `${quoteIdent(tableName, dialect)}.${quoteIdent(fieldName, dialect)}`;
			const alias = `${tableName}.${fieldName}`;
			columns.push(`${qualifiedCol} AS ${quoteIdent(alias, dialect)}`);
		}
	}

	return columns.join(", ");
}

/**
 * Parse a tagged template into SQL string and params array.
 *
 * Supports SQL fragments - when a value is a SQLFragment, its SQL is
 * injected directly and its params are added to the parameter list.
 *
 * @example
 * parseTemplate`WHERE id = ${userId} AND active = ${true}`
 * // { sql: "WHERE id = ? AND active = ?", params: ["user-123", true] }
 *
 * @example
 * parseTemplate`WHERE ${where(Users, { role: "admin" })}`
 * // { sql: "WHERE role = ?", params: ["admin"] }
 */
export function parseTemplate(
	strings: TemplateStringsArray,
	values: unknown[],
	dialect: SQLDialect = "sqlite",
): ParsedQuery {
	const params: unknown[] = [];
	let sql = "";

	for (let i = 0; i < strings.length; i++) {
		sql += strings[i];
		if (i < values.length) {
			const value = values[i];
			if (isSQLFragment(value)) {
				// Inject fragment SQL, replacing ? placeholders with dialect-appropriate ones
				let fragmentSQL = value.sql;
				for (const param of value.params) {
					params.push(param);
					// Replace first ? with the correct placeholder for this dialect
					fragmentSQL = fragmentSQL.replace("?", placeholder(params.length, dialect));
				}
				sql += fragmentSQL;
			} else {
				params.push(value);
				sql += placeholder(params.length, dialect);
			}
		}
	}

	return {sql: sql.trim(), params};
}

/**
 * Build a full SELECT query for tables with user-provided clauses.
 *
 * @example
 * buildQuery([posts, users], "JOIN users ON users.id = posts.author_id WHERE published = ?", "sqlite")
 */
export function buildQuery(
	tables: Table<any>[],
	userClauses: string,
	dialect: SQLDialect = "sqlite",
): string {
	if (tables.length === 0) {
		throw new Error("At least one table is required");
	}

	const mainTable = tables[0].name;
	const selectCols = buildSelectColumns(tables, dialect);
	const fromClause = quoteIdent(mainTable, dialect);

	let sql = `SELECT ${selectCols} FROM ${fromClause}`;

	if (userClauses.trim()) {
		sql += ` ${userClauses}`;
	}

	return sql;
}

/**
 * Create a tagged template function for querying tables.
 *
 * @example
 * const query = createQuery([posts, users], "sqlite");
 * const { sql, params } = query`
 *   JOIN users ON users.id = posts.author_id
 *   WHERE published = ${true}
 * `;
 */
export function createQuery(
	tables: Table<any>[],
	dialect: SQLDialect = "sqlite",
): (strings: TemplateStringsArray, ...values: unknown[]) => ParsedQuery {
	return (strings: TemplateStringsArray, ...values: unknown[]) => {
		const {sql: userClauses, params} = parseTemplate(strings, values, dialect);
		const sql = buildQuery(tables, userClauses, dialect);
		return {sql, params};
	};
}

// ============================================================================
// Raw Query Helpers
// ============================================================================

/**
 * Parse a raw SQL template (no table-based SELECT generation).
 *
 * @example
 * const { sql, params } = rawQuery`SELECT COUNT(*) FROM posts WHERE author_id = ${userId}`;
 */
export function rawQuery(
	strings: TemplateStringsArray,
	...values: unknown[]
): ParsedQuery {
	return parseTemplate(strings, values, "sqlite");
}

/**
 * Create a raw query function for a specific dialect.
 */
export function createRawQuery(
	dialect: SQLDialect,
): (strings: TemplateStringsArray, ...values: unknown[]) => ParsedQuery {
	return (strings: TemplateStringsArray, ...values: unknown[]) => {
		return parseTemplate(strings, values, dialect);
	};
}
