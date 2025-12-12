import {test, expect, describe} from "bun:test";
import {z} from "zod";
import {collection, primary, unique, references} from "@b9g/database";
import {
	introspectCollection,
	introspectSchema,
	getDisplayName,
	getPluralDisplayName,
	isCollection,
} from "../src/core/introspection.js";

// ============================================================================
// Test Schema Definitions using @b9g/database collections
// ============================================================================

const users = collection("users", {
	id: z.number().pipe(primary()),
	email: z.string().email().pipe(unique()),
	name: z.string().optional(),
	role: z.enum(["admin", "user", "guest"]).default("user"),
	createdAt: z.date(),
});

const posts = collection("posts", {
	id: z.number().pipe(primary()),
	title: z.string(),
	content: z.string().optional(),
	authorId: z.number().pipe(references(users, "id", "author")),
	published: z.boolean().default(false),
	viewCount: z.number().default(0),
});

const tags = collection("tags", {
	id: z.number().pipe(primary()),
	name: z.string(),
});

const files = collection("files", {
	id: z.number().pipe(primary()),
	name: z.string(),
	size: z.number().optional(),
});

const testSchema = {users, posts, tags, files};

// ============================================================================
// isCollection Tests
// ============================================================================

describe("isCollection", () => {
	test("returns true for @b9g/database collections", () => {
		expect(isCollection(users)).toBe(true);
		expect(isCollection(posts)).toBe(true);
	});

	test("returns false for non-collections", () => {
		expect(isCollection({})).toBe(false);
		expect(isCollection(null)).toBe(false);
		expect(isCollection(undefined)).toBe(false);
		expect(isCollection("users")).toBe(false);
		expect(isCollection(123)).toBe(false);
	});
});

// ============================================================================
// introspectCollection Tests
// ============================================================================

describe("introspectCollection", () => {
	test("extracts collection name", () => {
		const metadata = introspectCollection(users);
		expect(metadata.name).toBe("users");
	});

	// TODO: Fix collection.fields() to properly extract types from Zod schemas
	test.skip("extracts columns with correct types", () => {
		const metadata = introspectCollection(users);

		const idCol = metadata.columns.find((c) => c.name === "id");
		expect(idCol).toBeDefined();
		expect(idCol?.dataType).toBe("number");
		expect(idCol?.isPrimaryKey).toBe(true);

		const emailCol = metadata.columns.find((c) => c.name === "email");
		expect(emailCol).toBeDefined();
		expect(emailCol?.dataType).toBe("string");
		expect(emailCol?.notNull).toBe(true);

		const nameCol = metadata.columns.find((c) => c.name === "name");
		expect(nameCol).toBeDefined();
		expect(nameCol?.dataType).toBe("string");
		expect(nameCol?.notNull).toBe(false);
	});

	// TODO: Fix collection.fields() to extract enum values
	test.skip("extracts enum values", () => {
		const metadata = introspectCollection(users);

		const roleCol = metadata.columns.find((c) => c.name === "role");
		expect(roleCol).toBeDefined();
		expect(roleCol?.enumValues).toEqual(["admin", "user", "guest"]);
	});

	// TODO: Fix collection.fields() to extract defaults
	test.skip("extracts hasDefault correctly", () => {
		const metadata = introspectCollection(users);

		const roleCol = metadata.columns.find((c) => c.name === "role");
		expect(roleCol?.hasDefault).toBe(true);

		const emailCol = metadata.columns.find((c) => c.name === "email");
		expect(emailCol?.hasDefault).toBe(false);
	});

	// TODO: Fix collection.primaryKey() to detect primary keys through .pipe()
	test.skip("identifies primary key", () => {
		const metadata = introspectCollection(users);
		expect(metadata.primaryKey).toEqual(["id"]);
	});

	// TODO: Fix collection.references() to detect references through .pipe()
	test.skip("extracts foreign keys", () => {
		const metadata = introspectCollection(posts);

		expect(metadata.foreignKeys).toHaveLength(1);
		expect(metadata.foreignKeys[0]).toEqual({
			columns: ["authorId"],
			foreignTable: "users",
			foreignColumns: ["id"],
		});
	});
});

// ============================================================================
// introspectSchema Tests
// ============================================================================

describe("introspectSchema", () => {
	test("extracts all collections from schema", () => {
		const tables = introspectSchema(testSchema);

		expect(tables.size).toBe(4);
		expect(tables.has("users")).toBe(true);
		expect(tables.has("posts")).toBe(true);
		expect(tables.has("tags")).toBe(true);
		expect(tables.has("files")).toBe(true);
	});

	test("ignores non-collection exports", () => {
		const schemaWithExtras = {
			...testSchema,
			someHelper: () => {},
			CONSTANT: "value",
			UsersType: {} as any,
		};

		const tables = introspectSchema(schemaWithExtras);
		expect(tables.size).toBe(4); // Only the 4 actual collections
	});

	test("returns metadata accessible by table name", () => {
		const tables = introspectSchema(testSchema);

		const usersMetadata = tables.get("users");
		expect(usersMetadata).toBeDefined();
		expect(usersMetadata?.columns.length).toBeGreaterThan(0);
	});
});

// ============================================================================
// Display Name Tests
// ============================================================================

describe("getDisplayName", () => {
	test("converts snake_case to Title Case", () => {
		expect(getDisplayName("users")).toBe("Users");
		expect(getDisplayName("post_tags")).toBe("Post Tags");
		expect(getDisplayName("user_profile_settings")).toBe(
			"User Profile Settings",
		);
	});

	test("handles single word names", () => {
		expect(getDisplayName("posts")).toBe("Posts");
	});
});

describe("getPluralDisplayName", () => {
	test("pluralizes regular nouns", () => {
		expect(getPluralDisplayName("user")).toBe("Users");
		expect(getPluralDisplayName("post")).toBe("Posts");
	});

	test("handles words ending in y", () => {
		expect(getPluralDisplayName("category")).toBe("Categories");
		expect(getPluralDisplayName("entry")).toBe("Entries");
	});

	test("handles words ending in s, x, ch, sh", () => {
		expect(getPluralDisplayName("status")).toBe("Statuses");
		expect(getPluralDisplayName("box")).toBe("Boxes");
		expect(getPluralDisplayName("match")).toBe("Matches");
		expect(getPluralDisplayName("wish")).toBe("Wishes");
	});

	test("handles snake_case names", () => {
		expect(getPluralDisplayName("post_tag")).toBe("Post Tags");
	});
});
