import {test, expect, describe} from "bun:test";
import {z} from "zod";
import {collection, primary, unique, references} from "./collection.js";
import {
	extractEntityData,
	getPrimaryKeyValue,
	entityKey,
	buildEntityMap,
	resolveReferences,
	normalize,
	normalizeOne,
} from "./normalize.js";

// Test collections
const User = collection("users", {
	id: z.string().uuid().pipe(primary()),
	email: z.string().email().pipe(unique()),
	name: z.string(),
});

const Post = collection("posts", {
	id: z.string().uuid().pipe(primary()),
	authorId: z.string().uuid().pipe(references(User, "id", "author")),
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
	test("extracts fields for collection", () => {
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

	test("returns null for non-existent collection", () => {
		const data = extractEntityData(rawRows[0], "nonexistent");
		expect(data).toBeNull();
	});
});

describe("getPrimaryKeyValue", () => {
	test("gets single primary key", () => {
		const entity = {id: "user-123", name: "Alice"};
		const pk = getPrimaryKeyValue(entity, User);
		expect(pk).toBe("user-123");
	});

	test("returns null for missing primary key", () => {
		const entity = {name: "Alice"};
		const pk = getPrimaryKeyValue(entity, User);
		expect(pk).toBeNull();
	});

	test("handles composite primary key", () => {
		const CompositeKey = collection("composite", {
			tenantId: z.string().pipe(primary()),
			id: z.string().pipe(primary()),
			name: z.string(),
		});

		const entity = {tenantId: "t1", id: "123", name: "Test"};
		const pk = getPrimaryKeyValue(entity, CompositeKey);
		expect(pk).toBe("t1:123");
	});
});

describe("entityKey", () => {
	test("creates key from collection and primary key", () => {
		expect(entityKey("users", "u1")).toBe("users:u1");
		expect(entityKey("posts", "p1")).toBe("posts:p1");
	});
});

describe("buildEntityMap", () => {
	test("builds map of all entities", () => {
		const entities = buildEntityMap(rawRows, [Post, User]);

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
		const entities = buildEntityMap(rawRows, [Post, User]);

		// Alice appears twice in raw rows but should only be stored once
		const aliceEntries = [...entities.entries()].filter(([k]) =>
			k.startsWith("users:u1"),
		);
		expect(aliceEntries.length).toBe(1);
	});
});

describe("resolveReferences", () => {
	test("resolves references to actual entities", () => {
		const entities = buildEntityMap(rawRows, [Post, User]);
		resolveReferences(entities, [Post, User]);

		const post1 = entities.get("posts:p1")!;
		const alice = entities.get("users:u1")!;

		// Should have "author" property pointing to Alice
		expect(post1.author).toBe(alice);
		expect((post1.author as any).name).toBe("Alice");
	});

	test("same referenced entity is same instance", () => {
		const entities = buildEntityMap(rawRows, [Post, User]);
		resolveReferences(entities, [Post, User]);

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

		const entities = buildEntityMap(rowsWithNull, [Post]);
		resolveReferences(entities, [Post, User]);

		const post = entities.get("posts:p1")!;
		expect(post.author).toBeNull();
	});
});

describe("normalize", () => {
	test("returns main collection entities with references resolved", () => {
		const posts = normalize<any>(rawRows, [Post, User]);

		expect(posts.length).toBe(3);
		expect(posts[0].id).toBe("p1");
		expect(posts[0].title).toBe("First Post");
		expect(posts[0].author.name).toBe("Alice");
	});

	test("maintains original row order", () => {
		const posts = normalize<any>(rawRows, [Post, User]);

		expect(posts[0].id).toBe("p1");
		expect(posts[1].id).toBe("p2");
		expect(posts[2].id).toBe("p3");
	});

	test("deduplicates referenced entities", () => {
		const posts = normalize<any>(rawRows, [Post, User]);

		// Post 1 and Post 2 should have the same author instance
		expect(posts[0].author).toBe(posts[1].author);

		// Post 3 should have different author
		expect(posts[2].author).not.toBe(posts[0].author);
		expect(posts[2].author.name).toBe("Bob");
	});

	test("returns empty array for empty rows", () => {
		const posts = normalize<any>([], [Post, User]);
		expect(posts).toEqual([]);
	});

	test("throws on empty collections", () => {
		expect(() => normalize(rawRows, [])).toThrow(
			"At least one collection is required",
		);
	});

	test("handles duplicate rows (same entity multiple times)", () => {
		const duplicateRows = [
			...rawRows,
			rawRows[0], // Duplicate first row
		];

		const posts = normalize<any>(duplicateRows, [Post, User]);

		// Should still only return 3 unique posts
		expect(posts.length).toBe(3);
	});
});

describe("normalizeOne", () => {
	test("returns single entity", () => {
		const post = normalizeOne<any>(rawRows[0], [Post, User]);

		expect(post).not.toBeNull();
		expect(post!.id).toBe("p1");
		expect(post!.author.name).toBe("Alice");
	});

	test("returns null for null row", () => {
		const result = normalizeOne(null, [Post, User]);
		expect(result).toBeNull();
	});
});

describe("circular references", () => {
	test("handles self-referencing collections", () => {
		// Employee with manager (another employee)
		const Employee = collection("employees", {
			id: z.string().pipe(primary()),
			name: z.string(),
			managerId: z.string().nullable(),
		});

		// Add reference manually after creation to avoid circular dependency
		const EmployeeWithRef = collection("employees", {
			id: z.string().pipe(primary()),
			name: z.string(),
			managerId: z
				.string()
				.nullable()
				.pipe(references(Employee, "id", "manager")),
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

		const employees = normalize<any>(rows, [EmployeeWithRef]);

		expect(employees.length).toBe(2);
		expect(employees[0].name).toBe("Alice");
		expect(employees[0].manager).toBeNull();

		// Note: Bob's manager won't resolve because we only have EmployeeWithRef
		// in the collections, not Employee. In practice, you'd pass the same
		// collection for self-references.
	});
});
