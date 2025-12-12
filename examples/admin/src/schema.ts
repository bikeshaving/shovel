/**
 * Example database schema for admin demo
 */

import {z} from "zod";
import {collection, primary, unique, references} from "@b9g/database";

export const users = collection("users", {
	id: z.number().pipe(primary()),
	email: z.string().email().pipe(unique()),
	name: z.string(),
	role: z.enum(["admin", "user"]).default("user"),
	createdAt: z.date().default(() => new Date()),
});

export const posts = collection("posts", {
	id: z.number().pipe(primary()),
	title: z.string(),
	content: z.string().optional(),
	authorId: z.number().pipe(references(users, "id", "author")),
	published: z.boolean().default(false),
	createdAt: z.date().default(() => new Date()),
});

export const tags = collection("tags", {
	id: z.number().pipe(primary()),
	name: z.string().pipe(unique()),
});
