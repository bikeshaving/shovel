import {test, expect, describe} from "bun:test";
import {z} from "zod";
import {table, primary, references} from "./table.js";
import {parseTemplate} from "./query.js";
import {where, set, on} from "./fragments.js";

// Test tables (Uppercase plural convention)
const Users = table("users", {
	id: primary(z.string().uuid()),
	email: z.string().email(),
	name: z.string(),
	role: z.enum(["user", "admin"]).default("user"),
	createdAt: z.date(),
});

const Posts = table("posts", {
	id: primary(z.string().uuid()),
	authorId: references(z.string().uuid(), Users, {as: "author"}),
	title: z.string(),
	published: z.boolean().default(false),
	viewCount: z.number().int().default(0),
});

describe("where()", () => {
	test("simple equality", () => {
		const fragment = where(Posts, {published: true});
		expect(fragment.sql).toBe("published = ?");
		expect(fragment.params).toEqual([true]);
	});

	test("multiple conditions (AND-joined)", () => {
		const fragment = where(Posts, {published: true, title: "Hello"});
		expect(fragment.sql).toBe("published = ? AND title = ?");
		expect(fragment.params).toEqual([true, "Hello"]);
	});

	test("camelCase to snake_case conversion", () => {
		const fragment = where(Posts, {viewCount: 100});
		expect(fragment.sql).toBe("view_count = ?");
		expect(fragment.params).toEqual([100]);
	});

	test("$eq operator", () => {
		const fragment = where(Posts, {published: {$eq: true}});
		expect(fragment.sql).toBe("published = ?");
		expect(fragment.params).toEqual([true]);
	});

	test("$neq operator", () => {
		const fragment = where(Users, {role: {$neq: "admin"}});
		expect(fragment.sql).toBe("role != ?");
		expect(fragment.params).toEqual(["admin"]);
	});

	test("$lt operator", () => {
		const fragment = where(Posts, {viewCount: {$lt: 100}});
		expect(fragment.sql).toBe("view_count < ?");
		expect(fragment.params).toEqual([100]);
	});

	test("$gt operator", () => {
		const fragment = where(Posts, {viewCount: {$gt: 50}});
		expect(fragment.sql).toBe("view_count > ?");
		expect(fragment.params).toEqual([50]);
	});

	test("$lte operator", () => {
		const fragment = where(Posts, {viewCount: {$lte: 100}});
		expect(fragment.sql).toBe("view_count <= ?");
		expect(fragment.params).toEqual([100]);
	});

	test("$gte operator", () => {
		const fragment = where(Posts, {viewCount: {$gte: 50}});
		expect(fragment.sql).toBe("view_count >= ?");
		expect(fragment.params).toEqual([50]);
	});

	test("$like operator", () => {
		const fragment = where(Posts, {title: {$like: "%hello%"}});
		expect(fragment.sql).toBe("title LIKE ?");
		expect(fragment.params).toEqual(["%hello%"]);
	});

	test("$in operator", () => {
		const fragment = where(Users, {role: {$in: ["user", "admin"]}});
		expect(fragment.sql).toBe("role IN (?, ?)");
		expect(fragment.params).toEqual(["user", "admin"]);
	});

	test("$isNull operator (true)", () => {
		const fragment = where(Posts, {title: {$isNull: true}});
		expect(fragment.sql).toBe("title IS NULL");
		expect(fragment.params).toEqual([]);
	});

	test("$isNull operator (false)", () => {
		const fragment = where(Posts, {title: {$isNull: false}});
		expect(fragment.sql).toBe("title IS NOT NULL");
		expect(fragment.params).toEqual([]);
	});

	test("multiple operators on same field", () => {
		const fragment = where(Posts, {viewCount: {$gte: 10, $lte: 100}});
		expect(fragment.sql).toBe("view_count >= ? AND view_count <= ?");
		expect(fragment.params).toEqual([10, 100]);
	});

	test("empty conditions returns 1 = 1", () => {
		const fragment = where(Posts, {});
		expect(fragment.sql).toBe("1 = 1");
		expect(fragment.params).toEqual([]);
	});

	test("skips undefined values", () => {
		const fragment = where(Posts, {published: true, title: undefined});
		expect(fragment.sql).toBe("published = ?");
		expect(fragment.params).toEqual([true]);
	});
});

describe("set()", () => {
	test("single field", () => {
		const fragment = set(Posts, {title: "New Title"});
		expect(fragment.sql).toBe("title = ?");
		expect(fragment.params).toEqual(["New Title"]);
	});

	test("multiple fields", () => {
		const fragment = set(Posts, {title: "New Title", published: true});
		expect(fragment.sql).toBe("title = ?, published = ?");
		expect(fragment.params).toEqual(["New Title", true]);
	});

	test("camelCase to snake_case conversion", () => {
		const fragment = set(Posts, {viewCount: 42});
		expect(fragment.sql).toBe("view_count = ?");
		expect(fragment.params).toEqual([42]);
	});

	test("skips undefined values", () => {
		const fragment = set(Posts, {title: "New", published: undefined});
		expect(fragment.sql).toBe("title = ?");
		expect(fragment.params).toEqual(["New"]);
	});

	test("throws on empty object", () => {
		expect(() => set(Posts, {})).toThrow("set() requires at least one field");
	});

	test("throws when all values undefined", () => {
		expect(() => set(Posts, {title: undefined})).toThrow(
			"set() requires at least one non-undefined field",
		);
	});
});

describe("on()", () => {
	test("generates FK equality", () => {
		const fragment = on(Posts, "authorId");
		expect(fragment.sql).toBe("users.id = posts.author_id");
		expect(fragment.params).toEqual([]);
	});

	test("throws for non-FK field", () => {
		expect(() => on(Posts, "title")).toThrow(
			'Field "title" is not a foreign key reference in table "posts"',
		);
	});
});

describe("fragment interpolation in parseTemplate", () => {
	test("where fragment in template", () => {
		const fragment = where(Posts, {published: true});
		const strings = ["WHERE ", ""] as unknown as TemplateStringsArray;
		const {sql, params} = parseTemplate(strings, [fragment], "sqlite");

		expect(sql).toBe("WHERE published = ?");
		expect(params).toEqual([true]);
	});

	test("multiple fragments in template", () => {
		const whereFragment = where(Posts, {published: true});
		const setFragment = set(Posts, {title: "Updated"});
		const strings = [
			"UPDATE posts SET ",
			" WHERE ",
			"",
		] as unknown as TemplateStringsArray;
		const {sql, params} = parseTemplate(
			strings,
			[setFragment, whereFragment],
			"sqlite",
		);

		expect(sql).toBe("UPDATE posts SET title = ? WHERE published = ?");
		expect(params).toEqual(["Updated", true]);
	});

	test("fragment with regular values", () => {
		const fragment = where(Posts, {published: true});
		const strings = [
			"SELECT * FROM posts WHERE ",
			" AND id = ",
			"",
		] as unknown as TemplateStringsArray;
		const {sql, params} = parseTemplate(
			strings,
			[fragment, "post-123"],
			"sqlite",
		);

		expect(sql).toBe("SELECT * FROM posts WHERE published = ? AND id = ?");
		expect(params).toEqual([true, "post-123"]);
	});

	test("postgresql placeholders", () => {
		const fragment = where(Posts, {published: true, title: "Hello"});
		const strings = [
			"SELECT * FROM posts WHERE ",
			" AND id = ",
			"",
		] as unknown as TemplateStringsArray;
		const {sql, params} = parseTemplate(
			strings,
			[fragment, "post-123"],
			"postgresql",
		);

		expect(sql).toBe(
			"SELECT * FROM posts WHERE published = $1 AND title = $2 AND id = $3",
		);
		expect(params).toEqual([true, "Hello", "post-123"]);
	});
});
