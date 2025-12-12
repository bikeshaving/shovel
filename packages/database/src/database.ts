/**
 * Database wrapper - the main API for schema-driven SQL.
 *
 * Provides typed queries with entity normalization and reference resolution.
 * Extends EventTarget for IndexedDB-style migration events.
 */

import type {Table, Infer, Insert} from "./table.js";
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

	/**
	 * Begin a transaction and return a connection-bound driver.
	 *
	 * Optional — implement this for connection-pooled databases to ensure
	 * all transaction operations use the same connection.
	 *
	 * If not implemented, Database.transaction() falls back to SQL-based
	 * BEGIN/COMMIT/ROLLBACK which works for single-connection drivers.
	 */
	beginTransaction?(): Promise<TransactionDriver>;
}

/**
 * A driver bound to a single connection within a transaction.
 *
 * All operations go through the same connection until commit/rollback.
 */
export interface TransactionDriver extends DatabaseDriver {
	commit(): Promise<void>;
	rollback(): Promise<void>;
}

/**
 * Result of creating a database adapter.
 * Includes the driver and a close function for cleanup.
 */
export interface DatabaseAdapter {
	driver: DatabaseDriver;
	close(): Promise<void>;
}

// ============================================================================
// Database Upgrade Event
// ============================================================================

/**
 * Event fired when database version increases during open().
 *
 * Similar to IndexedDB's IDBVersionChangeEvent combined with
 * ServiceWorker's ExtendableEvent (for waitUntil support).
 */
export class DatabaseUpgradeEvent extends Event {
	readonly oldVersion: number;
	readonly newVersion: number;
	#promises: Promise<void>[] = [];

	constructor(
		type: string,
		init: {oldVersion: number; newVersion: number},
	) {
		super(type);
		this.oldVersion = init.oldVersion;
		this.newVersion = init.newVersion;
	}

	/**
	 * Extend the event lifetime until the promise settles.
	 * Like ExtendableEvent.waitUntil() from ServiceWorker.
	 */
	waitUntil(promise: Promise<void>): void {
		this.#promises.push(promise);
	}

	/**
	 * @internal Wait for all waitUntil promises to settle.
	 */
	async _settle(): Promise<void> {
		await Promise.all(this.#promises);
	}
}

// ============================================================================
// Transaction
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
 * Transaction context with query methods.
 *
 * Provides the same query interface as Database, but bound to a single
 * connection for the duration of the transaction.
 */
export class Transaction {
	#driver: DatabaseDriver;
	#dialect: SQLDialect;

	constructor(driver: DatabaseDriver, dialect: SQLDialect) {
		this.#driver = driver;
		this.#dialect = dialect;
	}

	// ==========================================================================
	// Queries - Return Normalized Entities
	// ==========================================================================

	all<T extends Table<any>[]>(...tables: T): TaggedQuery<Infer<T[0]>[]> {
		return async (strings: TemplateStringsArray, ...values: unknown[]) => {
			const query = createQuery(tables, this.#dialect);
			const {sql, params} = query(strings, ...values);
			const rows = await this.#driver.all<Record<string, unknown>>(sql, params);
			return normalize<Infer<T[0]>>(rows, tables);
		};
	}

	one<T extends Table<any>[]>(...tables: T): TaggedQuery<Infer<T[0]> | null> {
		return async (strings: TemplateStringsArray, ...values: unknown[]) => {
			const query = createQuery(tables, this.#dialect);
			const {sql, params} = query(strings, ...values);
			const row = await this.#driver.get<Record<string, unknown>>(sql, params);
			return normalizeOne<Infer<T[0]>>(row, tables);
		};
	}

	// ==========================================================================
	// Mutations - Validate Through Zod
	// ==========================================================================

	async insert<T extends Table<any>>(table: T, data: Insert<T>): Promise<Infer<T>> {
		const validated = table.schema.parse(data);

		const columns = Object.keys(validated);
		const values = Object.values(validated);
		const tableName = this.#quoteIdent(table.name);
		const columnList = columns.map((c) => this.#quoteIdent(c)).join(", ");
		const placeholders = columns.map((_, i) => this.#placeholder(i + 1)).join(", ");

		const sql = `INSERT INTO ${tableName} (${columnList}) VALUES (${placeholders})`;
		await this.#driver.run(sql, values);

		return validated as Infer<T>;
	}

	async update<T extends Table<any>>(
		table: T,
		id: string | number | Record<string, unknown>,
		data: Partial<Insert<T>>,
	): Promise<Infer<T> | null> {
		const pk = table.primaryKey();
		if (!pk) {
			throw new Error(`Table ${table.name} has no primary key defined`);
		}

		const partialSchema = table.schema.partial();
		const validated = partialSchema.parse(data);

		const columns = Object.keys(validated);
		if (columns.length === 0) {
			throw new Error("No fields to update");
		}

		const values = Object.values(validated);
		const tableName = this.#quoteIdent(table.name);
		const setClause = columns
			.map((c, i) => `${this.#quoteIdent(c)} = ${this.#placeholder(i + 1)}`)
			.join(", ");

		const whereClause = `${this.#quoteIdent(pk)} = ${this.#placeholder(values.length + 1)}`;
		const whereParams = [id];

		const sql = `UPDATE ${tableName} SET ${setClause} WHERE ${whereClause}`;
		await this.#driver.run(sql, [...values, ...whereParams]);

		const selectSql = `SELECT * FROM ${tableName} WHERE ${whereClause}`;
		const row = await this.#driver.get<Record<string, unknown>>(selectSql, whereParams);

		if (!row) return null;

		return table.schema.parse(row) as Infer<T>;
	}

	async delete<T extends Table<any>>(
		table: T,
		id: string | number | Record<string, unknown>,
	): Promise<boolean> {
		const pk = table.primaryKey();
		if (!pk) {
			throw new Error(`Table ${table.name} has no primary key defined`);
		}

		const tableName = this.#quoteIdent(table.name);
		const whereClause = `${this.#quoteIdent(pk)} = ${this.#placeholder(1)}`;

		const sql = `DELETE FROM ${tableName} WHERE ${whereClause}`;
		const affected = await this.#driver.run(sql, [id]);

		return affected > 0;
	}

	// ==========================================================================
	// Raw - No Normalization
	// ==========================================================================

	async query<T = Record<string, unknown>>(
		strings: TemplateStringsArray,
		...values: unknown[]
	): Promise<T[]> {
		const {sql, params} = parseTemplate(strings, values, this.#dialect);
		return this.#driver.all<T>(sql, params);
	}

	async exec(strings: TemplateStringsArray, ...values: unknown[]): Promise<number> {
		const {sql, params} = parseTemplate(strings, values, this.#dialect);
		return this.#driver.run(sql, params);
	}

	async val<T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T> {
		const {sql, params} = parseTemplate(strings, values, this.#dialect);
		return this.#driver.val<T>(sql, params);
	}

	// ==========================================================================
	// Helpers
	// ==========================================================================

	#quoteIdent(name: string): string {
		if (this.#dialect === "mysql") {
			return `\`${name}\``;
		}
		return `"${name}"`;
	}

	#placeholder(index: number): string {
		if (this.#dialect === "postgresql") {
			return `$${index}`;
		}
		return "?";
	}
}

// ============================================================================
// Database
// ============================================================================

/**
 * Database wrapper with typed queries and entity normalization.
 * Extends EventTarget for IndexedDB-style "upgradeneeded" events.
 *
 * @example
 * const db = new Database(driver);
 *
 * db.addEventListener("upgradeneeded", (e) => {
 *   e.waitUntil(runMigrations(e));
 * });
 *
 * await db.open(2);
 */
export class Database extends EventTarget {
	#driver: DatabaseDriver;
	#dialect: SQLDialect;
	#version: number = 0;
	#opened: boolean = false;

	constructor(driver: DatabaseDriver, options: DatabaseOptions = {}) {
		super();
		this.#driver = driver;
		this.#dialect = options.dialect ?? "sqlite";
	}

	/**
	 * Current database schema version.
	 * Returns 0 if database has never been opened.
	 */
	get version(): number {
		return this.#version;
	}

	/**
	 * Open the database at a specific version.
	 *
	 * If the requested version is higher than the current version,
	 * fires an "upgradeneeded" event and waits for all waitUntil()
	 * promises before completing.
	 *
	 * Migration safety: Uses exclusive locking to prevent race conditions
	 * when multiple processes attempt migrations simultaneously.
	 *
	 * @example
	 * db.addEventListener("upgradeneeded", (e) => {
	 *   e.waitUntil(runMigrations(e));
	 * });
	 * await db.open(2);
	 */
	async open(version: number): Promise<void> {
		if (this.#opened) {
			throw new Error("Database already opened");
		}

		// Create table outside transaction (idempotent)
		await this.#ensureMigrationsTable();

		// Use exclusive transaction for migration safety
		// SQLite: BEGIN IMMEDIATE acquires write lock upfront
		// PostgreSQL/MySQL: SELECT FOR UPDATE locks the rows
		const beginSQL = this.#dialect === "sqlite"
			? "BEGIN IMMEDIATE"
			: this.#dialect === "mysql"
				? "START TRANSACTION"
				: "BEGIN";

		await this.#driver.run(beginSQL, []);

		try {
			// Re-check version inside lock to prevent race conditions
			const currentVersion = await this.#getCurrentVersionLocked();

			if (version > currentVersion) {
				const event = new DatabaseUpgradeEvent("upgradeneeded", {
					oldVersion: currentVersion,
					newVersion: version,
				});
				this.dispatchEvent(event);
				await event._settle();

				await this.#setVersion(version);
			}

			await this.#driver.run("COMMIT", []);
		} catch (error) {
			await this.#driver.run("ROLLBACK", []);
			throw error;
		}

		this.#version = version;
		this.#opened = true;
	}

	// ==========================================================================
	// Migration Table Helpers
	// ==========================================================================

	async #ensureMigrationsTable(): Promise<void> {
		const timestampCol =
			this.#dialect === "mysql"
				? "applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"
				: "applied_at TEXT DEFAULT CURRENT_TIMESTAMP";

		await this.#driver.run(
			`CREATE TABLE IF NOT EXISTS _migrations (
				version INTEGER PRIMARY KEY,
				${timestampCol}
			)`,
			[],
		);
	}

	async #getCurrentVersion(): Promise<number> {
		const row = await this.#driver.get<{version: number}>(
			"SELECT MAX(version) as version FROM _migrations",
			[],
		);
		return row?.version ?? 0;
	}

	async #getCurrentVersionLocked(): Promise<number> {
		// SQLite: BEGIN IMMEDIATE already holds write lock
		// PostgreSQL/MySQL: Use FOR UPDATE to lock rows
		const forUpdate = this.#dialect === "sqlite" ? "" : " FOR UPDATE";
		const row = await this.#driver.get<{version: number}>(
			`SELECT MAX(version) as version FROM _migrations${forUpdate}`,
			[],
		);
		return row?.version ?? 0;
	}

	async #setVersion(version: number): Promise<void> {
		await this.#driver.run(
			`INSERT INTO _migrations (version) VALUES (${this.#placeholder(1)})`,
			[version],
		);
	}

	// ==========================================================================
	// Queries - Return Normalized Entities
	// ==========================================================================

	/**
	 * Query multiple entities with joins and reference resolution.
	 *
	 * @example
	 * const posts = await db.all(posts, users)`
	 *   JOIN users ON users.id = posts.author_id
	 *   WHERE published = ${true}
	 * `;
	 * posts[0].author.name  // "Alice"
	 */
	all<T extends Table<any>[]>(
		...tables: T
	): TaggedQuery<Infer<T[0]>[]> {
		return async (strings: TemplateStringsArray, ...values: unknown[]) => {
			const query = createQuery(tables, this.#dialect);
			const {sql, params} = query(strings, ...values);
			const rows = await this.#driver.all<Record<string, unknown>>(sql, params);
			return normalize<Infer<T[0]>>(rows, tables);
		};
	}

	/**
	 * Query a single entity.
	 *
	 * @example
	 * const post = await db.one(posts, users)`
	 *   JOIN users ON users.id = posts.author_id
	 *   WHERE posts.id = ${postId}
	 * `;
	 */
	one<T extends Table<any>[]>(
		...tables: T
	): TaggedQuery<Infer<T[0]> | null> {
		return async (strings: TemplateStringsArray, ...values: unknown[]) => {
			const query = createQuery(tables, this.#dialect);
			const {sql, params} = query(strings, ...values);
			const row = await this.#driver.get<Record<string, unknown>>(sql, params);
			return normalizeOne<Infer<T[0]>>(row, tables);
		};
	}

	// ==========================================================================
	// Mutations - Validate Through Zod
	// ==========================================================================

	/**
	 * Insert a new entity.
	 *
	 * @example
	 * const user = await db.insert(users, {
	 *   id: crypto.randomUUID(),
	 *   email: "alice@example.com",
	 *   name: "Alice",
	 * });
	 */
	async insert<T extends Table<any>>(
		table: T,
		data: Insert<T>,
	): Promise<Infer<T>> {
		const validated = table.schema.parse(data);

		const columns = Object.keys(validated);
		const values = Object.values(validated);
		const tableName = this.#quoteIdent(table.name);
		const columnList = columns.map((c) => this.#quoteIdent(c)).join(", ");
		const placeholders = columns
			.map((_, i) => this.#placeholder(i + 1))
			.join(", ");

		const sql = `INSERT INTO ${tableName} (${columnList}) VALUES (${placeholders})`;
		await this.#driver.run(sql, values);

		return validated as Infer<T>;
	}

	/**
	 * Update an entity by primary key.
	 *
	 * @example
	 * const user = await db.update(users, userId, { name: "Bob" });
	 */
	async update<T extends Table<any>>(
		table: T,
		id: string | number | Record<string, unknown>,
		data: Partial<Insert<T>>,
	): Promise<Infer<T> | null> {
		const pk = table.primaryKey();
		if (!pk) {
			throw new Error(`Table ${table.name} has no primary key defined`);
		}

		const partialSchema = table.schema.partial();
		const validated = partialSchema.parse(data);

		const columns = Object.keys(validated);
		if (columns.length === 0) {
			throw new Error("No fields to update");
		}

		const values = Object.values(validated);
		const tableName = this.#quoteIdent(table.name);
		const setClause = columns
			.map((c, i) => `${this.#quoteIdent(c)} = ${this.#placeholder(i + 1)}`)
			.join(", ");

		const whereClause = `${this.#quoteIdent(pk)} = ${this.#placeholder(values.length + 1)}`;
		const whereParams = [id];

		const sql = `UPDATE ${tableName} SET ${setClause} WHERE ${whereClause}`;
		await this.#driver.run(sql, [...values, ...whereParams]);

		const selectSql = `SELECT * FROM ${tableName} WHERE ${whereClause}`;
		const row = await this.#driver.get<Record<string, unknown>>(
			selectSql,
			whereParams,
		);

		if (!row) return null;

		return table.schema.parse(row) as Infer<T>;
	}

	/**
	 * Delete an entity by primary key.
	 *
	 * @example
	 * const deleted = await db.delete(users, userId);
	 */
	async delete<T extends Table<any>>(
		table: T,
		id: string | number | Record<string, unknown>,
	): Promise<boolean> {
		const pk = table.primaryKey();
		if (!pk) {
			throw new Error(`Table ${table.name} has no primary key defined`);
		}

		const tableName = this.#quoteIdent(table.name);
		const whereClause = `${this.#quoteIdent(pk)} = ${this.#placeholder(1)}`;

		const sql = `DELETE FROM ${tableName} WHERE ${whereClause}`;
		const affected = await this.#driver.run(sql, [id]);

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
		const {sql, params} = parseTemplate(strings, values, this.#dialect);
		return this.#driver.all<T>(sql, params);
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
		const {sql, params} = parseTemplate(strings, values, this.#dialect);
		return this.#driver.run(sql, params);
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
		const {sql, params} = parseTemplate(strings, values, this.#dialect);
		return this.#driver.val<T>(sql, params);
	}

	// ==========================================================================
	// Transactions
	// ==========================================================================

	/**
	 * Execute a function within a database transaction.
	 *
	 * If the function completes successfully, the transaction is committed.
	 * If the function throws an error, the transaction is rolled back.
	 *
	 * For connection-pooled drivers that implement `beginTransaction()`,
	 * all operations are guaranteed to use the same connection.
	 *
	 * @example
	 * await db.transaction(async (tx) => {
	 *   const user = await tx.insert(users, { id: "1", name: "Alice" });
	 *   await tx.insert(posts, { id: "1", authorId: user.id, title: "Hello" });
	 *   // If any insert fails, both are rolled back
	 * });
	 */
	async transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
		// Use driver's transaction support if available (for connection pools)
		if (this.#driver.beginTransaction) {
			const txDriver = await this.#driver.beginTransaction();
			const tx = new Transaction(txDriver, this.#dialect);
			try {
				const result = await fn(tx);
				await txDriver.commit();
				return result;
			} catch (error) {
				await txDriver.rollback();
				throw error;
			}
		}

		// Fallback: SQL-based transactions (for single-connection drivers)
		const begin = this.#dialect === "mysql" ? "START TRANSACTION" : "BEGIN";
		await this.#driver.run(begin, []);
		const tx = new Transaction(this.#driver, this.#dialect);
		try {
			const result = await fn(tx);
			await this.#driver.run("COMMIT", []);
			return result;
		} catch (error) {
			await this.#driver.run("ROLLBACK", []);
			throw error;
		}
	}

	// ==========================================================================
	// Helpers
	// ==========================================================================

	#quoteIdent(name: string): string {
		if (this.#dialect === "mysql") {
			return `\`${name}\``;
		}
		return `"${name}"`;
	}

	#placeholder(index: number): string {
		if (this.#dialect === "postgresql") {
			return `$${index}`;
		}
		return "?";
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
