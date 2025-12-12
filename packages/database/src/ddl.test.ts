import {test, expect, describe} from "bun:test";
import {z} from "zod";
import {table, primary, unique, index, references} from "./table.js";
import {generateDDL} from "./ddl.js";

describe("DDL generation", () => {
	test("basic table", () => {
		const users = table("users", {
			id: primary(z.string().uuid()),
			name: z.string(),
		});

		const ddl = generateDDL(users, {dialect: "sqlite"});

		expect(ddl).toContain('CREATE TABLE IF NOT EXISTS "users"');
		expect(ddl).toContain('"id" TEXT NOT NULL PRIMARY KEY');
		expect(ddl).toContain('"name" TEXT NOT NULL');
	});

	test("primary key and unique", () => {
		const users = table("users", {
			id: primary(z.string().uuid()),
			email: unique(z.string().email()),
		});

		const ddl = generateDDL(users, {dialect: "sqlite"});

		expect(ddl).toContain('"id" TEXT NOT NULL PRIMARY KEY');
		expect(ddl).toContain('"email" TEXT NOT NULL UNIQUE');
	});

	test("optional and nullable fields", () => {
		const profiles = table("profiles", {
			id: primary(z.string().uuid()),
			bio: z.string().optional(),
			avatar: z.string().nullable(),
		});

		const ddl = generateDDL(profiles, {dialect: "sqlite"});

		// Optional/nullable fields should not have NOT NULL
		expect(ddl).toContain('"bio" TEXT');
		expect(ddl).toContain('"avatar" TEXT');
		expect(ddl).not.toContain('"bio" TEXT NOT NULL');
		expect(ddl).not.toContain('"avatar" TEXT NOT NULL');
	});

	test("default values", () => {
		const users = table("users", {
			id: primary(z.string().uuid()),
			role: z.string().default("user"),
			active: z.boolean().default(true),
			score: z.number().default(0),
		});

		const ddl = generateDDL(users, {dialect: "sqlite"});

		expect(ddl).toContain("DEFAULT 'user'");
		expect(ddl).toContain("DEFAULT 1"); // SQLite boolean
		expect(ddl).toContain("DEFAULT 0");
	});

	test("integer vs real", () => {
		const stats = table("stats", {
			id: primary(z.string().uuid()),
			count: z.number().int(),
			average: z.number(),
		});

		const ddl = generateDDL(stats, {dialect: "sqlite"});

		expect(ddl).toContain('"count" INTEGER');
		expect(ddl).toContain('"average" REAL');
	});

	test("enum as text", () => {
		const users = table("users", {
			id: primary(z.string().uuid()),
			role: z.enum(["user", "admin", "moderator"]).default("user"),
		});

		const ddl = generateDDL(users, {dialect: "sqlite"});

		expect(ddl).toContain('"role" TEXT');
		expect(ddl).toContain("DEFAULT 'user'");
	});

	test("date field", () => {
		const posts = table("posts", {
			id: primary(z.string().uuid()),
			createdAt: z.date().default(() => new Date()),
		});

		const ddl = generateDDL(posts, {dialect: "sqlite"});

		expect(ddl).toContain('"createdAt" TEXT');
		expect(ddl).toContain("DEFAULT CURRENT_TIMESTAMP");
	});

	test("indexed field", () => {
		const posts = table("posts", {
			id: primary(z.string().uuid()),
			authorId: index(z.string().uuid()),
		});

		const ddl = generateDDL(posts, {dialect: "sqlite"});

		expect(ddl).toContain('CREATE INDEX IF NOT EXISTS "idx_posts_authorId"');
		expect(ddl).toContain('ON "posts" ("authorId")');
	});

	test("compound indexes", () => {
		const posts = table(
			"posts",
			{
				id: primary(z.string().uuid()),
				authorId: z.string().uuid(),
				createdAt: z.date(),
			},
			{
				indexes: [["authorId", "createdAt"]],
			},
		);

		const ddl = generateDDL(posts, {dialect: "sqlite"});

		expect(ddl).toContain('CREATE INDEX IF NOT EXISTS "idx_posts_authorId_createdAt"');
		expect(ddl).toContain('("authorId", "createdAt")');
	});

	test("json fields", () => {
		const users = table("users", {
			id: primary(z.string().uuid()),
			settings: z.object({theme: z.string(), notifications: z.boolean()}),
			tags: z.array(z.string()),
		});

		const ddl = generateDDL(users, {dialect: "sqlite"});

		expect(ddl).toContain('"settings" TEXT');
		expect(ddl).toContain('"tags" TEXT');
	});

	test("postgresql dialect", () => {
		const users = table("users", {
			id: primary(z.string().uuid()),
			score: z.number(),
			active: z.boolean().default(true),
			createdAt: z.date().default(() => new Date()),
			settings: z.object({theme: z.string()}),
		});

		const ddl = generateDDL(users, {dialect: "postgresql"});

		expect(ddl).toContain('"score" DOUBLE PRECISION');
		expect(ddl).toContain('"active" BOOLEAN');
		expect(ddl).toContain("DEFAULT TRUE");
		expect(ddl).toContain('"createdAt" TIMESTAMPTZ');
		expect(ddl).toContain("DEFAULT NOW()");
		expect(ddl).toContain('"settings" JSONB');
		// PostgreSQL uses separate PRIMARY KEY constraint
		expect(ddl).toContain('PRIMARY KEY ("id")');
	});

	test("mysql dialect", () => {
		const users = table("users", {
			id: primary(z.string().uuid()),
			name: z.string().max(100),
		});

		const ddl = generateDDL(users, {dialect: "mysql"});

		// MySQL uses backticks
		expect(ddl).toContain("CREATE TABLE IF NOT EXISTS `users`");
		expect(ddl).toContain("`id` TEXT");
		expect(ddl).toContain("`name` VARCHAR(100)");
	});

	test("foreign key constraint", () => {
		const users = table("users", {
			id: primary(z.string().uuid()),
			name: z.string(),
		});

		const posts = table("posts", {
			id: primary(z.string().uuid()),
			authorId: references(z.string().uuid(), users, {as: "author"}),
			title: z.string(),
		});

		const ddl = generateDDL(posts, {dialect: "sqlite"});

		expect(ddl).toContain('FOREIGN KEY ("authorId") REFERENCES "users"("id")');
	});

	test("foreign key with onDelete cascade", () => {
		const users = table("users", {
			id: primary(z.string().uuid()),
			name: z.string(),
		});

		const posts = table("posts", {
			id: primary(z.string().uuid()),
			authorId: references(z.string().uuid(), users, {as: "author", onDelete: "cascade"}),
			title: z.string(),
		});

		const ddl = generateDDL(posts, {dialect: "sqlite"});

		expect(ddl).toContain('FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE');
	});

	test("foreign key with onDelete set null", () => {
		const users = table("users", {
			id: primary(z.string().uuid()),
			name: z.string(),
		});

		const posts = table("posts", {
			id: primary(z.string().uuid()),
			authorId: references(z.string().uuid().nullable(), users, {as: "author", onDelete: "set null"}),
			title: z.string(),
		});

		const ddl = generateDDL(posts, {dialect: "sqlite"});

		expect(ddl).toContain('FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL');
	});

	test("foreign key with onDelete restrict", () => {
		const users = table("users", {
			id: primary(z.string().uuid()),
			name: z.string(),
		});

		const posts = table("posts", {
			id: primary(z.string().uuid()),
			authorId: references(z.string().uuid(), users, {as: "author", onDelete: "restrict"}),
			title: z.string(),
		});

		const ddl = generateDDL(posts, {dialect: "sqlite"});

		expect(ddl).toContain('FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT');
	});

	test("multiple foreign keys", () => {
		const users = table("users", {
			id: primary(z.string().uuid()),
			name: z.string(),
		});

		const categories = table("categories", {
			id: primary(z.string().uuid()),
			name: z.string(),
		});

		const posts = table("posts", {
			id: primary(z.string().uuid()),
			authorId: references(z.string().uuid(), users, {as: "author", onDelete: "cascade"}),
			categoryId: references(z.string().uuid().nullable(), categories, {as: "category", onDelete: "set null"}),
			title: z.string(),
		});

		const ddl = generateDDL(posts, {dialect: "sqlite"});

		expect(ddl).toContain('FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE');
		expect(ddl).toContain('FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL');
	});

	test("foreign key with custom field reference", () => {
		const users = table("users", {
			id: primary(z.string().uuid()),
			email: unique(z.string().email()),
			name: z.string(),
		});

		const posts = table("posts", {
			id: primary(z.string().uuid()),
			authorEmail: references(z.string().email(), users, {field: "email", as: "author"}),
			title: z.string(),
		});

		const ddl = generateDDL(posts, {dialect: "sqlite"});

		expect(ddl).toContain('FOREIGN KEY ("authorEmail") REFERENCES "users"("email")');
	});

	test("foreign key in postgresql", () => {
		const users = table("users", {
			id: primary(z.string().uuid()),
			name: z.string(),
		});

		const posts = table("posts", {
			id: primary(z.string().uuid()),
			authorId: references(z.string().uuid(), users, {as: "author", onDelete: "cascade"}),
			title: z.string(),
		});

		const ddl = generateDDL(posts, {dialect: "postgresql"});

		expect(ddl).toContain('FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE');
	});

	test("foreign key in mysql", () => {
		const users = table("users", {
			id: primary(z.string().uuid()),
			name: z.string(),
		});

		const posts = table("posts", {
			id: primary(z.string().uuid()),
			authorId: references(z.string().uuid(), users, {as: "author", onDelete: "cascade"}),
			title: z.string(),
		});

		const ddl = generateDDL(posts, {dialect: "mysql"});

		expect(ddl).toContain("FOREIGN KEY (`authorId`) REFERENCES `users`(`id`) ON DELETE CASCADE");
	});
});
