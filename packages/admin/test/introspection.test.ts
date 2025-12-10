import {test, expect, describe} from "bun:test";
import {
	sqliteTable,
	text,
	integer,
	blob,
	real,
	primaryKey,
	foreignKey,
} from "drizzle-orm/sqlite-core";
import {getTableConfig} from "drizzle-orm/sqlite-core";
import {
	introspectTable,
	introspectSchema,
	getDisplayName,
	getPluralDisplayName,
	isTable,
} from "../src/core/introspection.js";

// ============================================================================
// Test Schema Definitions
// ============================================================================

const users = sqliteTable("users", {
	id: integer("id").primaryKey(),
	email: text("email").notNull().unique(),
	name: text("name"),
	role: text("role", {enum: ["admin", "user", "guest"]}).default("user"),
	createdAt: integer("created_at", {mode: "timestamp"}).notNull(),
});

const posts = sqliteTable("posts", {
	id: integer("id").primaryKey(),
	title: text("title").notNull(),
	content: text("content"),
	authorId: integer("author_id")
		.notNull()
		.references(() => users.id),
	published: integer("published", {mode: "boolean"}).default(false),
	viewCount: integer("view_count").default(0),
});

const tags = sqliteTable("tags", {
	id: integer("id").primaryKey(),
	name: text("name").notNull(),
});

const postTags = sqliteTable(
	"post_tags",
	{
		postId: integer("post_id")
			.notNull()
			.references(() => posts.id),
		tagId: integer("tag_id")
			.notNull()
			.references(() => tags.id),
	},
	(t) => [primaryKey({columns: [t.postId, t.tagId]})],
);

const files = sqliteTable("files", {
	id: integer("id").primaryKey(),
	name: text("name").notNull(),
	data: blob("data", {mode: "buffer"}),
	size: real("size"),
});

const testSchema = {users, posts, tags, postTags, files};

// ============================================================================
// isTable Tests
// ============================================================================

describe("isTable", () => {
	test("returns true for Drizzle tables", () => {
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
		const metadata = introspectTable(users, getTableConfig);
		expect(metadata.name).toBe("users");
	});

	test("extracts columns with correct types", () => {
		const metadata = introspectTable(users, getTableConfig);

		const idCol = metadata.columns.find((c) => c.name === "id");
		expect(idCol).toBeDefined();
		expect(idCol?.dataType).toBe("number");
		expect(idCol?.isPrimaryKey).toBe(true);
		expect(idCol?.notNull).toBe(true);

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
		const metadata = introspectTable(users, getTableConfig);

		const roleCol = metadata.columns.find((c) => c.name === "role");
		expect(roleCol).toBeDefined();
		expect(roleCol?.enumValues).toEqual(["admin", "user", "guest"]);
	});

	test("extracts hasDefault correctly", () => {
		const metadata = introspectTable(users, getTableConfig);

		const roleCol = metadata.columns.find((c) => c.name === "role");
		expect(roleCol?.hasDefault).toBe(true);

		const emailCol = metadata.columns.find((c) => c.name === "email");
		expect(emailCol?.hasDefault).toBe(false);
	});

	test("identifies single primary key", () => {
		const metadata = introspectTable(users, getTableConfig);
		expect(metadata.primaryKey).toEqual(["id"]);
	});

	test("identifies composite primary key", () => {
		const metadata = introspectTable(postTags, getTableConfig);
		expect(metadata.primaryKey).toContain("post_id");
		expect(metadata.primaryKey).toContain("tag_id");
		expect(metadata.primaryKey).toHaveLength(2);
	});

	test("extracts foreign keys", () => {
		const metadata = introspectTable(posts, getTableConfig);

		expect(metadata.foreignKeys).toHaveLength(1);
		expect(metadata.foreignKeys[0]).toEqual({
			columns: ["author_id"],
			foreignTable: "users",
			foreignColumns: ["id"],
		});
	});

	test("handles tables with multiple foreign keys", () => {
		const metadata = introspectTable(postTags, getTableConfig);

		expect(metadata.foreignKeys).toHaveLength(2);

		const postFk = metadata.foreignKeys.find((fk) =>
			fk.columns.includes("post_id"),
		);
		expect(postFk).toEqual({
			columns: ["post_id"],
			foreignTable: "posts",
			foreignColumns: ["id"],
		});

		const tagFk = metadata.foreignKeys.find((fk) =>
			fk.columns.includes("tag_id"),
		);
		expect(tagFk).toEqual({
			columns: ["tag_id"],
			foreignTable: "tags",
			foreignColumns: ["id"],
		});
	});

	test("handles blob columns", () => {
		const metadata = introspectTable(files, getTableConfig);

		const dataCol = metadata.columns.find((c) => c.name === "data");
		expect(dataCol).toBeDefined();
		expect(dataCol?.dataType).toBe("blob");
	});

	test("handles real/float columns", () => {
		const metadata = introspectTable(files, getTableConfig);

		const sizeCol = metadata.columns.find((c) => c.name === "size");
		expect(sizeCol).toBeDefined();
		expect(sizeCol?.dataType).toBe("number");
	});
});

// ============================================================================
// introspectSchema Tests
// ============================================================================

describe("introspectSchema", () => {
	test("extracts all tables from schema", () => {
		const tables = introspectSchema(testSchema, getTableConfig);

		expect(tables.size).toBe(5);
		expect(tables.has("users")).toBe(true);
		expect(tables.has("posts")).toBe(true);
		expect(tables.has("tags")).toBe(true);
		expect(tables.has("post_tags")).toBe(true);
		expect(tables.has("files")).toBe(true);
	});

	test("ignores non-table exports", () => {
		const schemaWithExtras = {
			...testSchema,
			someHelper: () => {},
			CONSTANT: "value",
			UsersType: {} as any,
		};

		const tables = introspectSchema(schemaWithExtras, getTableConfig);
		expect(tables.size).toBe(5); // Only the 5 actual tables
	});

	test("returns metadata accessible by table name", () => {
		const tables = introspectSchema(testSchema, getTableConfig);

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
