import {test, expect, describe, beforeEach, mock} from "bun:test";
import {z} from "zod";
import {table, primary, unique, references} from "./table.js";
import {Database, createDatabase, type DatabaseDriver} from "./database.js";

// Test UUIDs (RFC 4122 compliant - version 4, variant 1)
const USER_ID = "11111111-1111-4111-a111-111111111111";
const USER_ID_2 = "22222222-2222-4222-a222-222222222222";
const POST_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const POST_ID_2 = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";

// Test tables
const users = table("users", {
	id: primary(z.string().uuid()),
	email: unique(z.string().email()),
	name: z.string(),
});

const posts = table("posts", {
	id: primary(z.string().uuid()),
	authorId: references(z.string().uuid(), users, {as: "author"}),
	title: z.string(),
	body: z.string(),
	published: z.boolean().default(false),
});

// Mock driver factory
function createMockDriver(): DatabaseDriver {
	return {
		all: mock(async () => []) as DatabaseDriver["all"],
		get: mock(async () => null) as DatabaseDriver["get"],
		run: mock(async () => 1) as DatabaseDriver["run"],
		val: mock(async () => 0) as DatabaseDriver["val"],
	};
}

describe("Database", () => {
	let driver: DatabaseDriver;
	let db: Database;

	beforeEach(() => {
		driver = createMockDriver();
		db = new Database(driver);
	});

	describe("all()", () => {
		test("generates correct SQL and normalizes results", async () => {
			(driver.all as any).mockImplementation(async () => [
				{
					"posts.id": POST_ID,
					"posts.authorId": USER_ID,
					"posts.title": "Test Post",
					"posts.body": "Content",
					"posts.published": true,
					"users.id": USER_ID,
					"users.email": "alice@example.com",
					"users.name": "Alice",
				},
			]);

			const results = await db.all(posts, users)`
        JOIN "users" ON "users"."id" = "posts"."authorId"
        WHERE published = ${true}
      `;

			expect(results.length).toBe(1);
			expect(results[0].title).toBe("Test Post");
			expect((results[0] as any).author.name).toBe("Alice");

			// Check SQL was called correctly
			const [sql, params] = (driver.all as any).mock.calls[0];
			expect(sql).toContain('SELECT "posts"."id" AS "posts.id"');
			expect(sql).toContain('FROM "posts"');
			expect(sql).toContain("WHERE published = ?");
			expect(params).toEqual([true]);
		});

		test("returns empty array for no results", async () => {
			(driver.all as any).mockImplementation(async () => []);

			const results = await db.all(posts)`WHERE id = ${"nonexistent"}`;

			expect(results).toEqual([]);
		});
	});

	describe("one()", () => {
		test("returns single entity", async () => {
			(driver.get as any).mockImplementation(async () => ({
				"posts.id": POST_ID,
				"posts.authorId": USER_ID,
				"posts.title": "Test Post",
				"posts.body": "Content",
				"posts.published": true,
			}));

			const post = await db.one(posts)`WHERE "posts"."id" = ${POST_ID}`;

			expect(post).not.toBeNull();
			expect(post!.title).toBe("Test Post");
		});

		test("returns null for no match", async () => {
			(driver.get as any).mockImplementation(async () => null);

			const post = await db.one(posts)`WHERE "posts"."id" = ${"nonexistent"}`;

			expect(post).toBeNull();
		});
	});

	describe("insert()", () => {
		test("inserts and returns entity", async () => {
			const user = await db.insert(users, {
				id: USER_ID,
				email: "alice@example.com",
				name: "Alice",
			});

			expect(user.id).toBe(USER_ID);
			expect(user.email).toBe("alice@example.com");

			const [sql, params] = (driver.run as any).mock.calls[0];
			expect(sql).toContain('INSERT INTO "users"');
			expect(sql).toContain('"id", "email", "name"');
			expect(sql).toContain("VALUES (?, ?, ?)");
			expect(params).toEqual([USER_ID, "alice@example.com", "Alice"]);
		});

		test("validates through Zod schema", async () => {
			await expect(
				db.insert(users, {
					id: USER_ID,
					email: "not-an-email", // Invalid email
					name: "Alice",
				}),
			).rejects.toThrow();
		});

		test("applies defaults", async () => {
			const post = await db.insert(posts, {
				id: POST_ID,
				authorId: USER_ID,
				title: "Test",
				body: "Content",
				// published not provided - should use default
			});

			expect(post.published).toBe(false);
		});
	});

	describe("update()", () => {
		test("updates by primary key", async () => {
			(driver.get as any).mockImplementation(async () => ({
				id: USER_ID,
				email: "alice@example.com",
				name: "Alice Updated",
			}));

			const user = await db.update(users, USER_ID, {name: "Alice Updated"});

			expect(user).not.toBeNull();
			expect(user!.name).toBe("Alice Updated");

			const [sql, params] = (driver.run as any).mock.calls[0];
			expect(sql).toContain('UPDATE "users"');
			expect(sql).toContain('SET "name" = ?');
			expect(sql).toContain('WHERE "id" = ?');
			expect(params).toEqual(["Alice Updated", USER_ID]);
		});

		test("throws on no fields to update", async () => {
			await expect(db.update(users, USER_ID, {})).rejects.toThrow(
				"No fields to update",
			);
		});

		test("returns null if entity not found after update", async () => {
			(driver.get as any).mockImplementation(async () => null);

			const user = await db.update(users, "nonexistent", {name: "Test"});

			expect(user).toBeNull();
		});
	});

	describe("delete()", () => {
		test("deletes by primary key", async () => {
			(driver.run as any).mockImplementation(async () => 1);

			const deleted = await db.delete(users, USER_ID);

			expect(deleted).toBe(true);

			const [sql, params] = (driver.run as any).mock.calls[0];
			expect(sql).toContain('DELETE FROM "users"');
			expect(sql).toContain('WHERE "id" = ?');
			expect(params).toEqual([USER_ID]);
		});

		test("returns false if nothing deleted", async () => {
			(driver.run as any).mockImplementation(async () => 0);

			const deleted = await db.delete(users, "nonexistent");

			expect(deleted).toBe(false);
		});
	});

	describe("query()", () => {
		test("executes raw query with params", async () => {
			(driver.all as any).mockImplementation(async () => [{count: 5}]);

			const results = await db.query<{count: number}>`
        SELECT COUNT(*) as count FROM posts WHERE author_id = ${USER_ID}
      `;

			expect(results[0].count).toBe(5);

			const [sql, params] = (driver.all as any).mock.calls[0];
			expect(sql).toBe(
				"SELECT COUNT(*) as count FROM posts WHERE author_id = ?",
			);
			expect(params).toEqual([USER_ID]);
		});
	});

	describe("exec()", () => {
		test("executes statement", async () => {
			(driver.run as any).mockImplementation(async () => 0);

			await db.exec`CREATE TABLE IF NOT EXISTS test (id TEXT PRIMARY KEY)`;

			const [sql] = (driver.run as any).mock.calls[0];
			expect(sql).toContain("CREATE TABLE");
		});
	});

	describe("val()", () => {
		test("returns single value", async () => {
			(driver.val as any).mockImplementation(async () => 42);

			const count = await db.val<number>`SELECT COUNT(*) FROM users`;

			expect(count).toBe(42);
		});
	});
});

describe("PostgreSQL dialect", () => {
	test("uses numbered placeholders", async () => {
		const driver = createMockDriver();
		const db = new Database(driver, {dialect: "postgresql"});

		await db.query`SELECT * FROM users WHERE id = ${USER_ID} AND active = ${true}`;

		const [sql] = (driver.all as any).mock.calls[0];
		expect(sql).toContain("$1");
		expect(sql).toContain("$2");
		expect(sql).not.toContain("?");
	});
});

describe("MySQL dialect", () => {
	test("uses backtick quoting", async () => {
		const driver = createMockDriver();
		const db = new Database(driver, {dialect: "mysql"});

		await db.insert(users, {
			id: USER_ID,
			email: "test@example.com",
			name: "Test",
		});

		const [sql] = (driver.run as any).mock.calls[0];
		expect(sql).toContain("INSERT INTO `users`");
		expect(sql).toContain("`id`, `email`, `name`");
	});
});

describe("createDatabase()", () => {
	test("creates Database instance", () => {
		const driver = createMockDriver();
		const db = createDatabase(driver);

		expect(db).toBeInstanceOf(Database);
	});

	test("accepts options", () => {
		const driver = createMockDriver();
		const db = createDatabase(driver, {dialect: "postgresql"});

		expect(db).toBeInstanceOf(Database);
	});
});

describe("transaction()", () => {
	test("commits on success", async () => {
		const driver = createMockDriver();
		const db = new Database(driver);

		const result = await db.transaction(async (tx) => {
			await tx.insert(users, {
				id: USER_ID,
				email: "alice@example.com",
				name: "Alice",
			});
			return "done";
		});

		expect(result).toBe("done");

		// Check BEGIN was called
		const calls = (driver.run as any).mock.calls;
		expect(calls[0][0]).toBe("BEGIN");

		// Check INSERT was called
		expect(calls[1][0]).toContain("INSERT INTO");

		// Check COMMIT was called
		expect(calls[2][0]).toBe("COMMIT");
	});

	test("rollbacks on error", async () => {
		const driver = createMockDriver();
		const db = new Database(driver);

		const error = new Error("Test error");
		await expect(
			db.transaction(async (tx) => {
				await tx.insert(users, {
					id: USER_ID,
					email: "alice@example.com",
					name: "Alice",
				});
				throw error;
			}),
		).rejects.toThrow("Test error");

		// Check BEGIN was called
		const calls = (driver.run as any).mock.calls;
		expect(calls[0][0]).toBe("BEGIN");

		// Check INSERT was called
		expect(calls[1][0]).toContain("INSERT INTO");

		// Check ROLLBACK was called (not COMMIT)
		expect(calls[2][0]).toBe("ROLLBACK");
	});

	test("returns value from transaction function", async () => {
		const driver = createMockDriver();
		const db = new Database(driver);

		const result = await db.transaction(async () => {
			return {id: USER_ID, name: "Alice"};
		});

		expect(result).toEqual({id: USER_ID, name: "Alice"});
	});

	test("uses START TRANSACTION for MySQL", async () => {
		const driver = createMockDriver();
		const db = new Database(driver, {dialect: "mysql"});

		await db.transaction(async () => {
			return "done";
		});

		const calls = (driver.run as any).mock.calls;
		expect(calls[0][0]).toBe("START TRANSACTION");
	});

	test("uses driver.beginTransaction() when available", async () => {
		const txDriver = {
			...createMockDriver(),
			commit: mock(async () => {}),
			rollback: mock(async () => {}),
		};
		const driver = {
			...createMockDriver(),
			beginTransaction: mock(async () => txDriver),
		};
		const db = new Database(driver);

		await db.transaction(async (tx) => {
			await tx.insert(users, {
				id: USER_ID,
				email: "alice@example.com",
				name: "Alice",
			});
			return "done";
		});

		// Should use driver's beginTransaction
		expect(driver.beginTransaction).toHaveBeenCalled();

		// INSERT should go through txDriver, not main driver
		expect((txDriver.run as any).mock.calls.length).toBe(1);
		expect((txDriver.run as any).mock.calls[0][0]).toContain("INSERT INTO");

		// Should commit via txDriver
		expect(txDriver.commit).toHaveBeenCalled();
		expect(txDriver.rollback).not.toHaveBeenCalled();

		// Main driver should NOT have BEGIN/COMMIT
		const mainCalls = (driver.run as any).mock.calls;
		expect(mainCalls.some((c: any) => c[0] === "BEGIN")).toBe(false);
	});

	test("uses driver.rollback() on error when beginTransaction available", async () => {
		const txDriver = {
			...createMockDriver(),
			commit: mock(async () => {}),
			rollback: mock(async () => {}),
		};
		const driver = {
			...createMockDriver(),
			beginTransaction: mock(async () => txDriver),
		};
		const db = new Database(driver);

		await expect(
			db.transaction(async () => {
				throw new Error("Test error");
			}),
		).rejects.toThrow("Test error");

		expect(txDriver.rollback).toHaveBeenCalled();
		expect(txDriver.commit).not.toHaveBeenCalled();
	});
});
