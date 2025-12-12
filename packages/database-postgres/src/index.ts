/**
 * @b9g/database-postgres - postgres.js adapter for @b9g/database
 *
 * Creates a DatabaseDriver from postgres.js.
 * Uses connection pooling - call close() when done to end all connections.
 */

import type {DatabaseAdapter, DatabaseDriver, SQLDialect} from "@b9g/database";
import postgres from "postgres";

export type {DatabaseAdapter};

/**
 * SQL dialect for this adapter.
 */
export const dialect: SQLDialect = "postgresql";

/**
 * Options for the postgres adapter.
 */
export interface PostgresOptions {
	/** Maximum number of connections in the pool (default: 10) */
	max?: number;
	/** Idle timeout in seconds before closing connections (default: 30) */
	idleTimeout?: number;
	/** Connection timeout in seconds (default: 30) */
	connectTimeout?: number;
}

/**
 * Create a DatabaseDriver from a postgres.js connection.
 *
 * @param url - PostgreSQL connection URL
 * @param options - Connection pool options
 * @returns DatabaseAdapter with driver and close function
 *
 * @example
 * import { createDriver } from "@b9g/database-postgres";
 * import { Database } from "@b9g/database";
 *
 * const { driver, close } = createDriver("postgresql://localhost/mydb");
 * const db = new Database(driver, { dialect: "postgresql" });
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
export function createDriver(url: string, options: PostgresOptions = {}): DatabaseAdapter {
	const sql = postgres(url, {
		max: options.max ?? 10,
		idle_timeout: options.idleTimeout ?? 30,
		connect_timeout: options.connectTimeout ?? 30,
	});

	const driver: DatabaseDriver = {
		async all<T>(query: string, params: unknown[]): Promise<T[]> {
			const result = await sql.unsafe<T[]>(query, params as any[]);
			return result;
		},

		async get<T>(query: string, params: unknown[]): Promise<T | null> {
			const result = await sql.unsafe<T[]>(query, params as any[]);
			return result[0] ?? null;
		},

		async run(query: string, params: unknown[]): Promise<number> {
			const result = await sql.unsafe(query, params as any[]);
			return result.count;
		},

		async val<T>(query: string, params: unknown[]): Promise<T> {
			const result = await sql.unsafe(query, params as any[]);
			const row = result[0];
			if (!row) return null as T;
			const values = Object.values(row as object);
			return values[0] as T;
		},
	};

	const close = async (): Promise<void> => {
		await sql.end();
	};

	return {driver, close};
}
