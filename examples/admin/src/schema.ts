/**
 * Example database schema for admin demo
 */

import {sqliteTable, text, integer} from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
	id: integer("id").primaryKey(),
	email: text("email").notNull().unique(),
	name: text("name").notNull(),
	role: text("role", {enum: ["admin", "user"]}).default("user"),
	createdAt: integer("created_at", {mode: "timestamp"}).notNull(),
});

export const posts = sqliteTable("posts", {
	id: integer("id").primaryKey(),
	title: text("title").notNull(),
	content: text("content"),
	authorId: integer("author_id")
		.notNull()
		.references(() => users.id),
	published: integer("published", {mode: "boolean"}).default(false),
	createdAt: integer("created_at", {mode: "timestamp"}).notNull(),
});

export const tags = sqliteTable("tags", {
	id: integer("id").primaryKey(),
	name: text("name").notNull().unique(),
});
