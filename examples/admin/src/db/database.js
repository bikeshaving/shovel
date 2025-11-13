/**
 * SQLite Database Connection and Operations
 * Using Bun's native SQLite for fast, built-in database operations
 */

import {Database} from "bun:sqlite";

// Database connection
let db = null;

export async function getDatabase() {
	if (!db) {
		// Create database file in project root for development
		// In production, this would be a persistent volume on Fly.io
		const dbPath = process.env.DATABASE_PATH || "admin.db";

		db = new Database(dbPath);

		// Enable WAL mode for better concurrent performance
		db.exec("PRAGMA journal_mode = WAL");
		db.exec("PRAGMA foreign_keys = ON");

		// Initialize schema
		const schemaFile = Bun.file("./src/db/schema.sql");
		const schema = await schemaFile.text();
		db.exec(schema);

		console.info(`[Database] Database connected: ${dbPath}`);
	}

	return db;
}

// Posts operations
export const PostsDB = {
	async findAll() {
		const db = await getDatabase();
		return db.prepare("SELECT * FROM posts ORDER BY created_at DESC").all();
	},

	async findByStatus(status) {
		const db = await getDatabase();
		return db
			.prepare("SELECT * FROM posts WHERE status = ? ORDER BY created_at DESC")
			.all(status);
	},

	async findBySlug(slug) {
		const db = await getDatabase();
		return db.prepare("SELECT * FROM posts WHERE slug = ?").get(slug);
	},

	async create(post) {
		const db = await getDatabase();
		const stmt = db.prepare(`
            INSERT INTO posts (title, slug, content, excerpt, status)
            VALUES (?, ?, ?, ?, ?)
        `);

		const _result = stmt.run(
			post.title,
			post.slug,
			post.content,
			post.excerpt || null,
			post.status || "draft",
		);

		return await this.findBySlug(post.slug);
	},

	async update(slug, updates) {
		const db = await getDatabase();
		const stmt = db.prepare(`
            UPDATE posts 
            SET title = ?, content = ?, excerpt = ?, status = ?, updated_at = CURRENT_TIMESTAMP
            WHERE slug = ?
        `);

		stmt.run(
			updates.title,
			updates.content,
			updates.excerpt || null,
			updates.status,
			slug,
		);

		return await this.findBySlug(slug);
	},

	async delete(slug) {
		const db = await getDatabase();
		return db.prepare("DELETE FROM posts WHERE slug = ?").run(slug);
	},
};

// Docs operations
export const DocsDB = {
	async findAll() {
		const db = await getDatabase();
		return db.prepare("SELECT * FROM docs ORDER BY category, title").all();
	},

	async findByCategory(category) {
		const db = await getDatabase();
		return db
			.prepare("SELECT * FROM docs WHERE category = ? ORDER BY title")
			.all(category);
	},

	async findBySlug(slug) {
		const db = await getDatabase();
		return db.prepare("SELECT * FROM docs WHERE slug = ?").get(slug);
	},

	async create(doc) {
		const db = await getDatabase();
		const stmt = db.prepare(`
            INSERT INTO docs (title, slug, content, category, version, status)
            VALUES (?, ?, ?, ?, ?, ?)
        `);

		const _result = stmt.run(
			doc.title,
			doc.slug,
			doc.content,
			doc.category,
			doc.version || "1.0",
			doc.status || "draft",
		);

		return await this.findBySlug(doc.slug);
	},

	async update(slug, updates) {
		const db = await getDatabase();
		const stmt = db.prepare(`
            UPDATE docs 
            SET title = ?, content = ?, category = ?, version = ?, status = ?, updated_at = CURRENT_TIMESTAMP
            WHERE slug = ?
        `);

		stmt.run(
			updates.title,
			updates.content,
			updates.category,
			updates.version,
			updates.status,
			slug,
		);

		return await this.findBySlug(slug);
	},

	async delete(slug) {
		const db = await getDatabase();
		return db.prepare("DELETE FROM docs WHERE slug = ?").run(slug);
	},
};

// Users operations (basic auth for demo)
export const UsersDB = {
	async findByUsername(username) {
		const db = await getDatabase();
		return db.prepare("SELECT * FROM users WHERE username = ?").get(username);
	},

	async create(user) {
		const db = await getDatabase();
		const stmt = db.prepare(`
            INSERT INTO users (username, email, password_hash, role)
            VALUES (?, ?, ?, ?)
        `);

		return stmt.run(
			user.username,
			user.email,
			user.password_hash,
			user.role || "editor",
		);
	},
};
