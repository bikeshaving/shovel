import {test, expect, describe, afterEach} from "bun:test";
import {CustomDatabaseStorage} from "../src/runtime.js";
import {Database} from "@b9g/zen";
import BunDriver from "@b9g/zen/bun";

// Factory that creates in-memory SQLite databases (async to match interface)
const createFactory = () => {
	return async (name: string) => {
		if (name === "main") {
			const driver = new BunDriver(":memory:");
			return {
				db: new Database(driver),
				close: () => driver.close(),
			};
		}
		throw new Error(`Database "${name}" is not configured.`);
	};
};

describe("Database Integration (Bun.SQL)", () => {
	let storage: CustomDatabaseStorage | null = null;

	afterEach(async () => {
		if (storage) {
			await storage.closeAll();
			storage = null;
		}
	});

	test("CustomDatabaseStorage creates working SQLite database", async () => {
		storage = new CustomDatabaseStorage(createFactory());

		const db = await storage.get("main");
		expect(db).toBeDefined();

		// Open the database with version 1
		await db.open(1);

		// Verify it has the expected Database methods
		expect(db.all).toBeInstanceOf(Function);
		expect(db.get).toBeInstanceOf(Function);
		expect(db.exec).toBeInstanceOf(Function);
		expect(db.insert).toBeInstanceOf(Function);
		expect(db.update).toBeInstanceOf(Function);
		expect(db.delete).toBeInstanceOf(Function);
	});

	test("can execute real SQL operations", async () => {
		storage = new CustomDatabaseStorage(createFactory());

		const db = await storage.get("main");
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
		storage = new CustomDatabaseStorage(createFactory());

		const db1 = await storage.get("main");
		await db1.open(1);

		// Second get returns same instance
		const db2 = await storage.get("main");
		expect(db2).toBe(db1);
	});

	test("close() properly closes SQLite connection", async () => {
		storage = new CustomDatabaseStorage(createFactory());

		const db = await storage.get("main");
		await db.open(1);

		// Create a table to verify db is working
		await db.exec`CREATE TABLE test (id INTEGER)`;

		// Close should not throw
		await storage.close("main");
	});

	test("upgradeneeded event fires on first open", async () => {
		storage = new CustomDatabaseStorage(createFactory());

		const db = await storage.get("main");

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
		storage = new CustomDatabaseStorage(createFactory());

		const db = await storage.get("main");

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
		const result = await db.query<{name: string}>`
			SELECT name FROM sqlite_master WHERE type='table' AND name='users'
		`;
		expect(result).toHaveLength(1);
	});

	test("insert with RETURNING clause", async () => {
		storage = new CustomDatabaseStorage(createFactory());

		const db = await storage.get("main");
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
		storage = new CustomDatabaseStorage(createFactory());

		const db = await storage.get("main");
		await db.open(1);

		await db.exec`CREATE TABLE items (id INTEGER PRIMARY KEY)`;
		await db.exec`INSERT INTO items (id) VALUES (1), (2), (3)`;

		const count = await db.val<number>`SELECT COUNT(*) FROM items`;
		expect(count).toBe(3);
	});
});
