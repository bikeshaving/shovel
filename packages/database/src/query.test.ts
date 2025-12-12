import {test, expect, describe} from "bun:test";
import {z} from "zod";
import {table, primary, unique, references} from "./table.js";
import {
	buildSelectColumns,
	parseTemplate,
	buildQuery,
	createQuery,
	rawQuery,
} from "./query.js";

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

describe("buildSelectColumns", () => {
	test("single table", () => {
		const cols = buildSelectColumns([users], "sqlite");

		expect(cols).toContain('"users"."id" AS "users.id"');
		expect(cols).toContain('"users"."email" AS "users.email"');
		expect(cols).toContain('"users"."name" AS "users.name"');
	});

	test("multiple tables", () => {
		const cols = buildSelectColumns([posts, users], "sqlite");

		// Post columns
		expect(cols).toContain('"posts"."id" AS "posts.id"');
		expect(cols).toContain('"posts"."authorId" AS "posts.authorId"');
		expect(cols).toContain('"posts"."title" AS "posts.title"');

		// User columns
		expect(cols).toContain('"users"."id" AS "users.id"');
		expect(cols).toContain('"users"."name" AS "users.name"');
	});

	test("mysql dialect uses backticks", () => {
		const cols = buildSelectColumns([users], "mysql");

		expect(cols).toContain("`users`.`id` AS `users.id`");
		expect(cols).toContain("`users`.`email` AS `users.email`");
	});
});

describe("parseTemplate", () => {
	test("no parameters", () => {
		const strings = ["WHERE active = true"] as unknown as TemplateStringsArray;
		const result = parseTemplate(strings, [], "sqlite");

		expect(result.sql).toBe("WHERE active = true");
		expect(result.params).toEqual([]);
	});

	test("single parameter - sqlite", () => {
		const strings = ["WHERE id = ", ""] as unknown as TemplateStringsArray;
		const result = parseTemplate(strings, ["user-123"], "sqlite");

		expect(result.sql).toBe("WHERE id = ?");
		expect(result.params).toEqual(["user-123"]);
	});

	test("multiple parameters - sqlite", () => {
		const strings = [
			"WHERE id = ",
			" AND active = ",
			"",
		] as unknown as TemplateStringsArray;
		const result = parseTemplate(strings, ["user-123", true], "sqlite");

		expect(result.sql).toBe("WHERE id = ? AND active = ?");
		expect(result.params).toEqual(["user-123", true]);
	});

	test("postgresql uses numbered placeholders", () => {
		const strings = [
			"WHERE id = ",
			" AND active = ",
			"",
		] as unknown as TemplateStringsArray;
		const result = parseTemplate(strings, ["user-123", true], "postgresql");

		expect(result.sql).toBe("WHERE id = $1 AND active = $2");
		expect(result.params).toEqual(["user-123", true]);
	});

	test("trims whitespace", () => {
		const strings = [
			"  WHERE id = ",
			"  ",
		] as unknown as TemplateStringsArray;
		const result = parseTemplate(strings, ["user-123"], "sqlite");

		expect(result.sql).toBe("WHERE id = ?");
	});
});

describe("buildQuery", () => {
	test("single table with no clauses", () => {
		const sql = buildQuery([users], "", "sqlite");

		expect(sql).toContain("SELECT");
		expect(sql).toContain('"users"."id" AS "users.id"');
		expect(sql).toContain('FROM "users"');
	});

	test("single table with WHERE", () => {
		const sql = buildQuery([users], "WHERE active = ?", "sqlite");

		expect(sql).toContain('FROM "users" WHERE active = ?');
	});

	test("multiple tables with JOIN", () => {
		const sql = buildQuery(
			[posts, users],
			'JOIN "users" ON "users"."id" = "posts"."authorId" WHERE published = ?',
			"sqlite",
		);

		expect(sql).toContain('FROM "posts"');
		expect(sql).toContain(
			'JOIN "users" ON "users"."id" = "posts"."authorId" WHERE published = ?',
		);
		// Should have columns from both tables
		expect(sql).toContain('"posts"."id" AS "posts.id"');
		expect(sql).toContain('"users"."id" AS "users.id"');
	});

	test("throws on empty tables", () => {
		expect(() => buildQuery([], "", "sqlite")).toThrow(
			"At least one table is required",
		);
	});
});

describe("createQuery", () => {
	test("creates tagged template function", () => {
		const query = createQuery([posts, users], "sqlite");
		const {sql, params} = query`
      JOIN "users" ON "users"."id" = "posts"."authorId"
      WHERE published = ${true}
    `;

		expect(sql).toContain('SELECT "posts"."id" AS "posts.id"');
		expect(sql).toContain('FROM "posts"');
		expect(sql).toContain('JOIN "users"');
		expect(sql).toContain("WHERE published = ?");
		expect(params).toEqual([true]);
	});

	test("handles multiple parameters", () => {
		const query = createQuery([posts], "sqlite");
		const userId = "user-123";
		const limit = 10;
		const {sql, params} = query`
      WHERE "authorId" = ${userId}
      ORDER BY "createdAt" DESC
      LIMIT ${limit}
    `;

		expect(sql).toContain("WHERE");
		expect(sql).toContain("LIMIT ?");
		expect(params).toEqual([userId, limit]);
	});
});

describe("rawQuery", () => {
	test("parses raw SQL template", () => {
		const userId = "user-123";
		const {sql, params} = rawQuery`SELECT COUNT(*) FROM posts WHERE author_id = ${userId}`;

		expect(sql).toBe("SELECT COUNT(*) FROM posts WHERE author_id = ?");
		expect(params).toEqual(["user-123"]);
	});

	test("handles no parameters", () => {
		const {sql, params} = rawQuery`SELECT COUNT(*) FROM posts`;

		expect(sql).toBe("SELECT COUNT(*) FROM posts");
		expect(params).toEqual([]);
	});
});
