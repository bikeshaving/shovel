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
 * @example
 * parseTemplate`WHERE id = ${userId} AND active = ${true}`
 * // { sql: "WHERE id = ? AND active = ?", params: ["user-123", true] }
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
			params.push(values[i]);
			sql += placeholder(params.length, dialect);
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
