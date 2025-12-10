import {test, expect, describe, afterEach} from "bun:test";
import {Database} from "bun:sqlite";
import {
	createDatabaseFactory,
	CustomDatabaseStorage,
	type DatabaseConfig,
} from "../src/runtime.js";
import {sqliteTable, text, integer} from "drizzle-orm/sqlite-core";

// Define a test schema
const users = sqliteTable("users", {
	id: integer("id").primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull(),
});

const schema = {users};

describe("Database Integration (bun:sqlite)", () => {
	let dbInstances: Array<{close: () => Promise<void>}> = [];

	afterEach(async () => {
		// Clean up any opened databases
		for (const db of dbInstances) {
			await db.close();
		}
		dbInstances = [];
	});

	test("createDatabaseFactory creates working SQLite database", async () => {
		const factory = createDatabaseFactory();

		const config: DatabaseConfig = {
			dialect: "bun-sqlite",
			driver: {
				module: "bun:sqlite",
				factory: Database,
			},
			url: ":memory:",
			schema,
		};

		const result = await factory("test", config);
		dbInstances.push(result);

		expect(result.instance).toBeDefined();
		expect(result.close).toBeInstanceOf(Function);

		// Verify it's a real Drizzle instance by checking for expected methods
		expect(result.instance.select).toBeInstanceOf(Function);
		expect(result.instance.insert).toBeInstanceOf(Function);
		expect(result.instance.update).toBeInstanceOf(Function);
		expect(result.instance.delete).toBeInstanceOf(Function);
	});

	test("can execute real SQL operations", async () => {
		const factory = createDatabaseFactory();

		const config: DatabaseConfig = {
			dialect: "bun-sqlite",
			driver: {
				module: "bun:sqlite",
				factory: Database,
			},
			url: ":memory:",
			schema,
		};

		const {instance: db, close} = await factory("test", config);
		dbInstances.push({close});

		// Create the table using the underlying client
		(db as any).$client.exec(`
			CREATE TABLE users (
				id INTEGER PRIMARY KEY,
				name TEXT NOT NULL,
				email TEXT NOT NULL
			)
		`);

		// Insert a user using Drizzle
		await (db.insert(users) as any).values({
			id: 1,
			name: "Alice",
			email: "alice@example.com",
		});

		// Query users
		const result = await (db.select() as any).from(users);

		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({
			id: 1,
			name: "Alice",
			email: "alice@example.com",
		});
	});

	test("CustomDatabaseStorage integration with real SQLite", async () => {
		const storage = new CustomDatabaseStorage(createDatabaseFactory(), {
			main: {
				dialect: "bun-sqlite",
				driver: {
					module: "bun:sqlite",
					factory: Database,
				},
				url: ":memory:",
				schema,
			},
		});

		// Open the database
		const db = await storage.open("main");
		expect(db).toBeDefined();

		// Create table and insert data
		(db as any).$client.exec(`
			CREATE TABLE users (
				id INTEGER PRIMARY KEY,
				name TEXT NOT NULL,
				email TEXT NOT NULL
			)
		`);

		await (db.insert(users) as any).values({
			id: 1,
			name: "Bob",
			email: "bob@test.com",
		});

		// Query
		const result = await (db.select() as any).from(users);
		expect(result[0].name).toBe("Bob");

		// Verify caching - same instance returned
		const db2 = await storage.open("main");
		expect(db2).toBe(db);

		// Clean up
		await storage.closeAll();
	});

	test("close() properly closes SQLite connection", async () => {
		const factory = createDatabaseFactory();

		const config: DatabaseConfig = {
			dialect: "bun-sqlite",
			driver: {
				module: "bun:sqlite",
				factory: Database,
			},
			url: ":memory:",
			schema,
		};

		const {instance: db, close} = await factory("test", config);

		// Create a table to verify db is working
		(db as any).$client.exec("CREATE TABLE test (id INTEGER)");

		// Close should not throw
		await close();

		// After close, operations should fail
		expect(() => {
			(db as any).$client.exec("SELECT * FROM test");
		}).toThrow();
	});

	test("schema is passed to Drizzle for relational queries", async () => {
		const factory = createDatabaseFactory();

		const config: DatabaseConfig = {
			dialect: "bun-sqlite",
			driver: {
				module: "bun:sqlite",
				factory: Database,
			},
			url: ":memory:",
			schema,
		};

		const {instance: db, close} = await factory("test", config);
		dbInstances.push({close});

		// When schema is provided, db.query should be populated
		expect(db.query).toBeDefined();
		expect(db.query.users).toBeDefined();
	});

	test("works without schema (no relational queries)", async () => {
		const factory = createDatabaseFactory();

		const config: DatabaseConfig = {
			dialect: "bun-sqlite",
			driver: {
				module: "bun:sqlite",
				factory: Database,
			},
			url: ":memory:",
			// No schema provided
		};

		const {instance: db, close} = await factory("test", config);
		dbInstances.push({close});

		// Should still work for basic queries
		expect(db.select).toBeInstanceOf(Function);

		// Create and query a table directly
		(db as any).$client.exec("CREATE TABLE items (id INTEGER PRIMARY KEY)");
		(db as any).$client.exec("INSERT INTO items (id) VALUES (1)");

		// Raw query should work
		const result = (db as any).$client.query("SELECT * FROM items").all();
		expect(result).toHaveLength(1);
	});
});
