/**
 * Bun.SQL adapter for @b9g/database
 *
 * Unified driver supporting PostgreSQL, MySQL, and SQLite via Bun's built-in SQL.
 * Zero dependencies - uses native Bun implementation.
 */

import {SQL} from "bun";
import type {DatabaseAdapter, DatabaseDriver} from "./database.js";
import type {SQLDialect} from "./query.js";

export type {DatabaseAdapter};

/**
 * Detect SQL dialect from URL.
 */
function detectDialect(url: string): SQLDialect {
	if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
		return "postgresql";
	}
	if (
		url.startsWith("mysql://") ||
		url.startsWith("mysql2://") ||
		url.startsWith("mariadb://")
	) {
		return "mysql";
	}
	// sqlite://, file:, :memory:, or plain filename
	return "sqlite";
}

/**
 * Create a DatabaseDriver from a Bun.SQL connection.
 *
 * @param url - Database URL:
 *   - PostgreSQL: "postgres://user:pass@localhost:5432/db"
 *   - MySQL: "mysql://user:pass@localhost:3306/db"
 *   - SQLite: "sqlite://path.db", ":memory:", or "file:path.db"
 * @param options - Additional SQL options
 * @returns DatabaseAdapter with driver, close function, and detected dialect
 *
 * @example
 * import { createDriver } from "@b9g/database/bun-sql";
 * import { Database } from "@b9g/database";
 *
 * const { driver, close, dialect } = createDriver("postgres://localhost/mydb");
 * const db = new Database(driver, { dialect });
 *
 * db.addEventListener("upgradeneeded", (e) => {
 *   e.waitUntil(runMigrations(e));
 * });
 *
 * await db.open(1);
 *
 * // When done:
 * await close();
 */
export function createDriver(
	url: string,
	options?: Record<string, unknown>,
): DatabaseAdapter & {dialect: SQLDialect} {
	const dialect = detectDialect(url);
	const sql = new SQL(url, options as any);

	const driver: DatabaseDriver = {
		async all<T>(query: string, params: unknown[]): Promise<T[]> {
			const result = await sql.unsafe(query, params as any[]);
			return result as T[];
		},

		async get<T>(query: string, params: unknown[]): Promise<T | null> {
			const result = await sql.unsafe(query, params as any[]);
			return (result[0] as T) ?? null;
		},

		async run(query: string, params: unknown[]): Promise<number> {
			const result = await sql.unsafe(query, params as any[]);
			// Bun.SQL: .count for postgres/sqlite, .affectedRows for mysql
			return (
				(result as any).count ?? (result as any).affectedRows ?? result.length
			);
		},

		async val<T>(query: string, params: unknown[]): Promise<T> {
			const result = await sql.unsafe(query, params as any[]);
			if (result.length === 0) return null as T;
			const row = result[0] as Record<string, unknown>;
			const firstKey = Object.keys(row)[0];
			return row[firstKey] as T;
		},
	};

	const close = async (): Promise<void> => {
		await sql.close();
	};

	return {driver, close, dialect};
}
