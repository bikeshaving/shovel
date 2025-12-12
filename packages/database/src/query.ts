/**
 * Query layer - tagged template SQL with parameterized queries.
 *
 * Generates SELECT statements with prefixed column aliases for entity normalization.
 */

import type {Collection} from "./collection.js";

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
 * Get placeholder for parameterized query.
 */
function placeholder(index: number, dialect: SQLDialect): string {
	if (dialect === "postgresql") {
		return `$${index}`;
	}
	// SQLite and MySQL use ?
	return "?";
}

/**
 * Build SELECT clause with prefixed column aliases.
 *
 * @example
 * buildSelectColumns([Post, User], "sqlite")
 * // SELECT "posts"."id" AS "posts.id", "posts"."title" AS "posts.title", ...
 */
export function buildSelectColumns(
	collections: Collection<any>[],
	dialect: SQLDialect = "sqlite",
): string {
	const columns: string[] = [];

	for (const collection of collections) {
		const tableName = collection.name;
		const shape = collection.schema.shape;

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
 * Build a full SELECT query for collections with user-provided clauses.
 *
 * @example
 * buildQuery([Post, User], "JOIN users ON users.id = posts.author_id WHERE published = ?", ["sqlite"])
 */
export function buildQuery(
	collections: Collection<any>[],
	userClauses: string,
	dialect: SQLDialect = "sqlite",
): string {
	if (collections.length === 0) {
		throw new Error("At least one collection is required");
	}

	const mainTable = collections[0].name;
	const selectCols = buildSelectColumns(collections, dialect);
	const fromClause = quoteIdent(mainTable, dialect);

	// Combine: SELECT ... FROM main_table [user clauses]
	let sql = `SELECT ${selectCols} FROM ${fromClause}`;

	if (userClauses.trim()) {
		sql += ` ${userClauses}`;
	}

	return sql;
}

/**
 * Create a tagged template function for querying collections.
 *
 * @example
 * const query = createQuery([Post, User], "sqlite");
 * const { sql, params } = query`
 *   JOIN users ON users.id = posts.author_id
 *   WHERE published = ${true}
 * `;
 */
export function createQuery(
	collections: Collection<any>[],
	dialect: SQLDialect = "sqlite",
): (strings: TemplateStringsArray, ...values: unknown[]) => ParsedQuery {
	return (strings: TemplateStringsArray, ...values: unknown[]) => {
		const {sql: userClauses, params} = parseTemplate(strings, values, dialect);
		const sql = buildQuery(collections, userClauses, dialect);
		return {sql, params};
	};
}

// ============================================================================
// Raw Query Helpers
// ============================================================================

/**
 * Parse a raw SQL template (no collection-based SELECT generation).
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
