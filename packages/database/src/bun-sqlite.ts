/**
 * bun:sqlite adapter for @b9g/database
 *
 * Creates a DatabaseDriver from Bun's built-in SQLite.
 * The connection is persistent - call close() when done.
 */

import {Database as BunSQLite} from "bun:sqlite";
import type {DatabaseAdapter, DatabaseDriver} from "./database.js";
import type {SQLDialect} from "./query.js";

export type {DatabaseAdapter};

/**
 * SQL dialect for this adapter.
 */
export const dialect: SQLDialect = "sqlite";

/**
 * Create a DatabaseDriver from a bun:sqlite connection.
 *
 * @param url - Database URL (e.g., "file:data/app.db" or ":memory:")
 * @returns DatabaseAdapter with driver and close function
 *
 * @example
 * import { createDriver } from "@b9g/database/bun-sqlite";
 * import { Database } from "@b9g/database";
 *
 * const { driver, close } = createDriver("file:app.db");
 * const db = new Database(driver);
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
	const sqlite = new BunSQLite(path);

	// Enable WAL mode for better concurrency
	sqlite.run("PRAGMA journal_mode = WAL");

	const driver: DatabaseDriver = {
		async all<T>(sql: string, params: unknown[]): Promise<T[]> {
			return sqlite.query<T, any[]>(sql).all(...(params as any[]));
		},

		async get<T>(sql: string, params: unknown[]): Promise<T | null> {
			return sqlite.query<T, any[]>(sql).get(...(params as any[]));
		},

		async run(sql: string, params: unknown[]): Promise<number> {
			const result = sqlite.query(sql).run(...(params as any[]));
			return result.changes;
		},

		async val<T>(sql: string, params: unknown[]): Promise<T> {
			const rows = sqlite.query(sql).values(...(params as any[]));
			return (rows[0]?.[0] ?? null) as T;
		},
	};

	const close = async (): Promise<void> => {
		sqlite.close();
	};

	return {driver, close};
}
