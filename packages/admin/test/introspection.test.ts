import {test, expect, describe} from "bun:test";
import {z, table, isTable} from "@b9g/zen";
import {
	getAdminTableInfo,
	getAdminSchemaInfo,
	getDisplayName,
} from "../src/core/introspection.js";

// ============================================================================
// Test Schema Definitions using @b9g/zen tables
// ============================================================================

const users = table("users", {
	id: z.number().db.primary(),
	email: z.string().email().db.unique(),
	name: z.string().optional(),
	role: z.enum(["admin", "user", "guest"]).db.inserted(() => "user"),
	createdAt: z.date(),
});

const posts = table("posts", {
	id: z.number().db.primary(),
	title: z.string(),
	content: z.string().optional(),
	authorId: z.number().db.references(users, "author"),
	published: z.boolean().db.inserted(() => false),
	viewCount: z.number().db.inserted(() => 0),
});

const tags = table("tags", {
	id: z.number().db.primary(),
	name: z.string(),
});

const files = table("files", {
	id: z.number().db.primary(),
	name: z.string(),
	size: z.number().optional(),
});

// Table with db.inserted() defaults (for testing required flag)
const settings = table("settings", {
	id: z.number().db.primary(),
	key: z.string(),
	value: z.string().db.inserted(() => ""),
	enabled: z.boolean().db.inserted(() => true),
});

const testSchema = {users, posts, tags, files, settings};

// ============================================================================
// isTable Tests
// ============================================================================

describe("isTable", () => {
	test("returns true for @b9g/zen tables", () => {
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
// getAdminTableInfo Tests
// ============================================================================

describe("getAdminTableInfo", () => {
	test("extracts table name", () => {
		const info = getAdminTableInfo(users);
		expect(info.name).toBe("users");
	});

	test("extracts columns with correct types", () => {
		const info = getAdminTableInfo(users);

		const idCol = info.columns.find((c) => c.name === "id");
		expect(idCol).toBeDefined();
		expect(idCol?.dataType).toBe("number");
		expect(idCol?.isPrimaryKey).toBe(true);

		const emailCol = info.columns.find((c) => c.name === "email");
		expect(emailCol).toBeDefined();
		expect(emailCol?.dataType).toBe("string");
		expect(emailCol?.required).toBe(true);

		const nameCol = info.columns.find((c) => c.name === "name");
		expect(nameCol).toBeDefined();
		expect(nameCol?.dataType).toBe("string");
		expect(nameCol?.required).toBe(false); // optional
	});

	test("extracts enum values", () => {
		const info = getAdminTableInfo(users);

		const roleCol = info.columns.find((c) => c.name === "role");
		expect(roleCol).toBeDefined();
		expect(roleCol?.enumValues).toEqual(["admin", "user", "guest"]);
	});

	test("extracts hasAutoValue correctly", () => {
		const info = getAdminTableInfo(users);

		const roleCol = info.columns.find((c) => c.name === "role");
		expect(roleCol?.hasAutoValue).toBe(true); // has db.inserted()

		const emailCol = info.columns.find((c) => c.name === "email");
		expect(emailCol?.hasAutoValue).toBe(false);
	});

	test("fields with db.inserted() are not required", () => {
		const info = getAdminTableInfo(users);

		const roleCol = info.columns.find((c) => c.name === "role");
		expect(roleCol?.required).toBe(false); // has db.inserted()
	});

	test("fields with db.inserted() defaults are not required", () => {
		const info = getAdminTableInfo(settings);

		const valueCol = info.columns.find((c) => c.name === "value");
		expect(valueCol?.required).toBe(false); // has .db.inserted()

		const enabledCol = info.columns.find((c) => c.name === "enabled");
		expect(enabledCol?.required).toBe(false); // has .db.inserted()

		const keyCol = info.columns.find((c) => c.name === "key");
		expect(keyCol?.required).toBe(true); // no default
	});

	test("identifies primary key", () => {
		const info = getAdminTableInfo(users);
		expect(info.primaryKey).toBe("id");
	});

	test("extracts foreign keys", () => {
		const info = getAdminTableInfo(posts);

		expect(info.foreignKeys).toHaveLength(1);
		expect(info.foreignKeys[0]).toEqual({
			column: "authorId",
			foreignTable: "users",
			foreignColumn: "id",
		});
	});

	test("filters out relation accessors", () => {
		// posts has a reference to users with "author" accessor
		// This should NOT appear in columns
		const info = getAdminTableInfo(posts);

		const authorCol = info.columns.find((c) => c.name === "author");
		expect(authorCol).toBeUndefined();

		// But authorId should exist
		const authorIdCol = info.columns.find((c) => c.name === "authorId");
		expect(authorIdCol).toBeDefined();
	});
});

// ============================================================================
// getAdminSchemaInfo Tests
// ============================================================================

describe("getAdminSchemaInfo", () => {
	test("extracts all tables from schema", () => {
		const tables = getAdminSchemaInfo(testSchema);

		expect(tables.size).toBe(5);
		expect(tables.has("users")).toBe(true);
		expect(tables.has("posts")).toBe(true);
		expect(tables.has("tags")).toBe(true);
		expect(tables.has("files")).toBe(true);
		expect(tables.has("settings")).toBe(true);
	});

	test("ignores non-table exports", () => {
		const schemaWithExtras = {
			...testSchema,
			someHelper: () => {},
			CONSTANT: "value",
			UsersType: {} as any,
		};

		const tables = getAdminSchemaInfo(schemaWithExtras);
		expect(tables.size).toBe(5); // Only the 5 actual tables
	});

	test("returns info accessible by table name", () => {
		const tables = getAdminSchemaInfo(testSchema);

		const usersInfo = tables.get("users");
		expect(usersInfo).toBeDefined();
		expect(usersInfo?.columns.length).toBeGreaterThan(0);
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
