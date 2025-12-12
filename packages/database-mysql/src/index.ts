/**
 * @b9g/database-mysql - mysql2 adapter for @b9g/database
 *
 * Creates a DatabaseDriver from mysql2 connection pool.
 * Uses connection pooling - call close() when done to end all connections.
 */

import type {DatabaseAdapter, DatabaseDriver, SQLDialect} from "@b9g/database";
import mysql from "mysql2/promise";

export type {DatabaseAdapter};

/**
 * SQL dialect for this adapter.
 */
export const dialect: SQLDialect = "mysql";

/**
 * Options for the mysql adapter.
 */
export interface MySQLOptions {
	/** Maximum number of connections in the pool (default: 10) */
	connectionLimit?: number;
	/** Idle timeout in milliseconds (default: 60000) */
	idleTimeout?: number;
	/** Connection timeout in milliseconds (default: 10000) */
	connectTimeout?: number;
}

/**
 * Create a DatabaseDriver from a mysql2 connection pool.
 *
 * @param url - MySQL connection URL
 * @param options - Connection pool options
 * @returns DatabaseAdapter with driver and close function
 *
 * @example
 * import { createDriver } from "@b9g/database-mysql";
 * import { Database } from "@b9g/database";
 *
 * const { driver, close } = createDriver("mysql://localhost/mydb");
 * const db = new Database(driver, { dialect: "mysql" });
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
export function createDriver(url: string, options: MySQLOptions = {}): DatabaseAdapter {
	const pool = mysql.createPool({
		uri: url,
		connectionLimit: options.connectionLimit ?? 10,
		idleTimeout: options.idleTimeout ?? 60000,
		connectTimeout: options.connectTimeout ?? 10000,
	});

	const driver: DatabaseDriver = {
		async all<T>(sql: string, params: unknown[]): Promise<T[]> {
			const [rows] = await pool.execute(sql, params);
			return rows as T[];
		},

		async get<T>(sql: string, params: unknown[]): Promise<T | null> {
			const [rows] = await pool.execute(sql, params);
			return ((rows as unknown[])[0] as T) ?? null;
		},

		async run(sql: string, params: unknown[]): Promise<number> {
			const [result] = await pool.execute(sql, params);
			return (result as mysql.ResultSetHeader).affectedRows ?? 0;
		},

		async val<T>(sql: string, params: unknown[]): Promise<T> {
			const [rows] = await pool.execute(sql, params);
			const row = (rows as unknown[])[0];
			if (!row) return null as T;
			const values = Object.values(row as object);
			return values[0] as T;
		},
	};

	const close = async (): Promise<void> => {
		await pool.end();
	};

	return {driver, close};
}
