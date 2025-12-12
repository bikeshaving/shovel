import {test, expect, describe} from "bun:test";
import {z} from "zod";
import {collection, primary, unique, index} from "./collection.js";

describe("collection", () => {
	test("basic collection definition", () => {
		const User = collection("users", {
			id: z.string().uuid(),
			name: z.string(),
		});

		expect(User.name).toBe("users");
		expect(User.version).toBe(1);
	});

	test("extracts field metadata", () => {
		const User = collection("users", {
			id: z.string().uuid().pipe(primary()),
			email: z.string().email().pipe(unique()),
			name: z.string().max(100),
			bio: z.string().max(2000),
			age: z.number().int().min(0).max(150),
			role: z.enum(["user", "admin", "moderator"]).default("user"),
			active: z.boolean().default(true),
			createdAt: z.date().default(() => new Date()),
		});

		const fields = User.fields();

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
		const User = collection("users", {
			id: z.string().uuid().pipe(primary()),
			email: z.string().email(),
		});

		expect(User.primaryKey()).toBe("id");
	});

	test("handles optional and nullable fields", () => {
		const Profile = collection("profiles", {
			id: z.string().uuid().pipe(primary()),
			bio: z.string().optional(),
			avatar: z.string().url().nullable(),
			nickname: z.string().nullish(),
		});

		const fields = Profile.fields();

		expect(fields.bio.required).toBe(false);
		expect(fields.avatar.required).toBe(false);
		expect(fields.avatar.type).toBe("url");
		expect(fields.nickname.required).toBe(false);
	});

	test("url detection", () => {
		const Link = collection("links", {
			id: z.string().uuid().pipe(primary()),
			url: z.string().url(),
		});

		const fields = Link.fields();
		expect(fields.url.type).toBe("url");
	});

	test("indexed fields", () => {
		const Post = collection("posts", {
			id: z.string().uuid().pipe(primary()),
			authorId: z.string().uuid().pipe(index()),
			title: z.string(),
		});

		const fields = Post.fields();
		expect(fields.authorId.indexed).toBe(true);
	});

	test("compound indexes via options", () => {
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

		expect(Post.indexes).toEqual([["authorId", "createdAt"]]);
	});
});

describe("type inference", () => {
	test("Infer extracts document type", () => {
		const User = collection("users", {
			id: z.string().uuid(),
			name: z.string(),
			age: z.number().optional(),
		});

		// Type check - this should compile
		type UserDoc = z.infer<typeof User.schema>;
		const user: UserDoc = {id: "123", name: "Alice"};
		expect(user.name).toBe("Alice");
	});
});
