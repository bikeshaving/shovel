import {test, expect, describe, afterEach} from "bun:test";
import {createDriver, dialect} from "./index.js";
import {Database} from "@b9g/database";

describe("@b9g/database-mysql", () => {
	let cleanup: (() => Promise<void>)[] = [];

	afterEach(async () => {
		for (const fn of cleanup) {
			await fn();
		}
		cleanup = [];
	});

	test("dialect is mysql", () => {
		expect(dialect).toBe("mysql");
	});

	test("createDriver connects to MySQL", async () => {
		const {driver, close} = createDriver("mysql://root@localhost/mysql");
		cleanup.push(close);

		// Simple query to verify connection
		const result = await driver.val<number>("SELECT 1 as value", []);
		expect(result).toBe(1);
	});

	test("driver.all returns array of rows", async () => {
		const {driver, close} = createDriver("mysql://root@localhost/mysql");
		cleanup.push(close);

		// MySQL doesn't have generate_series, use union
		const result = await driver.all<{n: number}>(
			"SELECT 1 as n UNION SELECT 2 UNION SELECT 3 ORDER BY n",
			[],
		);
		expect(result).toHaveLength(3);
		expect(result.map((r) => r.n)).toEqual([1, 2, 3]);
	});

	test("driver.get returns single row or null", async () => {
		const {driver, close} = createDriver("mysql://root@localhost/mysql");
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
		const {driver, close} = createDriver("mysql://root@localhost/mysql");
		cleanup.push(close);

		// Create temp table
		await driver.run(
			"CREATE TEMPORARY TABLE test_run (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255))",
			[],
		);

		// Insert returns count
		const insertCount = await driver.run(
			"INSERT INTO test_run (name) VALUES (?), (?)",
			["a", "b"],
		);
		expect(insertCount).toBe(2);

		// Update returns count
		const updateCount = await driver.run(
			"UPDATE test_run SET name = ? WHERE name = ?",
			["updated", "a"],
		);
		expect(updateCount).toBe(1);
	});

	test("driver.val returns single value", async () => {
		const {driver, close} = createDriver("mysql://root@localhost/mysql");
		cleanup.push(close);

		const count = await driver.val<number>(
			"SELECT COUNT(*) FROM information_schema.tables",
			[],
		);
		expect(typeof count).toBe("number");
		expect(count).toBeGreaterThan(0);
	});

	test("parameterized queries work", async () => {
		const {driver, close} = createDriver("mysql://root@localhost/mysql");
		cleanup.push(close);

		const result = await driver.get<{sum: number}>("SELECT ? + ? as sum", [
			10,
			20,
		]);
		expect(result?.sum).toBe(30);
	});

	test("Database class works with mysql driver", async () => {
		const {driver, close} = createDriver("mysql://root@localhost/mysql");
		cleanup.push(close);

		const db = new Database(driver, {dialect: "mysql"});

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
						CREATE TABLE IF NOT EXISTS mysql_test_users (
							id INT AUTO_INCREMENT PRIMARY KEY,
							name VARCHAR(255) NOT NULL,
							created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
		await db.exec`INSERT INTO mysql_test_users (name) VALUES ('Alice')`;
		const users = await db.query<{id: number; name: string}>`
			SELECT id, name FROM mysql_test_users
		`;
		expect(users).toHaveLength(1);
		expect(users[0].name).toBe("Alice");

		// Cleanup
		await db.exec`DROP TABLE IF EXISTS mysql_test_users`;
		await db.exec`DROP TABLE IF EXISTS _migrations`;
	});

	test("multiple connections via pool", async () => {
		const {driver, close} = createDriver("mysql://root@localhost/mysql", {
			connectionLimit: 5,
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
