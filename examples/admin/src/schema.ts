/**
 * Example database schema for admin demo
 */

import {z, table} from "@b9g/zen";

export const users = table("users", {
	id: z.number().db.primary(),
	email: z.string().email().db.unique(),
	name: z.string(),
	role: z.enum(["admin", "user"]).db.inserted(() => "user"),
	createdAt: z.date().db.auto(),
});

export const posts = table("posts", {
	id: z.number().db.primary(),
	title: z.string(),
	content: z.string().optional(),
	authorId: z.number().db.references(users, "author"),
	published: z.boolean().db.inserted(() => false),
	createdAt: z.date().db.auto(),
});

export const tags = table("tags", {
	id: z.number().db.primary(),
	name: z.string().db.unique(),
});
