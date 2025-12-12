/**
 * Example database schema for admin demo
 */

import {z} from "zod";
import {table, primary, unique, references} from "@b9g/database";

export const users = table("users", {
	id: primary(z.number()),
	email: unique(z.string().email()),
	name: z.string(),
	role: z.enum(["admin", "user"]).default("user"),
	createdAt: z.date().default(() => new Date()),
});

export const posts = table("posts", {
	id: primary(z.number()),
	title: z.string(),
	content: z.string().optional(),
	authorId: references(z.number(), users, {as: "author"}),
	published: z.boolean().default(false),
	createdAt: z.date().default(() => new Date()),
});

export const tags = table("tags", {
	id: primary(z.number()),
	name: unique(z.string()),
});
