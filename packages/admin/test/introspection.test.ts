import {test, expect, describe} from "bun:test";
import {z} from "zod";
import {table, primary, unique, references} from "@b9g/database";
import {
	introspectTable,
	introspectSchema,
	getDisplayName,
	getPluralDisplayName,
	isTable,
} from "../src/core/introspection.js";

// ============================================================================
// Test Schema Definitions using @b9g/database tables
// ============================================================================

const users = table("users", {
	id: primary(z.number()),
	email: unique(z.string().email()),
	name: z.string().optional(),
	role: z.enum(["admin", "user", "guest"]).default("user"),
	createdAt: z.date(),
});

const posts = table("posts", {
	id: primary(z.number()),
	title: z.string(),
	content: z.string().optional(),
	authorId: references(z.number(), users, {as: "author"}),
	published: z.boolean().default(false),
	viewCount: z.number().default(0),
});

const tags = table("tags", {
	id: primary(z.number()),
	name: z.string(),
});

const files = table("files", {
	id: primary(z.number()),
	name: z.string(),
	size: z.number().optional(),
});

const testSchema = {users, posts, tags, files};

// ============================================================================
// isTable Tests
// ============================================================================

describe("isTable", () => {
	test("returns true for @b9g/database tables", () => {
		expect(isTable(users)).toBe(true);
		expect(isTable(posts)).toBe(true);
	});

	test("returns false for non-tables", () => {
		expect(isTable({})).toBe(false);
		expect(isTable(null)).toBe(false);
		expect(isTable(undefined)).toBe(false);
		expect(isTable("users")).toBe(false);
		expect(isTable(123)).toBe(false);
	});
});

// ============================================================================
// introspectTable Tests
// ============================================================================

describe("introspectTable", () => {
	test("extracts table name", () => {
		const metadata = introspectTable(users);
		expect(metadata.name).toBe("users");
	});

	test("extracts columns with correct types", () => {
		const metadata = introspectTable(users);

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

	test("extracts enum values", () => {
		const metadata = introspectTable(users);

		const roleCol = metadata.columns.find((c) => c.name === "role");
		expect(roleCol).toBeDefined();
		expect(roleCol?.enumValues).toEqual(["admin", "user", "guest"]);
	});

	test("extracts hasDefault correctly", () => {
		const metadata = introspectTable(users);

		const roleCol = metadata.columns.find((c) => c.name === "role");
		expect(roleCol?.hasDefault).toBe(true);

		const emailCol = metadata.columns.find((c) => c.name === "email");
		expect(emailCol?.hasDefault).toBe(false);
	});

	test("identifies primary key", () => {
		const metadata = introspectTable(users);
		expect(metadata.primaryKey).toEqual(["id"]);
	});

	test("extracts foreign keys", () => {
		const metadata = introspectTable(posts);

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
	test("extracts all tables from schema", () => {
		const tables = introspectSchema(testSchema);

		expect(tables.size).toBe(4);
		expect(tables.has("users")).toBe(true);
		expect(tables.has("posts")).toBe(true);
		expect(tables.has("tags")).toBe(true);
		expect(tables.has("files")).toBe(true);
	});

	test("ignores non-table exports", () => {
		const schemaWithExtras = {
			...testSchema,
			someHelper: () => {},
			CONSTANT: "value",
			UsersType: {} as any,
		};

		const tables = introspectSchema(schemaWithExtras);
		expect(tables.size).toBe(4); // Only the 4 actual tables
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
