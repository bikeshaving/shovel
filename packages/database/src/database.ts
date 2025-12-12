/**
 * Database wrapper - the main API for schema-driven SQL.
 *
 * Provides typed queries with entity normalization and reference resolution.
 */

import type {Collection, Infer, Insert} from "./collection.js";
import {createQuery, parseTemplate, type SQLDialect} from "./query.js";
import {normalize, normalizeOne} from "./normalize.js";

// ============================================================================
// Driver Interface
// ============================================================================

/**
 * Database driver interface.
 *
 * Implement this interface to add support for different databases.
 */
export interface DatabaseDriver {
	/**
	 * Execute a query and return all rows.
	 */
	all<T = Record<string, unknown>>(sql: string, params: unknown[]): Promise<T[]>;

	/**
	 * Execute a query and return the first row.
	 */
	get<T = Record<string, unknown>>(
		sql: string,
		params: unknown[],
	): Promise<T | null>;

	/**
	 * Execute a statement and return the number of affected rows.
	 */
	run(sql: string, params: unknown[]): Promise<number>;

	/**
	 * Execute a query and return a single value.
	 */
	val<T = unknown>(sql: string, params: unknown[]): Promise<T>;
}

// ============================================================================
// Database
// ============================================================================

export interface DatabaseOptions {
	dialect?: SQLDialect;
}

/**
 * Tagged template query function that returns normalized entities.
 */
export type TaggedQuery<T> = (
	strings: TemplateStringsArray,
	...values: unknown[]
) => Promise<T>;

/**
 * Database wrapper with typed queries and entity normalization.
 */
export class Database {
	private driver: DatabaseDriver;
	private dialect: SQLDialect;

	constructor(driver: DatabaseDriver, options: DatabaseOptions = {}) {
		this.driver = driver;
		this.dialect = options.dialect ?? "sqlite";
	}

	// ==========================================================================
	// Queries - Return Normalized Entities
	// ==========================================================================

	/**
	 * Query multiple entities with joins and reference resolution.
	 *
	 * @example
	 * const posts = await db.all(Post, User)`
	 *   JOIN users ON users.id = posts.author_id
	 *   WHERE published = ${true}
	 * `;
	 * posts[0].author.name  // "Alice"
	 */
	all<T extends Collection<any>[]>(
		...collections: T
	): TaggedQuery<Infer<T[0]>[]> {
		return async (strings: TemplateStringsArray, ...values: unknown[]) => {
			const query = createQuery(collections, this.dialect);
			const {sql, params} = query(strings, ...values);
			const rows = await this.driver.all<Record<string, unknown>>(sql, params);
			return normalize<Infer<T[0]>>(rows, collections);
		};
	}

	/**
	 * Query a single entity.
	 *
	 * @example
	 * const post = await db.one(Post, User)`
	 *   JOIN users ON users.id = posts.author_id
	 *   WHERE posts.id = ${postId}
	 * `;
	 */
	one<T extends Collection<any>[]>(
		...collections: T
	): TaggedQuery<Infer<T[0]> | null> {
		return async (strings: TemplateStringsArray, ...values: unknown[]) => {
			const query = createQuery(collections, this.dialect);
			const {sql, params} = query(strings, ...values);
			const row = await this.driver.get<Record<string, unknown>>(sql, params);
			return normalizeOne<Infer<T[0]>>(row, collections);
		};
	}

	// ==========================================================================
	// Mutations - Validate Through Zod
	// ==========================================================================

	/**
	 * Insert a new entity.
	 *
	 * @example
	 * const user = await db.insert(User, {
	 *   id: crypto.randomUUID(),
	 *   email: "alice@example.com",
	 *   name: "Alice",
	 * });
	 */
	async insert<T extends Collection<any>>(
		collection: T,
		data: Insert<T>,
	): Promise<Infer<T>> {
		// Validate through Zod schema
		const validated = collection.schema.parse(data);

		const columns = Object.keys(validated);
		const values = Object.values(validated);
		const tableName = this.quoteIdent(collection.name);
		const columnList = columns.map((c) => this.quoteIdent(c)).join(", ");
		const placeholders = columns
			.map((_, i) => this.placeholder(i + 1))
			.join(", ");

		const sql = `INSERT INTO ${tableName} (${columnList}) VALUES (${placeholders})`;
		await this.driver.run(sql, values);

		return validated as Infer<T>;
	}

	/**
	 * Update an entity by primary key.
	 *
	 * @example
	 * const user = await db.update(User, userId, { name: "Bob" });
	 */
	async update<T extends Collection<any>>(
		collection: T,
		id: string | number | Record<string, unknown>,
		data: Partial<Insert<T>>,
	): Promise<Infer<T> | null> {
		const pk = collection.primaryKey();
		if (!pk) {
			throw new Error(
				`Collection ${collection.name} has no primary key defined`,
			);
		}

		// Validate partial data through Zod schema partial
		const partialSchema = collection.schema.partial();
		const validated = partialSchema.parse(data);

		const columns = Object.keys(validated);
		if (columns.length === 0) {
			throw new Error("No fields to update");
		}

		const values = Object.values(validated);
		const tableName = this.quoteIdent(collection.name);
		const setClause = columns
			.map((c, i) => `${this.quoteIdent(c)} = ${this.placeholder(i + 1)}`)
			.join(", ");

		// Build WHERE clause for primary key
		const {whereClause, whereParams} = this.buildPkWhere(pk, id, values.length);

		const sql = `UPDATE ${tableName} SET ${setClause} WHERE ${whereClause}`;
		await this.driver.run(sql, [...values, ...whereParams]);

		// Fetch and return updated entity
		const selectSql = `SELECT * FROM ${tableName} WHERE ${whereClause}`;
		const row = await this.driver.get<Record<string, unknown>>(
			selectSql,
			whereParams,
		);

		if (!row) return null;

		// Validate through schema
		return collection.schema.parse(row) as Infer<T>;
	}

	/**
	 * Delete an entity by primary key.
	 *
	 * @example
	 * const deleted = await db.delete(User, userId);
	 */
	async delete<T extends Collection<any>>(
		collection: T,
		id: string | number | Record<string, unknown>,
	): Promise<boolean> {
		const pk = collection.primaryKey();
		if (!pk) {
			throw new Error(
				`Collection ${collection.name} has no primary key defined`,
			);
		}

		const tableName = this.quoteIdent(collection.name);
		const {whereClause, whereParams} = this.buildPkWhere(pk, id, 0);

		const sql = `DELETE FROM ${tableName} WHERE ${whereClause}`;
		const affected = await this.driver.run(sql, whereParams);

		return affected > 0;
	}

	// ==========================================================================
	// Raw - No Normalization
	// ==========================================================================

	/**
	 * Execute a raw query and return rows.
	 *
	 * @example
	 * const counts = await db.query<{ count: number }>`
	 *   SELECT COUNT(*) as count FROM posts WHERE author_id = ${userId}
	 * `;
	 */
	async query<T = Record<string, unknown>>(
		strings: TemplateStringsArray,
		...values: unknown[]
	): Promise<T[]> {
		const {sql, params} = parseTemplate(strings, values, this.dialect);
		return this.driver.all<T>(sql, params);
	}

	/**
	 * Execute a statement (INSERT, UPDATE, DELETE, DDL).
	 *
	 * @example
	 * await db.exec`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY)`;
	 */
	async exec(
		strings: TemplateStringsArray,
		...values: unknown[]
	): Promise<number> {
		const {sql, params} = parseTemplate(strings, values, this.dialect);
		return this.driver.run(sql, params);
	}

	/**
	 * Execute a query and return a single value.
	 *
	 * @example
	 * const count = await db.val<number>`SELECT COUNT(*) FROM posts`;
	 */
	async val<T>(
		strings: TemplateStringsArray,
		...values: unknown[]
	): Promise<T> {
		const {sql, params} = parseTemplate(strings, values, this.dialect);
		return this.driver.val<T>(sql, params);
	}

	// ==========================================================================
	// Helpers
	// ==========================================================================

	private quoteIdent(name: string): string {
		if (this.dialect === "mysql") {
			return `\`${name}\``;
		}
		return `"${name}"`;
	}

	private placeholder(index: number): string {
		if (this.dialect === "postgresql") {
			return `$${index}`;
		}
		return "?";
	}

	private buildPkWhere(
		pk: string | string[],
		id: string | number | Record<string, unknown>,
		paramOffset: number,
	): {whereClause: string; whereParams: unknown[]} {
		if (Array.isArray(pk)) {
			// Composite primary key
			if (typeof id !== "object" || id === null) {
				throw new Error(
					`Composite primary key requires object with keys: ${pk.join(", ")}`,
				);
			}

			const conditions: string[] = [];
			const params: unknown[] = [];

			for (let i = 0; i < pk.length; i++) {
				const key = pk[i];
				if (!(key in id)) {
					throw new Error(`Missing primary key field: ${key}`);
				}
				conditions.push(
					`${this.quoteIdent(key)} = ${this.placeholder(paramOffset + i + 1)}`,
				);
				params.push((id as Record<string, unknown>)[key]);
			}

			return {whereClause: conditions.join(" AND "), whereParams: params};
		} else {
			// Simple primary key
			return {
				whereClause: `${this.quoteIdent(pk)} = ${this.placeholder(paramOffset + 1)}`,
				whereParams: [id],
			};
		}
	}
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a database instance with the given driver.
 *
 * @example
 * import { createDatabase } from "@b9g/database";
 *
 * const db = createDatabase(sqliteDriver, { dialect: "sqlite" });
 */
export function createDatabase(
	driver: DatabaseDriver,
	options?: DatabaseOptions,
): Database {
	return new Database(driver, options);
}
