import {test, expect, describe} from "bun:test";
import {z} from "zod";
import {table, primary, unique, index} from "./table.js";

describe("table", () => {
	test("basic table definition", () => {
		const users = table("users", {
			id: z.string().uuid(),
			name: z.string(),
		});

		expect(users.name).toBe("users");
	});

	test("extracts field metadata", () => {
		const users = table("users", {
			id: primary(z.string().uuid()),
			email: unique(z.string().email()),
			name: z.string().max(100),
			bio: z.string().max(2000),
			age: z.number().int().min(0).max(150),
			role: z.enum(["user", "admin", "moderator"]).default("user"),
			active: z.boolean().default(true),
			createdAt: z.date().default(() => new Date()),
		});

		const fields = users.fields();

		// Primary key
		expect(fields.id.primaryKey).toBe(true);
		expect(fields.id.type).toBe("text");

		// Email field
		expect(fields.email.type).toBe("email");
		expect(fields.email.unique).toBe(true);
		expect(fields.email.required).toBe(true);

		// String with max length
		expect(fields.name.type).toBe("text");
		expect(fields.name.maxLength).toBe(100);

		// Long text becomes textarea
		expect(fields.bio.type).toBe("textarea");
		expect(fields.bio.maxLength).toBe(2000);

		// Integer with min/max
		expect(fields.age.type).toBe("integer");
		expect(fields.age.min).toBe(0);
		expect(fields.age.max).toBe(150);

		// Enum becomes select
		expect(fields.role.type).toBe("select");
		expect(fields.role.options).toEqual(["user", "admin", "moderator"]);
		expect(fields.role.default).toBe("user");
		expect(fields.role.required).toBe(false); // has default

		// Boolean
		expect(fields.active.type).toBe("checkbox");
		expect(fields.active.default).toBe(true);

		// Date
		expect(fields.createdAt.type).toBe("datetime");
		expect(fields.createdAt.required).toBe(false); // has default
	});

	test("detects primary key", () => {
		const users = table("users", {
			id: primary(z.string().uuid()),
			email: z.string().email(),
		});

		expect(users.primaryKey()).toBe("id");
	});

	test("handles optional and nullable fields", () => {
		const profiles = table("profiles", {
			id: primary(z.string().uuid()),
			bio: z.string().optional(),
			avatar: z.string().url().nullable(),
			nickname: z.string().nullish(),
		});

		const fields = profiles.fields();

		expect(fields.bio.required).toBe(false);
		expect(fields.avatar.required).toBe(false);
		expect(fields.avatar.type).toBe("url");
		expect(fields.nickname.required).toBe(false);
	});

	test("url detection", () => {
		const links = table("links", {
			id: primary(z.string().uuid()),
			url: z.string().url(),
		});

		const fields = links.fields();
		expect(fields.url.type).toBe("url");
	});

	test("indexed fields", () => {
		const posts = table("posts", {
			id: primary(z.string().uuid()),
			authorId: index(z.string().uuid()),
			title: z.string(),
		});

		const fields = posts.fields();
		expect(fields.authorId.indexed).toBe(true);
	});

	test("compound indexes via options", () => {
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

		expect(posts.indexes).toEqual([["authorId", "createdAt"]]);
	});
});

describe("type inference", () => {
	test("Infer extracts document type", () => {
		const users = table("users", {
			id: z.string().uuid(),
			name: z.string(),
			age: z.number().optional(),
		});

		// Type check - this should compile
		type UserDoc = z.infer<typeof users.schema>;
		const user: UserDoc = {id: "123", name: "Alice"};
		expect(user.name).toBe("Alice");
	});
});
