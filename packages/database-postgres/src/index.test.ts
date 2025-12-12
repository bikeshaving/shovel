import {test, expect, describe, afterEach} from "bun:test";
import {createDriver, dialect} from "./index.js";
import {Database} from "@b9g/database";

describe("@b9g/database-postgres", () => {
	let cleanup: (() => Promise<void>)[] = [];

	afterEach(async () => {
		for (const fn of cleanup) {
			await fn();
		}
		cleanup = [];
	});

	test("dialect is postgresql", () => {
		expect(dialect).toBe("postgresql");
	});

	test("createDriver connects to PostgreSQL", async () => {
		const {driver, close} = createDriver("postgres://localhost/postgres");
		cleanup.push(close);

		// Simple query to verify connection
		const result = await driver.val<number>("SELECT 1 as value", []);
		expect(result).toBe(1);
	});

	test("driver.all returns array of rows", async () => {
		const {driver, close} = createDriver("postgres://localhost/postgres");
		cleanup.push(close);

		const result = await driver.all<{n: number}>(
			"SELECT generate_series(1, 3) as n",
			[],
		);
		expect(result).toHaveLength(3);
		expect(result.map((r) => r.n)).toEqual([1, 2, 3]);
	});

	test("driver.get returns single row or null", async () => {
		const {driver, close} = createDriver("postgres://localhost/postgres");
		cleanup.push(close);

		const result = await driver.get<{value: number}>("SELECT 42 as value", []);
		expect(result).toEqual({value: 42});

		const noResult = await driver.get<{value: number}>(
			"SELECT 1 WHERE false",
			[],
		);
		expect(noResult).toBeNull();
	});

	test("driver.run returns affected row count", async () => {
		const {driver, close} = createDriver("postgres://localhost/postgres");
		cleanup.push(close);

		// Create temp table
		await driver.run(
			"CREATE TEMP TABLE test_run (id SERIAL PRIMARY KEY, name TEXT)",
			[],
		);

		// Insert returns count
		const insertCount = await driver.run(
			"INSERT INTO test_run (name) VALUES ($1), ($2)",
			["a", "b"],
		);
		expect(insertCount).toBe(2);

		// Update returns count
		const updateCount = await driver.run(
			"UPDATE test_run SET name = $1 WHERE name = $2",
			["updated", "a"],
		);
		expect(updateCount).toBe(1);
	});

	test("driver.val returns single value", async () => {
		const {driver, close} = createDriver("postgres://localhost/postgres");
		cleanup.push(close);

		// postgres.js returns COUNT(*) as string (bigint behavior) by default
		const count = await driver.val<string>("SELECT COUNT(*) FROM pg_tables", []);
		expect(typeof count).toBe("string");
		expect(Number(count)).toBeGreaterThan(0);
	});

	test("parameterized queries work", async () => {
		const {driver, close} = createDriver("postgres://localhost/postgres");
		cleanup.push(close);

		const result = await driver.get<{sum: number}>(
			"SELECT $1::int + $2::int as sum",
			[10, 20],
		);
		expect(result?.sum).toBe(30);
	});

	test("Database class works with postgres driver", async () => {
		const {driver, close} = createDriver("postgres://localhost/postgres");
		cleanup.push(close);

		const db = new Database(driver, {dialect: "postgresql"});

		// Track migration events
		let migrationRan = false;
		let oldVersion = -1;
		let newVersion = -1;

		db.addEventListener("upgradeneeded", (ev: any) => {
			migrationRan = true;
			oldVersion = ev.oldVersion;
			newVersion = ev.newVersion;

			ev.waitUntil(
				(async () => {
					await db.exec`
						CREATE TABLE IF NOT EXISTS pg_test_users (
							id SERIAL PRIMARY KEY,
							name TEXT NOT NULL,
							created_at TIMESTAMP DEFAULT NOW()
						)
					`;
				})(),
			);
		});

		await db.open(1);

		expect(migrationRan).toBe(true);
		expect(oldVersion).toBe(0);
		expect(newVersion).toBe(1);

		// Insert and query
		await db.exec`INSERT INTO pg_test_users (name) VALUES ('Alice')`;
		const users = await db.query<{id: number; name: string}>`
			SELECT id, name FROM pg_test_users
		`;
		expect(users).toHaveLength(1);
		expect(users[0].name).toBe("Alice");

		// Cleanup
		await db.exec`DROP TABLE IF EXISTS pg_test_users`;
		await db.exec`DROP TABLE IF EXISTS _migrations`;
	});

	test("multiple connections via pool", async () => {
		const {driver, close} = createDriver("postgres://localhost/postgres", {
			max: 5,
		});
		cleanup.push(close);

		// Run concurrent queries
		const results = await Promise.all([
			driver.val<number>("SELECT 1", []),
			driver.val<number>("SELECT 2", []),
			driver.val<number>("SELECT 3", []),
			driver.val<number>("SELECT 4", []),
			driver.val<number>("SELECT 5", []),
		]);

		expect(results).toEqual([1, 2, 3, 4, 5]);
	});
});
