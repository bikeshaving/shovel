import {test, expect, describe, afterEach} from "bun:test";
import {CustomDatabaseStorage, type DatabaseConfig} from "../src/runtime.js";
import {createDriver} from "@b9g/database/bun-sql";

describe("Database Integration (Bun.SQL)", () => {
	let storage: CustomDatabaseStorage | null = null;

	afterEach(async () => {
		if (storage) {
			await storage.closeAll();
			storage = null;
		}
	});

	test("CustomDatabaseStorage creates working SQLite database", async () => {
		storage = new CustomDatabaseStorage({
			main: {
				adapter: {
					module: "@b9g/database/bun-sql",
					createDriver,
					dialect: "sqlite",
				},
				url: ":memory:",
			},
		});

		const db = storage.get("main");
		expect(db).toBeDefined();

		// Open the database with version 1
		await db.open(1);

		// Verify it has the expected Database methods
		expect(db.all).toBeInstanceOf(Function);
		expect(db.one).toBeInstanceOf(Function);
		expect(db.exec).toBeInstanceOf(Function);
		expect(db.insert).toBeInstanceOf(Function);
		expect(db.update).toBeInstanceOf(Function);
		expect(db.delete).toBeInstanceOf(Function);
	});

	test("can execute real SQL operations", async () => {
		storage = new CustomDatabaseStorage({
			main: {
				adapter: {
					module: "@b9g/database/bun-sql",
					createDriver,
					dialect: "sqlite",
				},
				url: ":memory:",
			},
		});

		const db = storage.get("main");
		await db.open(1);

		// Create the table
		await db.exec`
			CREATE TABLE users (
				id INTEGER PRIMARY KEY,
				name TEXT NOT NULL,
				email TEXT NOT NULL
			)
		`;

		// Insert a user using tagged template
		await db.exec`
			INSERT INTO users (id, name, email) VALUES (1, 'Alice', 'alice@example.com')
		`;

		// Query users using query() for raw SQL
		const result = await db.query<{id: number; name: string; email: string}>`
			SELECT * FROM users
		`;

		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({
			id: 1,
			name: "Alice",
			email: "alice@example.com",
		});
	});

	test("get() returns cached database instance", async () => {
		storage = new CustomDatabaseStorage({
			main: {
				adapter: {
					module: "@b9g/database/bun-sql",
					createDriver,
					dialect: "sqlite",
				},
				url: ":memory:",
			},
		});

		const db1 = storage.get("main");
		await db1.open(1);

		// Second get returns same instance
		const db2 = storage.get("main");
		expect(db2).toBe(db1);
	});

	test("close() properly closes SQLite connection", async () => {
		storage = new CustomDatabaseStorage({
			main: {
				adapter: {
					module: "@b9g/database/bun-sql",
					createDriver,
					dialect: "sqlite",
				},
				url: ":memory:",
			},
		});

		const db = storage.get("main");
		await db.open(1);

		// Create a table to verify db is working
		await db.exec`CREATE TABLE test (id INTEGER)`;

		// Close should not throw
		await storage.close("main");

		// After close, the database should no longer be tracked
		expect(storage.has("main")).toBe(false);
	});

	test("upgradeneeded event fires on first open", async () => {
		storage = new CustomDatabaseStorage({
			main: {
				adapter: {
					module: "@b9g/database/bun-sql",
					createDriver,
					dialect: "sqlite",
				},
				url: ":memory:",
			},
		});

		const db = storage.get("main");

		let eventFired = false;
		let oldVersion = -1;
		let newVersion = -1;

		db.addEventListener("upgradeneeded", (ev: any) => {
			eventFired = true;
			oldVersion = ev.oldVersion;
			newVersion = ev.newVersion;
		});

		await db.open(1);

		expect(eventFired).toBe(true);
		expect(oldVersion).toBe(0);
		expect(newVersion).toBe(1);
	});

	test("migrations run via upgradeneeded event", async () => {
		storage = new CustomDatabaseStorage({
			main: {
				adapter: {
					module: "@b9g/database/bun-sql",
					createDriver,
					dialect: "sqlite",
				},
				url: ":memory:",
			},
		});

		const db = storage.get("main");

		db.addEventListener("upgradeneeded", (ev: any) => {
			ev.waitUntil(
				(async () => {
					if (ev.oldVersion < 1) {
						await db.exec`
							CREATE TABLE users (
								id INTEGER PRIMARY KEY,
								name TEXT NOT NULL
							)
						`;
					}
				})(),
			);
		});

		await db.open(1);

		// Table should exist after migration
		const result = await db.all<{name: string}>`
			SELECT name FROM sqlite_master WHERE type='table' AND name='users'
		`;
		expect(result).toHaveLength(1);
	});

	test("insert with RETURNING clause", async () => {
		storage = new CustomDatabaseStorage({
			main: {
				adapter: {
					module: "@b9g/database/bun-sql",
					createDriver,
					dialect: "sqlite",
				},
				url: ":memory:",
			},
		});

		const db = storage.get("main");
		await db.open(1);

		await db.exec`
			CREATE TABLE users (
				id INTEGER PRIMARY KEY,
				name TEXT NOT NULL
			)
		`;

		// Use raw SQL with RETURNING (SQLite supports this in recent versions)
		const inserted = await db.query<{id: number; name: string}>`
			INSERT INTO users (name) VALUES ('Alice') RETURNING id, name
		`;

		expect(inserted).toHaveLength(1);
		expect(inserted[0].name).toBe("Alice");
		expect(inserted[0].id).toBe(1);
	});

	test("val() returns single value", async () => {
		storage = new CustomDatabaseStorage({
			main: {
				adapter: {
					module: "@b9g/database/bun-sql",
					createDriver,
					dialect: "sqlite",
				},
				url: ":memory:",
			},
		});

		const db = storage.get("main");
		await db.open(1);

		await db.exec`CREATE TABLE items (id INTEGER PRIMARY KEY)`;
		await db.exec`INSERT INTO items (id) VALUES (1), (2), (3)`;

		const count = await db.val<number>`SELECT COUNT(*) FROM items`;
		expect(count).toBe(3);
	});
});
