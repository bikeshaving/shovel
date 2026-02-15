/**
 * SQLite backend for IndexedDB.
 *
 * One SQLite file per IndexedDB database. Uses BLOB comparison (memcmp)
 * which matches our order-preserving key encoding.
 *
 * Schema: five fixed tables — no dynamic DDL, no name collisions.
 * Each connection gets its own SQLite handle for correct concurrency.
 *
 * Auto-detects bun:sqlite vs better-sqlite3 (both have compatible sync APIs).
 */

import {

	encodeKey,
	validateKey,
	extractKeyFromValue,
} from "./key.js";
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
		// eslint-disable-next-line no-restricted-globals
		const {Database} = require("bun:sqlite");
		const db = new Database(path);
		db.exec("PRAGMA journal_mode=WAL");
		db.exec("PRAGMA foreign_keys=ON");
		db.exec("PRAGMA busy_timeout=5000");
		db.exec("PRAGMA cache_size=-256");
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
	} catch (_error) {
		// Fall back to better-sqlite3
		// eslint-disable-next-line no-restricted-globals
		const BetterSqlite3 = require("better-sqlite3");
		const db = new BetterSqlite3(path);
		db.pragma("journal_mode = WAL");
		db.pragma("foreign_keys = ON");
		db.pragma("busy_timeout = 5000");
		db.pragma("cache_size = -256");
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

function extractRawPropertyValue(value: unknown, path: string): unknown {
	if (path === "") return value;
	const parts = path.split(".");
	let current: unknown = value;
	for (const part of parts) {
		if (current == null) return undefined;
		current = (current as Record<string, unknown>)[part];
	}
	return current;
}

function buildRangeConditions(
	range?: KeyRangeSpec,
	prefix = "",
): {sql: string; params: any[]} {
	if (!range) return {sql: "", params: []};
	let sql = "";
	const params: any[] = [];
	const col = prefix ? `${prefix}.key` : "key";
	if (range.lower) {
		sql += ` AND ${col} ${range.lowerOpen ? ">" : ">="} ?`;
		params.push(Buffer.from(range.lower));
	}
	if (range.upper) {
		sql += ` AND ${col} ${range.upperOpen ? "<" : "<="} ?`;
		params.push(Buffer.from(range.upper));
	}
	return {sql, params};
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
// Live-querying cursors (re-query SQLite on each continue())
// ============================================================================

class SQLiteCursor implements IDBBackendCursor {
	#db: SQLiteDB;
	#storeId: number;
	#range: KeyRangeSpec | undefined;
	#direction: CursorDirection;
	#currentKey: Uint8Array;
	#currentValue: Uint8Array;

	constructor(
		db: SQLiteDB,
		storeId: number,
		range: KeyRangeSpec | undefined,
		direction: CursorDirection,
		initialKey: Uint8Array,
		initialValue: Uint8Array,
	) {
		this.#db = db;
		this.#storeId = storeId;
		this.#range = range;
		this.#direction = direction;
		this.#currentKey = initialKey;
		this.#currentValue = initialValue;
	}

	get primaryKey(): EncodedKey {
		return this.#currentKey;
	}
	get key(): EncodedKey {
		return this.#currentKey;
	}
	get value(): Uint8Array {
		return this.#currentValue;
	}

	continue(): boolean {
		const forward =
			this.#direction === "next" || this.#direction === "nextunique";
		const cmpOp = forward ? ">" : "<";
		const order = forward ? "ASC" : "DESC";

		let rangeSql = "";
		const params: any[] = [this.#storeId, Buffer.from(this.#currentKey)];
		rangeSql += ` AND key ${cmpOp} ?`;
		if (this.#range) {
			const {sql, params: rp} = buildRangeConditions(this.#range);
			rangeSql += sql;
			params.push(...rp);
		}

		const row = this.#db
			.prepare(
				`SELECT key, value FROM _idb_records WHERE store_id = ?${rangeSql} ORDER BY key ${order} LIMIT 1`,
			)
			.get(...params) as any;

		if (!row) return false;
		this.#currentKey = new Uint8Array(row.key);
		this.#currentValue = new Uint8Array(row.value);
		return true;
	}
}

class SQLiteIndexCursor implements IDBBackendCursor {
	#db: SQLiteDB;
	#storeId: number;
	#indexId: number;
	#range: KeyRangeSpec | undefined;
	#direction: CursorDirection;
	#currentKey: Uint8Array;
	#currentPrimaryKey: Uint8Array;
	#currentValue: Uint8Array;

	constructor(
		db: SQLiteDB,
		storeId: number,
		indexId: number,
		range: KeyRangeSpec | undefined,
		direction: CursorDirection,
		initialKey: Uint8Array,
		initialPrimaryKey: Uint8Array,
		initialValue: Uint8Array,
	) {
		this.#db = db;
		this.#storeId = storeId;
		this.#indexId = indexId;
		this.#range = range;
		this.#direction = direction;
		this.#currentKey = initialKey;
		this.#currentPrimaryKey = initialPrimaryKey;
		this.#currentValue = initialValue;
	}

	get primaryKey(): EncodedKey {
		return this.#currentPrimaryKey;
	}
	get key(): EncodedKey {
		return this.#currentKey;
	}
	get value(): Uint8Array {
		return this.#currentValue;
	}

	continue(): boolean {
		const forward =
			this.#direction === "next" || this.#direction === "nextunique";
		const unique =
			this.#direction === "nextunique" || this.#direction === "prevunique";
		const order = forward ? "ASC" : "DESC";

		let positionSql: string;
		const params: any[] = [this.#storeId, this.#indexId];

		if (unique) {
			// For unique directions, skip to the next/prev distinct key
			const cmpOp = forward ? ">" : "<";
			positionSql = ` AND ie.key ${cmpOp} ?`;
			params.push(Buffer.from(this.#currentKey));
		} else {
			// For non-unique, advance past (key, primaryKey) pair
			if (forward) {
				positionSql = ` AND (ie.key > ? OR (ie.key = ? AND ie.primary_key > ?))`;
			} else {
				positionSql = ` AND (ie.key < ? OR (ie.key = ? AND ie.primary_key < ?))`;
			}
			params.push(
				Buffer.from(this.#currentKey),
				Buffer.from(this.#currentKey),
				Buffer.from(this.#currentPrimaryKey),
			);
		}

		let rangeSql = "";
		if (this.#range) {
			const {sql, params: rp} = buildRangeConditions(this.#range, "ie");
			rangeSql = sql;
			params.push(...rp);
		}

		// For prevunique, use ASC primary key to get the first record per key
		const pkOrder =
			this.#direction === "prevunique" ? "ASC" : order;
		const row = this.#db
			.prepare(
				`SELECT ie.key, ie.primary_key, r.value FROM _idb_index_entries ie
				JOIN _idb_records r ON r.store_id = ? AND r.key = ie.primary_key
				WHERE ie.index_id = ?${positionSql}${rangeSql}
				ORDER BY ie.key ${order}, ie.primary_key ${pkOrder} LIMIT 1`,
			)
			.get(...params) as any;

		if (!row) return false;
		this.#currentKey = new Uint8Array(row.key);
		this.#currentPrimaryKey = new Uint8Array(row.primary_key);
		this.#currentValue = new Uint8Array(row.value);
		return true;
	}
}

// ============================================================================
// SQLite Transaction
// ============================================================================

class SQLiteTransaction implements IDBBackendTransaction {
	#db: SQLiteDB;
	#readonly: boolean;
	#aborted: boolean;
	#storeIds: Map<string, number>;
	#indexIds: Map<string, number>;
	#indexMeta: Map<string, IndexMeta>;

	constructor(
		db: SQLiteDB,
		mode: "readonly" | "readwrite" | "versionchange",
	) {
		this.#db = db;
		this.#readonly = mode === "readonly";
		this.#aborted = false;
		this.#storeIds = new Map();
		this.#indexIds = new Map();
		this.#indexMeta = new Map();

		// Readonly: no SQL-level transaction needed (reads see committed state).
		// Readwrite/versionchange: BEGIN IMMEDIATE for write serialization.
		if (!this.#readonly) {
			db.exec("BEGIN IMMEDIATE");
		}
		this.#loadCaches();
	}

	#loadCaches(): void {
		const stores = this.#db
			.prepare("SELECT id, name FROM _idb_stores")
			.all();
		for (const s of stores) {
			this.#storeIds.set(s.name, s.id);
		}

		const indexes = this.#db
			.prepare(
				'SELECT id, name, store_name, key_path, "unique", multi_entry FROM _idb_indexes',
			)
			.all();
		for (const idx of indexes) {
			const key = `${idx.store_name}/${idx.name}`;
			this.#indexIds.set(key, idx.id);
			this.#indexMeta.set(key, {
				name: idx.name,
				storeName: idx.store_name,
				keyPath: JSON.parse(idx.key_path),
				unique: Boolean(idx.unique),
				multiEntry: Boolean(idx.multi_entry),
			});
		}
	}

	#getStoreId(name: string): number {
		const id = this.#storeIds.get(name);
		if (id === undefined) {
			throw new Error(`Store "${name}" not found`);
		}
		return id;
	}

	#getIndexId(storeName: string, indexName: string): number {
		const id = this.#indexIds.get(`${storeName}/${indexName}`);
		if (id === undefined) {
			throw new Error(
				`Index "${indexName}" not found on store "${storeName}"`,
			);
		}
		return id;
	}

	// ---- Schema operations ----

	createObjectStore(meta: ObjectStoreMeta): void {
		this.#db
			.prepare(
				"INSERT INTO _idb_stores (name, key_path, auto_increment, current_key) VALUES (?, ?, ?, ?)",
			)
			.run(
				meta.name,
				JSON.stringify(meta.keyPath),
				meta.autoIncrement ? 1 : 0,
				0,
			);
		const row = this.#db
			.prepare("SELECT last_insert_rowid() as id")
			.get();
		this.#storeIds.set(meta.name, row.id);
	}

	deleteObjectStore(name: string): void {
		const storeId = this.#getStoreId(name);
		// CASCADE handles _idb_records, _idb_indexes, _idb_index_entries
		this.#db
			.prepare("DELETE FROM _idb_stores WHERE id = ?")
			.run(storeId);
		this.#storeIds.delete(name);
		for (const [key] of this.#indexIds) {
			if (key.startsWith(name + "/")) {
				this.#indexIds.delete(key);
				this.#indexMeta.delete(key);
			}
		}
	}

	renameObjectStore(oldName: string, newName: string): void {
		const storeId = this.#storeIds.get(oldName);
		if (storeId === undefined) return;
		this.#db
			.prepare("UPDATE _idb_stores SET name = ? WHERE id = ?")
			.run(newName, storeId);
		this.#db
			.prepare("UPDATE _idb_indexes SET store_name = ? WHERE store_id = ?")
			.run(newName, storeId);
		this.#storeIds.delete(oldName);
		this.#storeIds.set(newName, storeId);
		for (const [key, indexId] of [...this.#indexIds]) {
			if (key.startsWith(oldName + "/")) {
				const indexName = key.slice(oldName.length + 1);
				const newKey = `${newName}/${indexName}`;
				this.#indexIds.delete(key);
				this.#indexIds.set(newKey, indexId);
				const meta = this.#indexMeta.get(key)!;
				this.#indexMeta.delete(key);
				this.#indexMeta.set(newKey, {...meta, storeName: newName});
			}
		}
	}

	createIndex(meta: IndexMeta): void {
		const storeId = this.#getStoreId(meta.storeName);
		this.#db
			.prepare(
				'INSERT INTO _idb_indexes (store_id, name, store_name, key_path, "unique", multi_entry) VALUES (?, ?, ?, ?, ?, ?)',
			)
			.run(
				storeId,
				meta.name,
				meta.storeName,
				JSON.stringify(meta.keyPath),
				meta.unique ? 1 : 0,
				meta.multiEntry ? 1 : 0,
			);
		const row = this.#db
			.prepare("SELECT last_insert_rowid() as id")
			.get();
		const indexId = row.id;
		const key = `${meta.storeName}/${meta.name}`;
		this.#indexIds.set(key, indexId);
		this.#indexMeta.set(key, meta);

		// Populate from existing records
		const records = this.#db
			.prepare("SELECT key, value FROM _idb_records WHERE store_id = ?")
			.all(storeId);
		for (const record of records) {
			this.#addToIndex(
				meta,
				indexId,
				new Uint8Array(record.key),
				new Uint8Array(record.value),
			);
		}
	}

	deleteIndex(storeName: string, indexName: string): void {
		const key = `${storeName}/${indexName}`;
		const indexId = this.#indexIds.get(key);
		if (indexId !== undefined) {
			// CASCADE handles _idb_index_entries
			this.#db
				.prepare("DELETE FROM _idb_indexes WHERE id = ?")
				.run(indexId);
			this.#indexIds.delete(key);
			this.#indexMeta.delete(key);
		}
	}

	renameIndex(storeName: string, oldName: string, newName: string): void {
		const oldKey = `${storeName}/${oldName}`;
		const indexId = this.#indexIds.get(oldKey);
		if (indexId === undefined) return;
		this.#db
			.prepare("UPDATE _idb_indexes SET name = ? WHERE id = ?")
			.run(newName, indexId);
		const newKey = `${storeName}/${newName}`;
		this.#indexIds.delete(oldKey);
		this.#indexIds.set(newKey, indexId);
		const meta = this.#indexMeta.get(oldKey)!;
		this.#indexMeta.delete(oldKey);
		this.#indexMeta.set(newKey, {...meta, name: newName});
	}

	// ---- Data operations ----

	get(storeName: string, key: EncodedKey): StoredRecord | undefined {
		const storeId = this.#getStoreId(storeName);
		const row = this.#db
			.prepare(
				"SELECT key, value FROM _idb_records WHERE store_id = ? AND key = ?",
			)
			.get(storeId, Buffer.from(key));
		if (!row) return undefined;
		return {key: new Uint8Array(row.key), value: new Uint8Array(row.value)};
	}

	getAll(
		storeName: string,
		range?: KeyRangeSpec,
		count?: number,
	): StoredRecord[] {
		const storeId = this.#getStoreId(storeName);
		const {sql: rangeSql, params: rangeParams} =
			buildRangeConditions(range);
		const limit = count !== undefined ? ` LIMIT ${count}` : "";
		const rows = this.#db
			.prepare(
				`SELECT key, value FROM _idb_records WHERE store_id = ?${rangeSql} ORDER BY key ASC${limit}`,
			)
			.all(storeId, ...rangeParams);
		return rows.map((row: any) => ({
			key: new Uint8Array(row.key),
			value: new Uint8Array(row.value),
		}));
	}

	getAllKeys(
		storeName: string,
		range?: KeyRangeSpec,
		count?: number,
	): EncodedKey[] {
		const storeId = this.#getStoreId(storeName);
		const {sql: rangeSql, params: rangeParams} =
			buildRangeConditions(range);
		const limit = count !== undefined ? ` LIMIT ${count}` : "";
		const rows = this.#db
			.prepare(
				`SELECT key FROM _idb_records WHERE store_id = ?${rangeSql} ORDER BY key ASC${limit}`,
			)
			.all(storeId, ...rangeParams);
		return rows.map((row: any) => new Uint8Array(row.key));
	}

	put(storeName: string, key: EncodedKey, value: Uint8Array): void {
		const storeId = this.#getStoreId(storeName);
		this.#db.exec("SAVEPOINT put_op");
		try {
			this.#removeFromIndexes(storeId, key);
			this.#db
				.prepare(
					"INSERT OR REPLACE INTO _idb_records (store_id, key, value) VALUES (?, ?, ?)",
				)
				.run(storeId, Buffer.from(key), Buffer.from(value));
			this.#addToAllIndexes(storeName, storeId, key, value);
			this.#db.exec("RELEASE put_op");
		} catch (e) {
			this.#db.exec("ROLLBACK TO put_op");
			this.#db.exec("RELEASE put_op");
			throw e;
		}
	}

	add(storeName: string, key: EncodedKey, value: Uint8Array): void {
		const storeId = this.#getStoreId(storeName);
		const existing = this.#db
			.prepare(
				"SELECT 1 FROM _idb_records WHERE store_id = ? AND key = ?",
			)
			.get(storeId, Buffer.from(key));
		if (existing) {
			throw ConstraintError(
				`Key already exists in object store "${storeName}"`,
			);
		}
		this.#db.exec("SAVEPOINT add_op");
		try {
			this.#db
				.prepare(
					"INSERT INTO _idb_records (store_id, key, value) VALUES (?, ?, ?)",
				)
				.run(storeId, Buffer.from(key), Buffer.from(value));
			this.#addToAllIndexes(storeName, storeId, key, value);
			this.#db.exec("RELEASE add_op");
		} catch (e) {
			this.#db.exec("ROLLBACK TO add_op");
			this.#db.exec("RELEASE add_op");
			throw e;
		}
	}

	delete(storeName: string, range: KeyRangeSpec): void {
		const storeId = this.#getStoreId(storeName);
		const {sql: rangeSql, params: rangeParams} =
			buildRangeConditions(range);
		// Delete index entries for matching records
		this.#db
			.prepare(
				`DELETE FROM _idb_index_entries WHERE index_id IN (
				SELECT id FROM _idb_indexes WHERE store_id = ?
			) AND primary_key IN (
				SELECT key FROM _idb_records WHERE store_id = ?${rangeSql}
			)`,
			)
			.run(storeId, storeId, ...rangeParams);
		// Delete records
		this.#db
			.prepare(
				`DELETE FROM _idb_records WHERE store_id = ?${rangeSql}`,
			)
			.run(storeId, ...rangeParams);
	}

	clear(storeName: string): void {
		const storeId = this.#getStoreId(storeName);
		this.#db
			.prepare(
				`DELETE FROM _idb_index_entries WHERE index_id IN (
				SELECT id FROM _idb_indexes WHERE store_id = ?
			)`,
			)
			.run(storeId);
		this.#db
			.prepare("DELETE FROM _idb_records WHERE store_id = ?")
			.run(storeId);
	}

	count(storeName: string, range?: KeyRangeSpec): number {
		const storeId = this.#getStoreId(storeName);
		const {sql: rangeSql, params: rangeParams} =
			buildRangeConditions(range);
		const row = this.#db
			.prepare(
				`SELECT COUNT(*) as count FROM _idb_records WHERE store_id = ?${rangeSql}`,
			)
			.get(storeId, ...rangeParams);
		return row?.count ?? 0;
	}

	// ---- Index operations ----

	indexGet(
		storeName: string,
		indexName: string,
		key: EncodedKey,
	): StoredRecord | undefined {
		const storeId = this.#getStoreId(storeName);
		const indexId = this.#getIndexId(storeName, indexName);
		const row = this.#db
			.prepare(
				`SELECT ie.primary_key, r.value FROM _idb_index_entries ie
				JOIN _idb_records r ON r.store_id = ? AND r.key = ie.primary_key
				WHERE ie.index_id = ? AND ie.key = ?
				ORDER BY ie.primary_key ASC LIMIT 1`,
			)
			.get(storeId, indexId, Buffer.from(key));
		if (!row) return undefined;
		return {
			key: new Uint8Array(row.primary_key),
			value: new Uint8Array(row.value),
		};
	}

	indexGetAll(
		storeName: string,
		indexName: string,
		range?: KeyRangeSpec,
		count?: number,
	): StoredRecord[] {
		const storeId = this.#getStoreId(storeName);
		const indexId = this.#getIndexId(storeName, indexName);
		const {sql: rangeSql, params: rangeParams} = buildRangeConditions(
			range,
			"ie",
		);
		const limit = count !== undefined ? ` LIMIT ${count}` : "";
		const rows = this.#db
			.prepare(
				`SELECT ie.primary_key, r.value FROM _idb_index_entries ie
				JOIN _idb_records r ON r.store_id = ? AND r.key = ie.primary_key
				WHERE ie.index_id = ?${rangeSql}
				ORDER BY ie.key ASC, ie.primary_key ASC${limit}`,
			)
			.all(storeId, indexId, ...rangeParams);
		return rows.map((row: any) => ({
			key: new Uint8Array(row.primary_key),
			value: new Uint8Array(row.value),
		}));
	}

	indexGetAllKeys(
		storeName: string,
		indexName: string,
		range?: KeyRangeSpec,
		count?: number,
	): EncodedKey[] {
		const indexId = this.#getIndexId(storeName, indexName);
		const {sql: rangeSql, params: rangeParams} =
			buildRangeConditions(range);
		const limit = count !== undefined ? ` LIMIT ${count}` : "";
		const rows = this.#db
			.prepare(
				`SELECT primary_key FROM _idb_index_entries WHERE index_id = ?${rangeSql}
				ORDER BY key ASC, primary_key ASC${limit}`,
			)
			.all(indexId, ...rangeParams);
		return rows.map((row: any) => new Uint8Array(row.primary_key));
	}

	indexCount(
		storeName: string,
		indexName: string,
		range?: KeyRangeSpec,
	): number {
		const indexId = this.#getIndexId(storeName, indexName);
		const {sql: rangeSql, params: rangeParams} =
			buildRangeConditions(range);
		const row = this.#db
			.prepare(
				`SELECT COUNT(*) as count FROM _idb_index_entries WHERE index_id = ?${rangeSql}`,
			)
			.get(indexId, ...rangeParams);
		return row?.count ?? 0;
	}

	// ---- Cursors ----

	openCursor(
		storeName: string,
		range?: KeyRangeSpec,
		direction: CursorDirection = "next",
	): IDBBackendCursor | null {
		const storeId = this.#getStoreId(storeName);
		const {sql: rangeSql, params: rangeParams} =
			buildRangeConditions(range);
		const order = directionToOrder(direction);
		const row = this.#db
			.prepare(
				`SELECT key, value FROM _idb_records WHERE store_id = ?${rangeSql} ORDER BY key ${order} LIMIT 1`,
			)
			.get(storeId, ...rangeParams) as any;

		if (!row) return null;

		return new SQLiteCursor(
			this.#db,
			storeId,
			range,
			direction,
			new Uint8Array(row.key),
			new Uint8Array(row.value),
		);
	}

	openKeyCursor(
		storeName: string,
		range?: KeyRangeSpec,
		direction: CursorDirection = "next",
	): IDBBackendCursor | null {
		return this.openCursor(storeName, range, direction);
	}

	openIndexCursor(
		storeName: string,
		indexName: string,
		range?: KeyRangeSpec,
		direction: CursorDirection = "next",
	): IDBBackendCursor | null {
		const storeId = this.#getStoreId(storeName);
		const indexId = this.#getIndexId(storeName, indexName);
		const order = directionToOrder(direction);
		const {sql: rangeSql, params: rangeParams} = buildRangeConditions(
			range,
			"ie",
		);

		// For prevunique, use ASC primary key to get the first record per key
		const pkOrder = direction === "prevunique" ? "ASC" : order;
		const row = this.#db
			.prepare(
				`SELECT ie.key, ie.primary_key, r.value FROM _idb_index_entries ie
				JOIN _idb_records r ON r.store_id = ? AND r.key = ie.primary_key
				WHERE ie.index_id = ?${rangeSql}
				ORDER BY ie.key ${order}, ie.primary_key ${pkOrder} LIMIT 1`,
			)
			.get(storeId, indexId, ...rangeParams) as any;

		if (!row) return null;

		return new SQLiteIndexCursor(
			this.#db,
			storeId,
			indexId,
			range,
			direction,
			new Uint8Array(row.key),
			new Uint8Array(row.primary_key),
			new Uint8Array(row.value),
		);
	}

	openIndexKeyCursor(
		storeName: string,
		indexName: string,
		range?: KeyRangeSpec,
		direction: CursorDirection = "next",
	): IDBBackendCursor | null {
		return this.openIndexCursor(storeName, indexName, range, direction);
	}

	// ---- Auto-increment ----

	nextAutoIncrementKey(storeName: string): number {
		const storeId = this.#getStoreId(storeName);
		const row = this.#db
			.prepare("SELECT current_key FROM _idb_stores WHERE id = ?")
			.get(storeId);
		if (row && row.current_key >= 2 ** 53) {
			throw ConstraintError(
				"Key generator has reached its maximum value",
			);
		}
		this.#db
			.prepare(
				"UPDATE _idb_stores SET current_key = current_key + 1 WHERE id = ?",
			)
			.run(storeId);
		const updated = this.#db
			.prepare("SELECT current_key FROM _idb_stores WHERE id = ?")
			.get(storeId);
		return updated.current_key;
	}

	maybeUpdateKeyGenerator(storeName: string, key: number): void {
		const storeId = this.#getStoreId(storeName);
		const newValue = Math.min(Math.floor(key), 2 ** 53);
		this.#db
			.prepare(
				"UPDATE _idb_stores SET current_key = ? WHERE id = ? AND current_key < ?",
			)
			.run(newValue, storeId, newValue);
	}

	getAutoIncrementCurrent(storeName: string): number {
		const storeId = this.#getStoreId(storeName);
		const row = this.#db
			.prepare("SELECT current_key FROM _idb_stores WHERE id = ?")
			.get(storeId);
		return row?.current_key ?? 0;
	}

	setAutoIncrementCurrent(storeName: string, value: number): void {
		const storeId = this.#getStoreId(storeName);
		this.#db
			.prepare("UPDATE _idb_stores SET current_key = ? WHERE id = ?")
			.run(value, storeId);
	}

	// ---- Lifecycle ----

	commit(): void {
		if (!this.#aborted && !this.#readonly) {
			this.#db.exec("COMMIT");
		}
	}

	abort(): void {
		this.#aborted = true;
		if (!this.#readonly) {
			this.#db.exec("ROLLBACK");
		}
	}

	// ---- Private helpers ----

	#removeFromIndexes(storeId: number, primaryKey: Uint8Array): void {
		this.#db
			.prepare(
				`DELETE FROM _idb_index_entries WHERE index_id IN (
				SELECT id FROM _idb_indexes WHERE store_id = ?
			) AND primary_key = ?`,
			)
			.run(storeId, Buffer.from(primaryKey));
	}

	#addToAllIndexes(
		storeName: string,
		_storeId: number,
		primaryKey: Uint8Array,
		value: Uint8Array,
	): void {
		for (const [key, meta] of this.#indexMeta) {
			if (key.startsWith(storeName + "/")) {
				const indexId = this.#indexIds.get(key)!;
				this.#addToIndex(meta, indexId, primaryKey, value);
			}
		}
	}

	#addToIndex(
		meta: IndexMeta,
		indexId: number,
		primaryKey: Uint8Array,
		value: Uint8Array,
	): void {
		let decodedValue: unknown;
		try {
			decodedValue = decodeValue(value);
		} catch (_error) {
			return;
		}

		let indexKeys: Uint8Array[];
		try {
			if (meta.multiEntry && typeof meta.keyPath === "string") {
				const rawValue = extractRawPropertyValue(
					decodedValue,
					meta.keyPath,
				);
				if (rawValue === undefined) return;
				if (Array.isArray(rawValue)) {
					indexKeys = [];
					const seen = new Set<string>();
					for (const item of rawValue) {
						try {
							const validated = validateKey(item);
							const encoded = encodeKey(validated);
							const encodedStr = encoded.join(",");
							if (!seen.has(encodedStr)) {
								seen.add(encodedStr);
								indexKeys.push(encoded);
							}
						} catch (_error) {
							// Skip invalid keys per spec
						}
					}
					if (indexKeys.length === 0) return;
				} else {
					try {
						const validated = validateKey(rawValue);
						indexKeys = [encodeKey(validated)];
					} catch (_error) {
						return;
					}
				}
			} else {
				const extracted = extractKeyFromValue(
					decodedValue,
					meta.keyPath,
				);
				indexKeys = [encodeKey(extracted)];
			}
		} catch (_error) {
			return;
		}

		for (const indexKey of indexKeys) {
			if (meta.unique) {
				const existing = this.#db
					.prepare(
						"SELECT primary_key FROM _idb_index_entries WHERE index_id = ? AND key = ?",
					)
					.get(indexId, Buffer.from(indexKey));
				if (existing) {
					throw ConstraintError(
						`Unique constraint violated for index "${meta.name}"`,
					);
				}
			}
			this.#db
				.prepare(
					"INSERT OR IGNORE INTO _idb_index_entries (index_id, key, primary_key) VALUES (?, ?, ?)",
				)
				.run(
					indexId,
					Buffer.from(indexKey),
					Buffer.from(primaryKey),
				);
		}
	}
}

// ============================================================================
// SQLite Connection
// ============================================================================

class SQLiteConnection implements IDBBackendConnection {
	#db: SQLiteDB;
	#backend: SQLiteBackend;
	#name: string;
	#closed: boolean;

	constructor(db: SQLiteDB, backend: SQLiteBackend, name: string) {
		this.#db = db;
		this.#backend = backend;
		this.#name = name;
		this.#closed = false;
	}

	getMetadata(): DatabaseMeta {
		const versionRow = this.#db
			.prepare("SELECT value FROM _idb_meta WHERE key = 'version'")
			.get();
		const version = versionRow ? parseInt(versionRow.value, 10) : 0;

		const objectStores = new Map<string, ObjectStoreMeta>();
		const storeRows = this.#db
			.prepare(
				"SELECT name, key_path, auto_increment FROM _idb_stores",
			)
			.all();
		for (const row of storeRows) {
			objectStores.set(row.name, {
				name: row.name,
				keyPath: JSON.parse(row.key_path),
				autoIncrement: Boolean(row.auto_increment),
			});
		}

		const indexes = new Map<string, IndexMeta[]>();
		const indexRows = this.#db
			.prepare(
				'SELECT name, store_name, key_path, "unique", multi_entry FROM _idb_indexes',
			)
			.all();
		for (const row of indexRows) {
			const meta: IndexMeta = {
				name: row.name,
				storeName: row.store_name,
				keyPath: JSON.parse(row.key_path),
				unique: Boolean(row.unique),
				multiEntry: Boolean(row.multi_entry),
			};
			if (!indexes.has(row.store_name)) {
				indexes.set(row.store_name, []);
			}
			indexes.get(row.store_name)!.push(meta);
		}

		return {name: "", version, objectStores, indexes};
	}

	setVersion(version: number): void {
		this.#db
			.prepare(
				"INSERT OR REPLACE INTO _idb_meta (key, value) VALUES ('version', ?)",
			)
			.run(String(version));
		this.#db
			.prepare(
				"INSERT OR REPLACE INTO _idb_meta (key, value) VALUES ('committed_version', ?)",
			)
			.run(String(version));
	}

	beginTransaction(
		_storeNames: string[],
		mode: "readonly" | "readwrite" | "versionchange",
	): IDBBackendTransaction {
		return new SQLiteTransaction(this.#db, mode);
	}

	close(): void {
		if (!this.#closed) {
			this.#closed = true;
			this.#backend._releaseHandle(this.#name);
		}
	}
}

// ============================================================================
// SQLite Backend
// ============================================================================

export class SQLiteBackend implements IDBBackend {
	#basePath: string;
	#handles: Map<string, SQLiteDB>;
	#refcounts: Map<string, number>;
	static MAX_HANDLES = 50;

	constructor(basePath: string) {
		this.#basePath = basePath;
		this.#handles = new Map();
		this.#refcounts = new Map();
		mkdirSync(basePath, {recursive: true});
	}

	open(name: string, _version: number): IDBBackendConnection {
		const dbPath = this.#dbPath(name);
		let db = this.#handles.get(name);
		if (!db) {
			this.#evictIfNeeded();
			db = openSQLite(dbPath);
			this.#initSchema(db);
			this.#handles.set(name, db);
		}
		this.#refcounts.set(name, (this.#refcounts.get(name) ?? 0) + 1);
		db.prepare(
			"INSERT OR REPLACE INTO _idb_meta (key, value) VALUES ('name', ?)",
		).run(name);
		return new SQLiteConnection(db, this, name);
	}

	/** @internal Called by SQLiteConnection.close() to release a handle. */
	_releaseHandle(name: string): void {
		const count = (this.#refcounts.get(name) ?? 1) - 1;
		if (count <= 0) {
			this.#refcounts.delete(name);
			const db = this.#handles.get(name);
			if (db) {
				db.close();
				this.#handles.delete(name);
			}
		} else {
			this.#refcounts.set(name, count);
		}
	}

	/** Close idle handles (refcount 0) when at capacity. */
	#evictIfNeeded(): void {
		if (this.#handles.size < SQLiteBackend.MAX_HANDLES) return;
		for (const [name, db] of this.#handles) {
			if ((this.#refcounts.get(name) ?? 0) <= 0) {
				db.close();
				this.#handles.delete(name);
				this.#refcounts.delete(name);
				if (this.#handles.size < SQLiteBackend.MAX_HANDLES) return;
			}
		}
	}

	deleteDatabase(name: string): void {
		// Close shared handle if open
		const db = this.#handles.get(name);
		if (db) {
			db.close();
			this.#handles.delete(name);
		}
		const dbPath = this.#dbPath(name);
		for (const suffix of ["", "-wal", "-shm", "-journal"]) {
			try {
				unlinkSync(dbPath + suffix);
			} catch (_error) {
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
					// Reuse cached handle if available
					const dbName = decodeURIComponent(file.slice(0, -7));
					const cached = this.#handles.get(dbName);
					if (cached) {
						const versionRow = cached
							.prepare(
								"SELECT value FROM _idb_meta WHERE key = 'committed_version'",
							)
							.get();
						if (versionRow) {
							const version = parseInt(versionRow.value, 10);
							if (version > 0) {
								const nameRow = cached
									.prepare(
										"SELECT value FROM _idb_meta WHERE key = 'name'",
									)
									.get();
								results.push({
									name: nameRow?.value ?? dbName,
									version,
								});
							}
						}
						continue;
					}
					const db = openSQLite(dbPath);
					try {
						const versionRow = db
							.prepare(
								"SELECT value FROM _idb_meta WHERE key = 'committed_version'",
							)
							.get();
						if (versionRow) {
							const version = parseInt(
								versionRow.value,
								10,
							);
							if (version > 0) {
								const nameRow = db
									.prepare(
										"SELECT value FROM _idb_meta WHERE key = 'name'",
									)
									.get();
								results.push({
									name: nameRow?.value ?? dbName,
									version,
								});
							}
						}
					} finally {
						db.close();
					}
				} catch (_error) {
					// Skip corrupt/unreadable databases
				}
			}
		}

		return results;
	}

	close(name: string): void {
		const db = this.#handles.get(name);
		if (db) {
			db.close();
			this.#handles.delete(name);
		}
	}

	#dbPath(name: string): string {
		return join(this.#basePath, `${encodeURIComponent(name)}.sqlite`);
	}

	#initSchema(db: SQLiteDB): void {
		db.exec(`CREATE TABLE IF NOT EXISTS _idb_meta (
			key TEXT PRIMARY KEY,
			value TEXT
		)`);
		db.exec(`CREATE TABLE IF NOT EXISTS _idb_stores (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL UNIQUE,
			key_path TEXT NOT NULL,
			auto_increment INTEGER NOT NULL DEFAULT 0,
			current_key REAL NOT NULL DEFAULT 0
		)`);
		db.exec(`CREATE TABLE IF NOT EXISTS _idb_indexes (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			store_id INTEGER NOT NULL REFERENCES _idb_stores(id) ON DELETE CASCADE,
			name TEXT NOT NULL,
			store_name TEXT NOT NULL,
			key_path TEXT NOT NULL,
			"unique" INTEGER NOT NULL DEFAULT 0,
			multi_entry INTEGER NOT NULL DEFAULT 0,
			UNIQUE(store_id, name)
		)`);
		db.exec(`CREATE TABLE IF NOT EXISTS _idb_records (
			store_id INTEGER NOT NULL REFERENCES _idb_stores(id) ON DELETE CASCADE,
			key BLOB NOT NULL,
			value BLOB NOT NULL,
			PRIMARY KEY (store_id, key)
		)`);
		db.exec(`CREATE TABLE IF NOT EXISTS _idb_index_entries (
			index_id INTEGER NOT NULL REFERENCES _idb_indexes(id) ON DELETE CASCADE,
			key BLOB NOT NULL,
			primary_key BLOB NOT NULL,
			PRIMARY KEY (index_id, key, primary_key)
		)`);
	}
}
