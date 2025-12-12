import {test, expect, describe} from "bun:test";
import {z} from "zod";
import {table, primary, unique, references} from "./table.js";
import {
	extractEntityData,
	getPrimaryKeyValue,
	entityKey,
	buildEntityMap,
	resolveReferences,
	normalize,
	normalizeOne,
} from "./normalize.js";

// Test tables (using plain strings - normalization doesn't need UUID validation)
const users = table("users", {
	id: primary(z.string()),
	email: unique(z.string().email()),
	name: z.string(),
});

const posts = table("posts", {
	id: primary(z.string()),
	authorId: references(z.string(), users, {as: "author"}),
	title: z.string(),
	body: z.string(),
});

// Test data - simulating SQL JOIN result
const rawRows = [
	{
		"posts.id": "p1",
		"posts.authorId": "u1",
		"posts.title": "First Post",
		"posts.body": "Content 1",
		"users.id": "u1",
		"users.email": "alice@example.com",
		"users.name": "Alice",
	},
	{
		"posts.id": "p2",
		"posts.authorId": "u1",
		"posts.title": "Second Post",
		"posts.body": "Content 2",
		"users.id": "u1",
		"users.email": "alice@example.com",
		"users.name": "Alice",
	},
	{
		"posts.id": "p3",
		"posts.authorId": "u2",
		"posts.title": "Third Post",
		"posts.body": "Content 3",
		"users.id": "u2",
		"users.email": "bob@example.com",
		"users.name": "Bob",
	},
];

describe("extractEntityData", () => {
	test("extracts fields for table", () => {
		const row = rawRows[0];

		const postData = extractEntityData(row, "posts");
		expect(postData).toEqual({
			id: "p1",
			authorId: "u1",
			title: "First Post",
			body: "Content 1",
		});

		const userData = extractEntityData(row, "users");
		expect(userData).toEqual({
			id: "u1",
			email: "alice@example.com",
			name: "Alice",
		});
	});

	test("returns null for all-null data (LEFT JOIN no match)", () => {
		const row = {
			"posts.id": "p1",
			"posts.authorId": null,
			"posts.title": "Orphan Post",
			"posts.body": "Content",
			"users.id": null,
			"users.email": null,
			"users.name": null,
		};

		const postData = extractEntityData(row, "posts");
		expect(postData).not.toBeNull();
		expect(postData!.id).toBe("p1");

		const userData = extractEntityData(row, "users");
		expect(userData).toBeNull();
	});

	test("returns null for non-existent table", () => {
		const data = extractEntityData(rawRows[0], "nonexistent");
		expect(data).toBeNull();
	});
});

describe("getPrimaryKeyValue", () => {
	test("gets single primary key", () => {
		const entity = {id: "user-123", name: "Alice"};
		const pk = getPrimaryKeyValue(entity, users);
		expect(pk).toBe("user-123");
	});

	test("returns null for missing primary key", () => {
		const entity = {name: "Alice"};
		const pk = getPrimaryKeyValue(entity, users);
		expect(pk).toBeNull();
	});
});

describe("entityKey", () => {
	test("creates key from table and primary key", () => {
		expect(entityKey("users", "u1")).toBe("users:u1");
		expect(entityKey("posts", "p1")).toBe("posts:p1");
	});
});

describe("buildEntityMap", () => {
	test("builds map of all entities", () => {
		const entities = buildEntityMap(rawRows, [posts, users]);

		// Should have 3 posts + 2 users = 5 entities
		expect(entities.size).toBe(5);

		// Check posts
		expect(entities.has("posts:p1")).toBe(true);
		expect(entities.has("posts:p2")).toBe(true);
		expect(entities.has("posts:p3")).toBe(true);

		// Check users (deduplicated)
		expect(entities.has("users:u1")).toBe(true);
		expect(entities.has("users:u2")).toBe(true);
	});

	test("deduplicates entities with same primary key", () => {
		const entities = buildEntityMap(rawRows, [posts, users]);

		// Alice appears twice in raw rows but should only be stored once
		const aliceEntries = [...entities.entries()].filter(([k]) =>
			k.startsWith("users:u1"),
		);
		expect(aliceEntries.length).toBe(1);
	});
});

describe("resolveReferences", () => {
	test("resolves references to actual entities", () => {
		const entities = buildEntityMap(rawRows, [posts, users]);
		resolveReferences(entities, [posts, users]);

		const post1 = entities.get("posts:p1")!;
		const alice = entities.get("users:u1")!;

		// Should have "author" property pointing to Alice
		expect(post1.author).toBe(alice);
		expect((post1.author as any).name).toBe("Alice");
	});

	test("same referenced entity is same instance", () => {
		const entities = buildEntityMap(rawRows, [posts, users]);
		resolveReferences(entities, [posts, users]);

		const post1 = entities.get("posts:p1")!;
		const post2 = entities.get("posts:p2")!;

		// Both posts by Alice should reference the SAME object
		expect(post1.author).toBe(post2.author);
	});

	test("handles null references", () => {
		const rowsWithNull = [
			{
				"posts.id": "p1",
				"posts.authorId": null,
				"posts.title": "Orphan",
				"posts.body": "No author",
			},
		];

		const entities = buildEntityMap(rowsWithNull, [posts]);
		resolveReferences(entities, [posts, users]);

		const post = entities.get("posts:p1")!;
		expect(post.author).toBeNull();
	});
});

describe("normalize", () => {
	test("returns main table entities with references resolved", () => {
		const results = normalize<any>(rawRows, [posts, users]);

		expect(results.length).toBe(3);
		expect(results[0].id).toBe("p1");
		expect(results[0].title).toBe("First Post");
		expect(results[0].author.name).toBe("Alice");
	});

	test("maintains original row order", () => {
		const results = normalize<any>(rawRows, [posts, users]);

		expect(results[0].id).toBe("p1");
		expect(results[1].id).toBe("p2");
		expect(results[2].id).toBe("p3");
	});

	test("deduplicates referenced entities", () => {
		const results = normalize<any>(rawRows, [posts, users]);

		// Post 1 and Post 2 should have the same author instance
		expect(results[0].author).toBe(results[1].author);

		// Post 3 should have different author
		expect(results[2].author).not.toBe(results[0].author);
		expect(results[2].author.name).toBe("Bob");
	});

	test("returns empty array for empty rows", () => {
		const results = normalize<any>([], [posts, users]);
		expect(results).toEqual([]);
	});

	test("throws on empty tables", () => {
		expect(() => normalize(rawRows, [])).toThrow(
			"At least one table is required",
		);
	});

	test("handles duplicate rows (same entity multiple times)", () => {
		const duplicateRows = [
			...rawRows,
			rawRows[0], // Duplicate first row
		];

		const results = normalize<any>(duplicateRows, [posts, users]);

		// Should still only return 3 unique posts
		expect(results.length).toBe(3);
	});
});

describe("normalizeOne", () => {
	test("returns single entity", () => {
		const post = normalizeOne<any>(rawRows[0], [posts, users]);

		expect(post).not.toBeNull();
		expect(post!.id).toBe("p1");
		expect(post!.author.name).toBe("Alice");
	});

	test("returns null for null row", () => {
		const result = normalizeOne(null, [posts, users]);
		expect(result).toBeNull();
	});
});

describe("self-referencing tables", () => {
	test("handles self-referencing tables", () => {
		// Employee with manager (another employee)
		const employees = table("employees", {
			id: primary(z.string()),
			name: z.string(),
			managerId: z.string().nullable(),
		});

		const rows = [
			{
				"employees.id": "e1",
				"employees.name": "Alice",
				"employees.managerId": null,
			},
			{
				"employees.id": "e2",
				"employees.name": "Bob",
				"employees.managerId": "e1",
			},
		];

		const results = normalize<any>(rows, [employees]);

		expect(results.length).toBe(2);
		expect(results[0].name).toBe("Alice");
		expect(results[1].name).toBe("Bob");
	});
});
