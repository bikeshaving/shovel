import {test, expect, describe} from "bun:test";
import {z} from "zod";
import {collection, primary, unique, index} from "./collection.js";
import {generateDDL} from "./ddl.js";

describe("DDL generation", () => {
	test("basic table", () => {
		const User = collection("users", {
			id: z.string().uuid().pipe(primary()),
			name: z.string(),
		});

		const ddl = generateDDL(User, {dialect: "sqlite"});

		expect(ddl).toContain('CREATE TABLE IF NOT EXISTS "users"');
		expect(ddl).toContain('"id" TEXT NOT NULL PRIMARY KEY');
		expect(ddl).toContain('"name" TEXT NOT NULL');
	});

	test("primary key and unique", () => {
		const User = collection("users", {
			id: z.string().uuid().pipe(primary()),
			email: z.string().email().pipe(unique()),
		});

		const ddl = generateDDL(User, {dialect: "sqlite"});

		expect(ddl).toContain('"id" TEXT NOT NULL PRIMARY KEY');
		expect(ddl).toContain('"email" TEXT NOT NULL UNIQUE');
	});

	test("optional and nullable fields", () => {
		const Profile = collection("profiles", {
			id: z.string().uuid().pipe(primary()),
			bio: z.string().optional(),
			avatar: z.string().nullable(),
		});

		const ddl = generateDDL(Profile, {dialect: "sqlite"});

		// Optional/nullable fields should not have NOT NULL
		expect(ddl).toContain('"bio" TEXT');
		expect(ddl).toContain('"avatar" TEXT');
		expect(ddl).not.toContain('"bio" TEXT NOT NULL');
		expect(ddl).not.toContain('"avatar" TEXT NOT NULL');
	});

	test("default values", () => {
		const User = collection("users", {
			id: z.string().uuid().pipe(primary()),
			role: z.string().default("user"),
			active: z.boolean().default(true),
			score: z.number().default(0),
		});

		const ddl = generateDDL(User, {dialect: "sqlite"});

		expect(ddl).toContain("DEFAULT 'user'");
		expect(ddl).toContain("DEFAULT 1"); // SQLite boolean
		expect(ddl).toContain("DEFAULT 0");
	});

	test("integer vs real", () => {
		const Stats = collection("stats", {
			id: z.string().uuid().pipe(primary()),
			count: z.number().int(),
			average: z.number(),
		});

		const ddl = generateDDL(Stats, {dialect: "sqlite"});

		expect(ddl).toContain('"count" INTEGER');
		expect(ddl).toContain('"average" REAL');
	});

	test("enum as text", () => {
		const User = collection("users", {
			id: z.string().uuid().pipe(primary()),
			role: z.enum(["user", "admin", "moderator"]).default("user"),
		});

		const ddl = generateDDL(User, {dialect: "sqlite"});

		expect(ddl).toContain('"role" TEXT');
		expect(ddl).toContain("DEFAULT 'user'");
	});

	test("date field", () => {
		const Post = collection("posts", {
			id: z.string().uuid().pipe(primary()),
			createdAt: z.date().default(() => new Date()),
		});

		const ddl = generateDDL(Post, {dialect: "sqlite"});

		expect(ddl).toContain('"createdAt" TEXT');
		expect(ddl).toContain("DEFAULT CURRENT_TIMESTAMP");
	});

	test("indexed field", () => {
		const Post = collection("posts", {
			id: z.string().uuid().pipe(primary()),
			authorId: z.string().uuid().pipe(index()),
		});

		const ddl = generateDDL(Post, {dialect: "sqlite"});

		expect(ddl).toContain('CREATE INDEX IF NOT EXISTS "idx_posts_authorId"');
		expect(ddl).toContain('ON "posts" ("authorId")');
	});

	test("compound indexes", () => {
		const Post = collection(
			"posts",
			{
				id: z.string().uuid().pipe(primary()),
				authorId: z.string().uuid(),
				createdAt: z.date(),
			},
			{
				indexes: [["authorId", "createdAt"]],
			},
		);

		const ddl = generateDDL(Post, {dialect: "sqlite"});

		expect(ddl).toContain('CREATE INDEX IF NOT EXISTS "idx_posts_authorId_createdAt"');
		expect(ddl).toContain('("authorId", "createdAt")');
	});

	test("json fields", () => {
		const User = collection("users", {
			id: z.string().uuid().pipe(primary()),
			settings: z.object({theme: z.string(), notifications: z.boolean()}),
			tags: z.array(z.string()),
		});

		const ddl = generateDDL(User, {dialect: "sqlite"});

		expect(ddl).toContain('"settings" TEXT');
		expect(ddl).toContain('"tags" TEXT');
	});

	test("postgresql dialect", () => {
		const User = collection("users", {
			id: z.string().uuid().pipe(primary()),
			score: z.number(),
			active: z.boolean().default(true),
			createdAt: z.date().default(() => new Date()),
			settings: z.object({theme: z.string()}),
		});

		const ddl = generateDDL(User, {dialect: "postgresql"});

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
		const User = collection("users", {
			id: z.string().uuid().pipe(primary()),
			name: z.string().max(100),
		});

		const ddl = generateDDL(User, {dialect: "mysql"});

		// MySQL uses backticks
		expect(ddl).toContain("CREATE TABLE IF NOT EXISTS `users`");
		expect(ddl).toContain("`id` TEXT");
		expect(ddl).toContain("`name` VARCHAR(100)");
	});
});
