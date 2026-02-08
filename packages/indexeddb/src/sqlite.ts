/**
 * SQLite backend for IndexedDB.
 *
 * One SQLite file per IndexedDB database. Uses BLOB comparison (memcmp)
 * which matches our order-preserving key encoding.
 *
 * Auto-detects bun:sqlite vs better-sqlite3 (both have compatible sync APIs).
 */

import {compareKeys, encodeKey, extractKeyFromValue} from "./key.js";
import {decodeValue} from "./structured-clone.js";
import {ConstraintError} from "./errors.js";
import type {
	EncodedKey,
	KeyRangeSpec,
	ObjectStoreMeta,
	IndexMeta,
	DatabaseMeta,
	CursorDirection,
	StoredRecord,
} from "./types.js";
import type {
	IDBBackend,
	IDBBackendConnection,
	IDBBackendTransaction,
	IDBBackendCursor,
} from "./backend.js";

import {mkdirSync, existsSync, unlinkSync, readdirSync} from "node:fs";
import {join} from "node:path";

// ============================================================================
// SQLite driver abstraction
// ============================================================================

interface SQLiteDB {
	exec(sql: string): void;
	prepare(sql: string): SQLiteStatement;
	close(): void;
}

interface SQLiteStatement {
	run(...params: any[]): void;
	get(...params: any[]): any;
	all(...params: any[]): any[];
}

/**
 * Open a SQLite database, auto-detecting bun:sqlite vs better-sqlite3.
 */
function openSQLite(path: string): SQLiteDB {
	try {
		// Try bun:sqlite first
		const {Database} = require("bun:sqlite");
		const db = new Database(path);
		db.exec("PRAGMA journal_mode=WAL");
		return {
			exec(sql: string) {
				db.exec(sql);
			},
			prepare(sql: string): SQLiteStatement {
				const stmt = db.prepare(sql);
				return {
					run(...params: any[]) {
						stmt.run(...params);
					},
					get(...params: any[]) {
						return stmt.get(...params);
					},
					all(...params: any[]) {
						return stmt.all(...params);
					},
				};
			},
			close() {
				db.close();
			},
		};
	} catch {
		// Fall back to better-sqlite3
		const BetterSqlite3 = require("better-sqlite3");
		const db = new BetterSqlite3(path);
		db.pragma("journal_mode = WAL");
		return {
			exec(sql: string) {
				db.exec(sql);
			},
			prepare(sql: string): SQLiteStatement {
				const stmt = db.prepare(sql);
				return {
					run(...params: any[]) {
						stmt.run(...params);
					},
					get(...params: any[]) {
						return stmt.get(...params);
					},
					all(...params: any[]) {
						return stmt.all(...params);
					},
				};
			},
			close() {
				db.close();
			},
		};
	}
}

// ============================================================================
// Helpers
// ============================================================================

function sanitizeName(name: string): string {
	// Replace any non-alphanumeric chars with underscore for SQL safety
	return name.replace(/[^a-zA-Z0-9_]/g, "_");
}

function storeTable(name: string): string {
	return `"_idb_store_${sanitizeName(name)}"`;
}

function indexTable(storeName: string, indexName: string): string {
	return `"_idb_index_${sanitizeName(storeName)}_${sanitizeName(indexName)}"`;
}

function buildWhereClause(range?: KeyRangeSpec): {clause: string; params: any[]} {
	if (!range) return {clause: "", params: []};

	const conditions: string[] = [];
	const params: any[] = [];

	if (range.lower) {
		conditions.push(range.lowerOpen ? "key > ?" : "key >= ?");
		params.push(Buffer.from(range.lower));
	}
	if (range.upper) {
		conditions.push(range.upperOpen ? "key < ?" : "key <= ?");
		params.push(Buffer.from(range.upper));
	}

	if (conditions.length === 0) return {clause: "", params: []};
	return {clause: ` WHERE ${conditions.join(" AND ")}`, params};
}

function buildIndexWhereClause(range?: KeyRangeSpec): {clause: string; params: any[]} {
	if (!range) return {clause: "", params: []};

	const conditions: string[] = [];
	const params: any[] = [];

	if (range.lower) {
		conditions.push(range.lowerOpen ? "key > ?" : "key >= ?");
		params.push(Buffer.from(range.lower));
	}
	if (range.upper) {
		conditions.push(range.upperOpen ? "key < ?" : "key <= ?");
		params.push(Buffer.from(range.upper));
	}

	if (conditions.length === 0) return {clause: "", params: []};
	return {clause: ` WHERE ${conditions.join(" AND ")}`, params};
}

function directionToOrder(direction?: CursorDirection): string {
	switch (direction) {
		case "prev":
		case "prevunique":
			return "DESC";
		default:
			return "ASC";
	}
}

// ============================================================================
// SQLite Transaction
// ============================================================================

class SQLiteTransaction implements IDBBackendTransaction {
	#db: SQLiteDB;
	#meta: Map<string, ObjectStoreMeta>;
	#indexes: Map<string, IndexMeta[]>;
	#aborted = false;

	constructor(
		db: SQLiteDB,
		meta: Map<string, ObjectStoreMeta>,
		indexes: Map<string, IndexMeta[]>,
	) {
		this.#db = db;
		this.#meta = meta;
		this.#indexes = indexes;
		this.#db.exec("BEGIN");
	}

	// ---- Schema operations ----

	createObjectStore(meta: ObjectStoreMeta): void {
		const table = storeTable(meta.name);
		this.#db.exec(`CREATE TABLE IF NOT EXISTS ${table} (
			key BLOB PRIMARY KEY,
			value BLOB NOT NULL
		)`);

		// Store metadata
		this.#meta.set(meta.name, meta);
		this.#saveMeta();

		if (meta.autoIncrement) {
			this.#db.exec(`INSERT OR IGNORE INTO _idb_autoincrement (store_name, current_key) VALUES ('${sanitizeName(meta.name)}', 0)`);
		}
	}

	deleteObjectStore(name: string): void {
		const table = storeTable(name);
		this.#db.exec(`DROP TABLE IF EXISTS ${table}`);

		// Drop all indexes for this store
		const indexes = this.#indexes.get(name) || [];
		for (const idx of indexes) {
			const idxTable = indexTable(name, idx.name);
			this.#db.exec(`DROP TABLE IF EXISTS ${idxTable}`);
		}

		this.#meta.delete(name);
		this.#indexes.delete(name);
		this.#saveMeta();

		this.#db.exec(`DELETE FROM _idb_autoincrement WHERE store_name = '${sanitizeName(name)}'`);
	}

	createIndex(meta: IndexMeta): void {
		const table = indexTable(meta.storeName, meta.name);
		if (meta.unique) {
			this.#db.exec(`CREATE TABLE IF NOT EXISTS ${table} (
				key BLOB NOT NULL,
				primary_key BLOB NOT NULL,
				PRIMARY KEY (key)
			)`);
		} else {
			this.#db.exec(`CREATE TABLE IF NOT EXISTS ${table} (
				key BLOB NOT NULL,
				primary_key BLOB NOT NULL,
				PRIMARY KEY (key, primary_key)
			)`);
		}

		// Store index metadata
		const storeIndexes = this.#indexes.get(meta.storeName) || [];
		storeIndexes.push(meta);
		this.#indexes.set(meta.storeName, storeIndexes);
		this.#saveMeta();

		// Populate from existing data
		const storeTable_ = storeTable(meta.storeName);
		const rows = this.#db.prepare(`SELECT key, value FROM ${storeTable_}`).all();
		for (const row of rows) {
			this.#addToIndex(meta, new Uint8Array(row.key), new Uint8Array(row.value));
		}
	}

	deleteIndex(storeName: string, indexName: string): void {
		const table = indexTable(storeName, indexName);
		this.#db.exec(`DROP TABLE IF EXISTS ${table}`);

		const storeIndexes = this.#indexes.get(storeName) || [];
		const filtered = storeIndexes.filter((i) => i.name !== indexName);
		this.#indexes.set(storeName, filtered);
		this.#saveMeta();
	}

	// ---- Data operations ----

	get(storeName: string, key: EncodedKey): StoredRecord | undefined {
		const table = storeTable(storeName);
		const row = this.#db.prepare(`SELECT key, value FROM ${table} WHERE key = ?`).get(Buffer.from(key));
		if (!row) return undefined;
		return {key: new Uint8Array(row.key), value: new Uint8Array(row.value)};
	}

	getAll(storeName: string, range?: KeyRangeSpec, count?: number): StoredRecord[] {
		const table = storeTable(storeName);
		const {clause, params} = buildWhereClause(range);
		const limit = count !== undefined ? ` LIMIT ${count}` : "";
		const rows = this.#db.prepare(`SELECT key, value FROM ${table}${clause} ORDER BY key ASC${limit}`).all(...params);
		return rows.map((row: any) => ({
			key: new Uint8Array(row.key),
			value: new Uint8Array(row.value),
		}));
	}

	getAllKeys(storeName: string, range?: KeyRangeSpec, count?: number): EncodedKey[] {
		const table = storeTable(storeName);
		const {clause, params} = buildWhereClause(range);
		const limit = count !== undefined ? ` LIMIT ${count}` : "";
		const rows = this.#db.prepare(`SELECT key FROM ${table}${clause} ORDER BY key ASC${limit}`).all(...params);
		return rows.map((row: any) => new Uint8Array(row.key));
	}

	put(storeName: string, key: EncodedKey, value: Uint8Array): void {
		const table = storeTable(storeName);

		// Remove old index entries if updating
		const existing = this.get(storeName, key);
		if (existing) {
			this.#removeFromIndexes(storeName, key);
		}

		this.#db.prepare(`INSERT OR REPLACE INTO ${table} (key, value) VALUES (?, ?)`).run(Buffer.from(key), Buffer.from(value));

		// Add new index entries
		this.#addToAllIndexes(storeName, key, value);
	}

	add(storeName: string, key: EncodedKey, value: Uint8Array): void {
		const table = storeTable(storeName);

		// Check for existing key
		const existing = this.get(storeName, key);
		if (existing) {
			throw ConstraintError(`Key already exists in object store "${storeName}"`);
		}

		this.#db.prepare(`INSERT INTO ${table} (key, value) VALUES (?, ?)`).run(Buffer.from(key), Buffer.from(value));
		this.#addToAllIndexes(storeName, key, value);
	}

	delete(storeName: string, range: KeyRangeSpec): void {
		const table = storeTable(storeName);

		// First remove index entries
		const records = this.getAll(storeName, range);
		for (const record of records) {
			this.#removeFromIndexes(storeName, record.key);
		}

		const {clause, params} = buildWhereClause(range);
		this.#db.prepare(`DELETE FROM ${table}${clause}`).run(...params);
	}

	clear(storeName: string): void {
		const table = storeTable(storeName);
		this.#db.exec(`DELETE FROM ${table}`);

		// Clear all indexes
		const indexes = this.#indexes.get(storeName) || [];
		for (const idx of indexes) {
			const idxTable = indexTable(storeName, idx.name);
			this.#db.exec(`DELETE FROM ${idxTable}`);
		}
	}

	count(storeName: string, range?: KeyRangeSpec): number {
		const table = storeTable(storeName);
		const {clause, params} = buildWhereClause(range);
		const row = this.#db.prepare(`SELECT COUNT(*) as count FROM ${table}${clause}`).get(...params);
		return row?.count ?? 0;
	}

	// ---- Index operations ----

	indexGet(storeName: string, indexName: string, key: EncodedKey): StoredRecord | undefined {
		const table = indexTable(storeName, indexName);
		const row = this.#db.prepare(`SELECT primary_key FROM ${table} WHERE key = ? LIMIT 1`).get(Buffer.from(key));
		if (!row) return undefined;
		return this.get(storeName, new Uint8Array(row.primary_key));
	}

	indexGetAll(storeName: string, indexName: string, range?: KeyRangeSpec, count?: number): StoredRecord[] {
		const table = indexTable(storeName, indexName);
		const {clause, params} = buildIndexWhereClause(range);
		const limit = count !== undefined ? ` LIMIT ${count}` : "";
		const rows = this.#db.prepare(`SELECT primary_key FROM ${table}${clause} ORDER BY key ASC${limit}`).all(...params);
		const results: StoredRecord[] = [];
		for (const row of rows) {
			const record = this.get(storeName, new Uint8Array(row.primary_key));
			if (record) results.push(record);
		}
		return results;
	}

	indexGetAllKeys(storeName: string, indexName: string, range?: KeyRangeSpec, count?: number): EncodedKey[] {
		const table = indexTable(storeName, indexName);
		const {clause, params} = buildIndexWhereClause(range);
		const limit = count !== undefined ? ` LIMIT ${count}` : "";
		const rows = this.#db.prepare(`SELECT primary_key FROM ${table}${clause} ORDER BY key ASC${limit}`).all(...params);
		return rows.map((row: any) => new Uint8Array(row.primary_key));
	}

	indexCount(storeName: string, indexName: string, range?: KeyRangeSpec): number {
		const table = indexTable(storeName, indexName);
		const {clause, params} = buildIndexWhereClause(range);
		const row = this.#db.prepare(`SELECT COUNT(*) as count FROM ${table}${clause}`).get(...params);
		return row?.count ?? 0;
	}

	// ---- Cursors ----

	openCursor(storeName: string, range?: KeyRangeSpec, direction: CursorDirection = "next"): IDBBackendCursor | null {
		const table = storeTable(storeName);
		const {clause, params} = buildWhereClause(range);
		const order = directionToOrder(direction);
		const rows = this.#db.prepare(`SELECT key, value FROM ${table}${clause} ORDER BY key ${order}`).all(...params);

		if (rows.length === 0) return null;

		const entries = rows.map((row: any) => ({
			key: new Uint8Array(row.key),
			value: new Uint8Array(row.value),
		}));

		if (direction === "nextunique" || direction === "prevunique") {
			const unique: typeof entries = [];
			let lastKey: Uint8Array | null = null;
			for (const e of entries) {
				if (lastKey === null || compareKeys(e.key, lastKey) !== 0) {
					unique.push(e);
					lastKey = e.key;
				}
			}
			if (unique.length === 0) return null;
			return new ArrayCursor(unique);
		}

		return new ArrayCursor(entries);
	}

	openKeyCursor(storeName: string, range?: KeyRangeSpec, direction: CursorDirection = "next"): IDBBackendCursor | null {
		return this.openCursor(storeName, range, direction);
	}

	openIndexCursor(storeName: string, indexName: string, range?: KeyRangeSpec, direction: CursorDirection = "next"): IDBBackendCursor | null {
		const table = indexTable(storeName, indexName);
		const {clause, params} = buildIndexWhereClause(range);
		const order = directionToOrder(direction);
		const rows = this.#db.prepare(`SELECT key, primary_key FROM ${table}${clause} ORDER BY key ${order}`).all(...params);

		const entries: {key: Uint8Array; primaryKey: Uint8Array; value: Uint8Array}[] = [];
		for (const row of rows) {
			const record = this.get(storeName, new Uint8Array(row.primary_key));
			if (record) {
				entries.push({
					key: new Uint8Array(row.key),
					primaryKey: new Uint8Array(row.primary_key),
					value: record.value,
				});
			}
		}

		if (direction === "nextunique" || direction === "prevunique") {
			const unique: typeof entries = [];
			let lastKey: Uint8Array | null = null;
			for (const e of entries) {
				if (lastKey === null || compareKeys(e.key, lastKey) !== 0) {
					unique.push(e);
					lastKey = e.key;
				}
			}
			if (unique.length === 0) return null;
			return new IndexArrayCursor(unique);
		}

		if (entries.length === 0) return null;
		return new IndexArrayCursor(entries);
	}

	openIndexKeyCursor(storeName: string, indexName: string, range?: KeyRangeSpec, direction: CursorDirection = "next"): IDBBackendCursor | null {
		return this.openIndexCursor(storeName, indexName, range, direction);
	}

	// ---- Auto-increment ----

	nextAutoIncrementKey(storeName: string): number {
		const name = sanitizeName(storeName);
		this.#db.prepare(`UPDATE _idb_autoincrement SET current_key = current_key + 1 WHERE store_name = ?`).run(name);
		const row = this.#db.prepare(`SELECT current_key FROM _idb_autoincrement WHERE store_name = ?`).get(name);
		return row?.current_key ?? 1;
	}

	// ---- Lifecycle ----

	commit(): void {
		if (!this.#aborted) {
			this.#db.exec("COMMIT");
		}
	}

	abort(): void {
		this.#aborted = true;
		this.#db.exec("ROLLBACK");
	}

	// ---- Private helpers ----

	#saveMeta(): void {
		const storeData = JSON.stringify(
			Array.from(this.#meta.entries()).map(([, meta]) => meta),
		);
		const indexData = JSON.stringify(
			Array.from(this.#indexes.entries()).flatMap(([, indexes]) => indexes),
		);
		this.#db.prepare(`INSERT OR REPLACE INTO _idb_meta (key, value) VALUES ('objectStores', ?)`).run(storeData);
		this.#db.prepare(`INSERT OR REPLACE INTO _idb_meta (key, value) VALUES ('indexes', ?)`).run(indexData);
	}

	#addToAllIndexes(storeName: string, primaryKey: Uint8Array, value: Uint8Array): void {
		const indexes = this.#indexes.get(storeName) || [];
		for (const idx of indexes) {
			this.#addToIndex(idx, primaryKey, value);
		}
	}

	#addToIndex(meta: IndexMeta, primaryKey: Uint8Array, value: Uint8Array): void {
		let decodedValue: unknown;
		try {
			decodedValue = decodeValue(value);
		} catch {
			return;
		}

		let indexKeys: Uint8Array[];
		try {
			if (meta.multiEntry && typeof meta.keyPath === "string") {
				const extracted = extractKeyFromValue(decodedValue, meta.keyPath);
				if (Array.isArray(extracted)) {
					indexKeys = extracted.map((k) => encodeKey(k));
				} else {
					indexKeys = [encodeKey(extracted)];
				}
			} else {
				const extracted = extractKeyFromValue(decodedValue, meta.keyPath);
				indexKeys = [encodeKey(extracted)];
			}
		} catch {
			return;
		}

		const table = indexTable(meta.storeName, meta.name);
		for (const indexKey of indexKeys) {
			if (meta.unique) {
				const existing = this.#db.prepare(`SELECT primary_key FROM ${table} WHERE key = ?`).get(Buffer.from(indexKey));
				if (existing) {
					throw ConstraintError(`Unique constraint violated for index "${meta.name}"`);
				}
			}
			this.#db.prepare(`INSERT OR IGNORE INTO ${table} (key, primary_key) VALUES (?, ?)`).run(
				Buffer.from(indexKey),
				Buffer.from(primaryKey),
			);
		}
	}

	#removeFromIndexes(storeName: string, primaryKey: Uint8Array): void {
		const indexes = this.#indexes.get(storeName) || [];
		for (const idx of indexes) {
			const table = indexTable(storeName, idx.name);
			this.#db.prepare(`DELETE FROM ${table} WHERE primary_key = ?`).run(Buffer.from(primaryKey));
		}
	}
}

// ============================================================================
// Array-based cursors
// ============================================================================

class ArrayCursor implements IDBBackendCursor {
	#entries: {key: Uint8Array; value: Uint8Array}[];
	#pos = 0;

	constructor(entries: {key: Uint8Array; value: Uint8Array}[]) {
		this.#entries = entries;
	}

	get primaryKey(): EncodedKey { return this.#entries[this.#pos].key; }
	get key(): EncodedKey { return this.#entries[this.#pos].key; }
	get value(): Uint8Array { return this.#entries[this.#pos].value; }

	continue(): boolean {
		this.#pos++;
		return this.#pos < this.#entries.length;
	}
}

class IndexArrayCursor implements IDBBackendCursor {
	#entries: {key: Uint8Array; primaryKey: Uint8Array; value: Uint8Array}[];
	#pos = 0;

	constructor(entries: {key: Uint8Array; primaryKey: Uint8Array; value: Uint8Array}[]) {
		this.#entries = entries;
	}

	get primaryKey(): EncodedKey { return this.#entries[this.#pos].primaryKey; }
	get key(): EncodedKey { return this.#entries[this.#pos].key; }
	get value(): Uint8Array { return this.#entries[this.#pos].value; }

	continue(): boolean {
		this.#pos++;
		return this.#pos < this.#entries.length;
	}
}

// ============================================================================
// SQLite Connection
// ============================================================================

class SQLiteConnection implements IDBBackendConnection {
	#db: SQLiteDB;
	#meta: Map<string, ObjectStoreMeta>;
	#indexes: Map<string, IndexMeta[]>;

	constructor(db: SQLiteDB) {
		this.#db = db;
		this.#meta = new Map();
		this.#indexes = new Map();
		this.#loadMeta();
	}

	getMetadata(): DatabaseMeta {
		const versionRow = this.#db.prepare(`SELECT value FROM _idb_meta WHERE key = 'version'`).get();
		const version = versionRow ? parseInt(versionRow.value, 10) : 0;

		return {
			name: "",
			version,
			objectStores: new Map(this.#meta),
			indexes: new Map(this.#indexes),
		};
	}

	beginTransaction(
		_storeNames: string[],
		_mode: "readonly" | "readwrite" | "versionchange",
	): IDBBackendTransaction {
		return new SQLiteTransaction(this.#db, this.#meta, this.#indexes);
	}

	#loadMeta(): void {
		try {
			const storesRow = this.#db.prepare(`SELECT value FROM _idb_meta WHERE key = 'objectStores'`).get();
			if (storesRow) {
				const stores: ObjectStoreMeta[] = JSON.parse(storesRow.value);
				for (const s of stores) {
					this.#meta.set(s.name, s);
				}
			}

			const indexesRow = this.#db.prepare(`SELECT value FROM _idb_meta WHERE key = 'indexes'`).get();
			if (indexesRow) {
				const indexes: IndexMeta[] = JSON.parse(indexesRow.value);
				for (const idx of indexes) {
					const storeIndexes = this.#indexes.get(idx.storeName) || [];
					storeIndexes.push(idx);
					this.#indexes.set(idx.storeName, storeIndexes);
				}
			}
		} catch {
			// Fresh database — no metadata yet
		}
	}
}

// ============================================================================
// SQLite Backend
// ============================================================================

export class SQLiteBackend implements IDBBackend {
	#basePath: string;
	#connections = new Map<string, SQLiteDB>();

	constructor(basePath: string) {
		this.#basePath = basePath;
		mkdirSync(basePath, {recursive: true});
	}

	open(name: string, version: number): IDBBackendConnection {
		const dbPath = this.#dbPath(name);
		let db = this.#connections.get(name);

		if (!db) {
			db = openSQLite(dbPath);
			this.#connections.set(name, db);
			// Initialize schema
			this.#initSchema(db, name, version);
		} else {
			// Update version
			db.prepare(`INSERT OR REPLACE INTO _idb_meta (key, value) VALUES ('version', ?)`).run(String(version));
		}

		return new SQLiteConnection(db);
	}

	deleteDatabase(name: string): void {
		// Close if open
		const db = this.#connections.get(name);
		if (db) {
			db.close();
			this.#connections.delete(name);
		}

		// Delete files
		const dbPath = this.#dbPath(name);
		for (const suffix of ["", "-wal", "-shm", "-journal"]) {
			try {
				unlinkSync(dbPath + suffix);
			} catch {
				// Ignore missing files
			}
		}
	}

	databases(): Array<{name: string; version: number}> {
		const results: Array<{name: string; version: number}> = [];
		if (!existsSync(this.#basePath)) return results;

		const files = readdirSync(this.#basePath);
		for (const file of files) {
			if (file.endsWith(".sqlite")) {
				try {
					const dbPath = join(this.#basePath, file);
					const db = openSQLite(dbPath);
					const nameRow = db.prepare(`SELECT value FROM _idb_meta WHERE key = 'name'`).get();
					const versionRow = db.prepare(`SELECT value FROM _idb_meta WHERE key = 'version'`).get();
					const name = nameRow?.value ?? file.slice(0, -7);
					const version = versionRow ? parseInt(versionRow.value, 10) : 0;
					db.close();
					results.push({name, version});
				} catch {
					// Skip corrupt/unreadable databases
				}
			}
		}

		return results;
	}

	close(name: string): void {
		const db = this.#connections.get(name);
		if (db) {
			db.close();
			this.#connections.delete(name);
		}
	}

	#dbPath(name: string): string {
		return join(this.#basePath, `${sanitizeName(name)}.sqlite`);
	}

	#initSchema(db: SQLiteDB, name: string, version: number): void {
		db.exec(`CREATE TABLE IF NOT EXISTS _idb_meta (
			key TEXT PRIMARY KEY,
			value TEXT
		)`);
		db.exec(`CREATE TABLE IF NOT EXISTS _idb_autoincrement (
			store_name TEXT PRIMARY KEY,
			current_key INTEGER DEFAULT 0
		)`);
		db.prepare(`INSERT OR REPLACE INTO _idb_meta (key, value) VALUES ('name', ?)`).run(name);
		db.prepare(`INSERT OR REPLACE INTO _idb_meta (key, value) VALUES ('version', ?)`).run(String(version));
	}
}
