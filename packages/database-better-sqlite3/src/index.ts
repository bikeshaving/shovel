/**
 * @b9g/database-better-sqlite3 - better-sqlite3 adapter for @b9g/database
 *
 * Creates a DatabaseDriver from better-sqlite3 (Node.js).
 * The connection is persistent - call close() when done.
 */

import type {DatabaseAdapter, DatabaseDriver, SQLDialect} from "@b9g/database";
import Database from "better-sqlite3";

export type {DatabaseAdapter};

/**
 * SQL dialect for this adapter.
 */
export const dialect: SQLDialect = "sqlite";

/**
 * Create a DatabaseDriver from a better-sqlite3 connection.
 *
 * @param url - Database URL (e.g., "file:data/app.db" or ":memory:")
 * @returns DatabaseAdapter with driver and close function
 *
 * @example
 * import { createDriver } from "@b9g/database-better-sqlite3";
 * import { Database as DB } from "@b9g/database";
 *
 * const { driver, close } = createDriver("file:app.db");
 * const db = new DB(driver);
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
export function createDriver(url: string): DatabaseAdapter {
	// Handle file: prefix
	const path = url.startsWith("file:") ? url.slice(5) : url;
	const sqlite = new Database(path);

	// Enable WAL mode for better concurrency
	sqlite.pragma("journal_mode = WAL");

	const driver: DatabaseDriver = {
		async all<T>(sql: string, params: unknown[]): Promise<T[]> {
			return sqlite.prepare(sql).all(...params) as T[];
		},

		async get<T>(sql: string, params: unknown[]): Promise<T | null> {
			return (sqlite.prepare(sql).get(...params) as T) ?? null;
		},

		async run(sql: string, params: unknown[]): Promise<number> {
			const result = sqlite.prepare(sql).run(...params);
			return result.changes;
		},

		async val<T>(sql: string, params: unknown[]): Promise<T> {
			return sqlite.prepare(sql).pluck().get(...params) as T;
		},
	};

	const close = async (): Promise<void> => {
		sqlite.close();
	};

	return {driver, close};
}
