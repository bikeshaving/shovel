import {test, expect, describe, afterEach} from "bun:test";
import {createDriver} from "./bun-sql.js";
import {Database} from "./database.js";

describe("@b9g/database/bun-sql", () => {
	let cleanup: (() => Promise<void>)[] = [];

	afterEach(async () => {
		for (const fn of cleanup) {
			await fn();
		}
		cleanup = [];
	});

	describe("SQLite", () => {
		test("detects sqlite dialect", () => {
			const {dialect, close} = createDriver(":memory:");
			cleanup.push(close);
			expect(dialect).toBe("sqlite");
		});

		test("detects sqlite from sqlite:// URL", () => {
			const {dialect, close} = createDriver("sqlite://:memory:");
			cleanup.push(close);
			expect(dialect).toBe("sqlite");
		});

		test("driver.all returns array of rows", async () => {
			const {driver, close} = createDriver(":memory:");
			cleanup.push(close);

			const result = await driver.all<{n: number}>(
				"SELECT 1 as n UNION SELECT 2 UNION SELECT 3 ORDER BY n",
				[],
			);
			expect(result).toHaveLength(3);
			expect(result.map((r) => r.n)).toEqual([1, 2, 3]);
		});

		test("driver.get returns single row or null", async () => {
			const {driver, close} = createDriver(":memory:");
			cleanup.push(close);

			const result = await driver.get<{value: number}>("SELECT 42 as value", []);
			expect(result).toEqual({value: 42});

			const noResult = await driver.get<{value: number}>(
				"SELECT 1 WHERE 0",
				[],
			);
			expect(noResult).toBeNull();
		});

		test("driver.run returns affected row count", async () => {
			const {driver, close} = createDriver(":memory:");
			cleanup.push(close);

			await driver.run(
				"CREATE TABLE test_run (id INTEGER PRIMARY KEY, name TEXT)",
				[],
			);

			const insertCount = await driver.run(
				"INSERT INTO test_run (name) VALUES (?), (?)",
				["a", "b"],
			);
			expect(insertCount).toBe(2);
		});

		test("driver.val returns single value", async () => {
			const {driver, close} = createDriver(":memory:");
			cleanup.push(close);

			const value = await driver.val<number>("SELECT 123", []);
			expect(value).toBe(123);
		});

		test("parameterized queries work", async () => {
			const {driver, close} = createDriver(":memory:");
			cleanup.push(close);

			const result = await driver.get<{sum: number}>("SELECT ? + ? as sum", [
				10,
				20,
			]);
			expect(result?.sum).toBe(30);
		});

		test("Database class works with bun-sql driver", async () => {
			const {driver, close, dialect} = createDriver(":memory:");
			cleanup.push(close);

			const db = new Database(driver, {dialect});

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
							CREATE TABLE IF NOT EXISTS test_users (
								id INTEGER PRIMARY KEY,
								name TEXT NOT NULL
							)
						`;
					})(),
				);
			});

			await db.open(1);

			expect(migrationRan).toBe(true);
			expect(oldVersion).toBe(0);
			expect(newVersion).toBe(1);

			await db.exec`INSERT INTO test_users (name) VALUES ('Alice')`;
			const users = await db.query<{id: number; name: string}>`
				SELECT id, name FROM test_users
			`;
			expect(users).toHaveLength(1);
			expect(users[0].name).toBe("Alice");
		});
	});

	describe("PostgreSQL (requires running server)", () => {
		test.skipIf(!process.env.TEST_POSTGRES)("detects postgresql dialect", () => {
			const {dialect, close} = createDriver("postgres://localhost/postgres");
			cleanup.push(close);
			expect(dialect).toBe("postgresql");
		});
	});

	describe("MySQL (requires running server)", () => {
		test.skipIf(!process.env.TEST_MYSQL)("detects mysql dialect", () => {
			const {dialect, close} = createDriver("mysql://root@localhost/mysql");
			cleanup.push(close);
			expect(dialect).toBe("mysql");
		});
	});
});
