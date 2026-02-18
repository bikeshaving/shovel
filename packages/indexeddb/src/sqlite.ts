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

import {encodeKey, validateKey, extractKeyFromValue} from "./key.js";
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
// SQLite driver abstraction (bun:sqlite / better-sqlite3)
// ============================================================================

interface SQLiteDB {
	exec(sql: string): void;
	query(sql: string): SQLiteStatement;
	close(): void;
}

interface SQLiteStatement {
	get(...params: any[]): any;
	all(...params: any[]): any[];
	run(...params: any[]): any;
}

let _DatabaseCtor: new (path: string) => any;
let _usePrepare = false;
try {
	_DatabaseCtor = (await import("bun:sqlite")).Database;
} catch (_) {
	// @ts-expect-error -- better-sqlite3 is an optional peer dependency
	_DatabaseCtor = (await import("better-sqlite3")).default;
	_usePrepare = true;
}

function openDatabase(path: string): SQLiteDB {
	const db = new _DatabaseCtor(path);
	if (_usePrepare) {
		// better-sqlite3: .prepare() is the cached-statement API
		db.query = db.prepare.bind(db);
	}
	db.exec(
		"PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000; PRAGMA cache_size=-2000",
	);
	return db as SQLiteDB;
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
		params.push(range.lower);
	}
	if (range.upper) {
		sql += ` AND ${col} ${range.upperOpen ? "<" : "<="} ?`;
		params.push(range.upper);
	}
	return {sql, params};
}

// ---- Name encoding for SQLite TEXT columns ----
// Lone UTF-16 surrogates can't survive UTF-8 roundtripping through SQLite.
// We detect them and hex-encode the entire string with a \x01 prefix.

function hasLoneSurrogate(s: string): boolean {
	for (let i = 0; i < s.length; i++) {
		const code = s.charCodeAt(i);
		if (code >= 0xd800 && code <= 0xdbff) {
			const next = s.charCodeAt(i + 1);
			if (next >= 0xdc00 && next <= 0xdfff) {
				i++; // properly paired, skip low surrogate
			} else {
				return true; // lone high surrogate
			}
		} else if (code >= 0xdc00 && code <= 0xdfff) {
			return true; // lone low surrogate
		}
	}
	return false;
}

function encodeName(name: string): string {
	if (!hasLoneSurrogate(name)) return name;
	let hex = "";
	for (let i = 0; i < name.length; i++) {
		hex += name.charCodeAt(i).toString(16).padStart(4, "0");
	}
	return "\x01" + hex;
}

function decodeName(stored: string): string {
	if (stored.charCodeAt(0) !== 1) return stored;
	const hex = stored.slice(1);
	let result = "";
	for (let i = 0; i < hex.length; i += 4) {
		result += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
	}
	return result;
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
// Hybrid cursors: snapshot when clean, re-query when mutated
// ============================================================================

/**
 * Shared generation counter for a transaction. Cursors compare their snapshot
 * generation against this to decide whether to use the fast snapshot path or
 * the slow re-query path.
 */
interface GenerationRef {
	value: number;
}

/** Batch size for cursor snapshots — balances memory vs. query overhead. */
const CURSOR_BATCH_SIZE = 100;

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

class HybridCursor implements IDBBackendCursor {
	#db: SQLiteDB;
	#storeId: number;
	#range: KeyRangeSpec | undefined;
	#forward: boolean;
	#generation: GenerationRef;
	#snapshotGen: number;
	#snapshot: Array<{key: Uint8Array; value: Uint8Array}>;
	#snapshotIdx: number;
	#currentKey: Uint8Array;
	#currentValue: Uint8Array;
	#exhausted: boolean;

	constructor(
		db: SQLiteDB,
		storeId: number,
		range: KeyRangeSpec | undefined,
		direction: CursorDirection,
		generation: GenerationRef,
		snapshot: Array<{key: Uint8Array; value: Uint8Array}>,
		exhausted: boolean,
	) {
		this.#db = db;
		this.#storeId = storeId;
		this.#range = range;
		this.#forward = direction === "next" || direction === "nextunique";
		this.#generation = generation;
		this.#snapshotGen = generation.value;
		this.#snapshot = snapshot;
		this.#snapshotIdx = 0;
		this.#currentKey = snapshot[0].key;
		this.#currentValue = snapshot[0].value;
		this.#exhausted = exhausted;
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
		if (this.#generation.value === this.#snapshotGen) {
			// Fast path: no mutations, use snapshot
			this.#snapshotIdx++;
			if (this.#snapshotIdx < this.#snapshot.length) {
				this.#currentKey = this.#snapshot[this.#snapshotIdx].key;
				this.#currentValue = this.#snapshot[this.#snapshotIdx].value;
				return true;
			}
			// Batch exhausted — load next batch if more records exist
			if (!this.#exhausted) {
				this.#loadBatch();
				if (this.#snapshot.length > 0) {
					this.#snapshotIdx = 0;
					this.#currentKey = this.#snapshot[0].key;
					this.#currentValue = this.#snapshot[0].value;
					return true;
				}
			}
			return false;
		}
		// Slow path: store was mutated, re-query from current position
		const cmpOp = this.#forward ? ">" : "<";
		const order = this.#forward ? "ASC" : "DESC";
		const {sql: rangeSql, params: rangeParams} = buildRangeConditions(
			this.#range,
		);
		this.#snapshot = this.#db
			.query(
				`SELECT key, value FROM _idb_records WHERE store_id = ? AND key ${cmpOp} ?${rangeSql} ORDER BY key ${order} LIMIT ${CURSOR_BATCH_SIZE}`,
			)
			.all(this.#storeId, this.#currentKey, ...rangeParams) as Array<{
			key: Uint8Array;
			value: Uint8Array;
		}>;
		if (this.#snapshot.length === 0) return false;
		this.#exhausted = this.#snapshot.length < CURSOR_BATCH_SIZE;
		this.#snapshotIdx = 0;
		this.#snapshotGen = this.#generation.value;
		this.#currentKey = this.#snapshot[0].key;
		this.#currentValue = this.#snapshot[0].value;
		return true;
	}

	#loadBatch(): void {
		const cmpOp = this.#forward ? ">" : "<";
		const order = this.#forward ? "ASC" : "DESC";
		const {sql: rangeSql, params: rangeParams} = buildRangeConditions(
			this.#range,
		);
		this.#snapshot = this.#db
			.query(
				`SELECT key, value FROM _idb_records WHERE store_id = ? AND key ${cmpOp} ?${rangeSql} ORDER BY key ${order} LIMIT ${CURSOR_BATCH_SIZE}`,
			)
			.all(this.#storeId, this.#currentKey, ...rangeParams) as Array<{
			key: Uint8Array;
			value: Uint8Array;
		}>;
		this.#exhausted = this.#snapshot.length < CURSOR_BATCH_SIZE;
	}
}

class HybridIndexCursor implements IDBBackendCursor {
	#db: SQLiteDB;
	#storeId: number;
	#indexId: number;
	#range: KeyRangeSpec | undefined;
	#direction: CursorDirection;
	#unique: boolean;
	#forward: boolean;
	#generation: GenerationRef;
	#snapshotGen: number;
	#snapshot: Array<{
		key: Uint8Array;
		primaryKey: Uint8Array;
		value: Uint8Array;
	}>;
	#snapshotIdx: number;
	#currentKey: Uint8Array;
	#currentPrimaryKey: Uint8Array;
	#currentValue: Uint8Array;
	#exhausted: boolean;

	constructor(
		db: SQLiteDB,
		storeId: number,
		indexId: number,
		range: KeyRangeSpec | undefined,
		direction: CursorDirection,
		generation: GenerationRef,
		snapshot: Array<{
			key: Uint8Array;
			primaryKey: Uint8Array;
			value: Uint8Array;
		}>,
		exhausted: boolean,
	) {
		this.#db = db;
		this.#storeId = storeId;
		this.#indexId = indexId;
		this.#range = range;
		this.#direction = direction;
		this.#unique = direction === "nextunique" || direction === "prevunique";
		this.#forward = direction === "next" || direction === "nextunique";
		this.#generation = generation;
		this.#snapshotGen = generation.value;
		this.#snapshot = snapshot;
		this.#snapshotIdx = 0;
		this.#currentKey = snapshot[0].key;
		this.#currentPrimaryKey = snapshot[0].primaryKey;
		this.#currentValue = snapshot[0].value;
		this.#exhausted = exhausted;
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
		if (this.#generation.value === this.#snapshotGen) {
			// Fast path: no mutations, use snapshot
			const prevKey = this.#currentKey;
			this.#snapshotIdx++;
			// For *unique directions, skip entries with the same index key
			if (this.#unique) {
				while (
					this.#snapshotIdx < this.#snapshot.length &&
					bytesEqual(this.#snapshot[this.#snapshotIdx].key, prevKey)
				) {
					this.#snapshotIdx++;
				}
			}
			if (this.#snapshotIdx < this.#snapshot.length) {
				this.#currentKey = this.#snapshot[this.#snapshotIdx].key;
				this.#currentPrimaryKey = this.#snapshot[this.#snapshotIdx].primaryKey;
				this.#currentValue = this.#snapshot[this.#snapshotIdx].value;
				return true;
			}
			// Batch exhausted — load next batch if more records exist
			if (!this.#exhausted) {
				this.#loadBatch();
				// For unique: skip entries with the same key as the last entry we returned
				if (this.#unique) {
					let i = 0;
					while (
						i < this.#snapshot.length &&
						bytesEqual(this.#snapshot[i].key, prevKey)
					) {
						i++;
					}
					if (i > 0) {
						this.#snapshot = this.#snapshot.slice(i);
					}
				}
				if (this.#snapshot.length > 0) {
					this.#snapshotIdx = 0;
					this.#currentKey = this.#snapshot[0].key;
					this.#currentPrimaryKey = this.#snapshot[0].primaryKey;
					this.#currentValue = this.#snapshot[0].value;
					return true;
				}
			}
			return false;
		}
		// Slow path: store was mutated, re-query from current position
		const order = this.#forward ? "ASC" : "DESC";
		const pkOrder = this.#direction === "prevunique" ? "ASC" : order;
		const {sql: rangeSql, params: rangeParams} = buildRangeConditions(
			this.#range,
			"ie",
		);
		const {sql: positionSql, params: positionParams} =
			this.#positionCondition();

		this.#snapshot = this.#db
			.query(
				`SELECT ie.key, ie.primary_key AS primaryKey, r.value FROM _idb_index_entries ie
			JOIN _idb_records r ON r.store_id = ? AND r.key = ie.primary_key
			WHERE ie.index_id = ?${positionSql}${rangeSql}
			ORDER BY ie.key ${order}, ie.primary_key ${pkOrder} LIMIT ${CURSOR_BATCH_SIZE}`,
			)
			.all(
				this.#storeId,
				this.#indexId,
				...positionParams,
				...rangeParams,
			) as Array<{key: Uint8Array; primaryKey: Uint8Array; value: Uint8Array}>;
		if (this.#snapshot.length === 0) return false;
		this.#exhausted = this.#snapshot.length < CURSOR_BATCH_SIZE;
		this.#snapshotIdx = 0;
		this.#snapshotGen = this.#generation.value;
		this.#currentKey = this.#snapshot[0].key;
		this.#currentPrimaryKey = this.#snapshot[0].primaryKey;
		this.#currentValue = this.#snapshot[0].value;
		return true;
	}

	#positionCondition(): {sql: string; params: any[]} {
		if (this.#unique) {
			const cmpOp = this.#forward ? ">" : "<";
			return {
				sql: ` AND ie.key ${cmpOp} ?`,
				params: [this.#currentKey],
			};
		} else if (this.#forward) {
			return {
				sql: ` AND (ie.key > ? OR (ie.key = ? AND ie.primary_key > ?))`,
				params: [this.#currentKey, this.#currentKey, this.#currentPrimaryKey],
			};
		} else {
			return {
				sql: ` AND (ie.key < ? OR (ie.key = ? AND ie.primary_key < ?))`,
				params: [this.#currentKey, this.#currentKey, this.#currentPrimaryKey],
			};
		}
	}

	#loadBatch(): void {
		const order = this.#forward ? "ASC" : "DESC";
		const pkOrder = this.#direction === "prevunique" ? "ASC" : order;
		const {sql: rangeSql, params: rangeParams} = buildRangeConditions(
			this.#range,
			"ie",
		);
		const {sql: positionSql, params: positionParams} =
			this.#positionCondition();

		this.#snapshot = this.#db
			.query(
				`SELECT ie.key, ie.primary_key AS primaryKey, r.value FROM _idb_index_entries ie
			JOIN _idb_records r ON r.store_id = ? AND r.key = ie.primary_key
			WHERE ie.index_id = ?${positionSql}${rangeSql}
			ORDER BY ie.key ${order}, ie.primary_key ${pkOrder} LIMIT ${CURSOR_BATCH_SIZE}`,
			)
			.all(
				this.#storeId,
				this.#indexId,
				...positionParams,
				...rangeParams,
			) as Array<{key: Uint8Array; primaryKey: Uint8Array; value: Uint8Array}>;
		this.#exhausted = this.#snapshot.length < CURSOR_BATCH_SIZE;
	}
}

// ============================================================================
// Connection-level metadata cache
// ============================================================================

/** Shared metadata cache — lives on the connection, passed to transactions. */
interface MetadataCache {
	storeIds: Map<string, number>;
	indexIds: Map<string, number>;
	indexMeta: Map<string, IndexMeta>;
	storeIndexes: Map<string, Array<{id: number; meta: IndexMeta}>>;
}

function loadMetadataCache(db: SQLiteDB): MetadataCache {
	const storeIds = new Map<string, number>();
	const indexIds = new Map<string, number>();
	const indexMeta = new Map<string, IndexMeta>();
	const storeIndexes = new Map<string, Array<{id: number; meta: IndexMeta}>>();

	const stores = db.query("SELECT id, name FROM _idb_stores").all() as any[];
	for (const s of stores) {
		storeIds.set(decodeName(s.name), s.id);
	}

	const indexes = db
		.query(
			'SELECT id, name, store_name, key_path, "unique", multi_entry FROM _idb_indexes',
		)
		.all() as any[];
	for (const idx of indexes) {
		const storeName = decodeName(idx.store_name);
		const indexName = decodeName(idx.name);
		const key = `${storeName}/${indexName}`;
		indexIds.set(key, idx.id);
		const meta: IndexMeta = {
			name: indexName,
			storeName,
			keyPath: JSON.parse(idx.key_path),
			unique: Boolean(idx.unique),
			multiEntry: Boolean(idx.multi_entry),
		};
		indexMeta.set(key, meta);
		let arr = storeIndexes.get(storeName);
		if (!arr) {
			arr = [];
			storeIndexes.set(storeName, arr);
		}
		arr.push({id: idx.id, meta});
	}

	return {storeIds, indexIds, indexMeta, storeIndexes};
}

// ============================================================================
// SQLite Transaction
// ============================================================================

class SQLiteTransaction implements IDBBackendTransaction {
	#db: SQLiteDB;
	#readonly: boolean;
	#aborted: boolean;
	#cache: MetadataCache;
	/** Shared generation counter — cursors use this to detect mutations. */
	_generation: GenerationRef;

	constructor(
		db: SQLiteDB,
		mode: "readonly" | "readwrite" | "versionchange",
		cache: MetadataCache,
	) {
		this.#db = db;
		this.#readonly = mode === "readonly";
		this.#aborted = false;
		this.#cache = cache;
		this._generation = {value: 0};

		// Readonly: no SQL-level transaction needed (reads see committed state).
		// Readwrite/versionchange: BEGIN IMMEDIATE for write serialization.
		if (!this.#readonly) {
			db.exec("BEGIN IMMEDIATE");
		}
	}

	#getStoreId(name: string): number {
		const id = this.#cache.storeIds.get(name);
		if (id === undefined) {
			throw new Error(`Store "${name}" not found`);
		}
		return id;
	}

	#getIndexId(storeName: string, indexName: string): number {
		const id = this.#cache.indexIds.get(`${storeName}/${indexName}`);
		if (id === undefined) {
			throw new Error(`Index "${indexName}" not found on store "${storeName}"`);
		}
		return id;
	}

	// ---- Schema operations ----

	createObjectStore(meta: ObjectStoreMeta): void {
		const row = this.#db
			.query(
				"INSERT INTO _idb_stores (name, key_path, auto_increment, current_key) VALUES (?, ?, ?, ?) RETURNING id",
			)
			.get(
				encodeName(meta.name),
				JSON.stringify(meta.keyPath),
				meta.autoIncrement ? 1 : 0,
				0,
			) as any;
		this.#cache.storeIds.set(meta.name, row.id);
	}

	deleteObjectStore(name: string): void {
		const storeId = this.#getStoreId(name);
		// Manual cascade: index entries → records → indexes → store
		this.#db
			.query(
				"DELETE FROM _idb_index_entries WHERE index_id IN (SELECT id FROM _idb_indexes WHERE store_id = ?)",
			)
			.run(storeId);
		this.#db.query("DELETE FROM _idb_records WHERE store_id = ?").run(storeId);
		this.#db.query("DELETE FROM _idb_indexes WHERE store_id = ?").run(storeId);
		this.#db.query("DELETE FROM _idb_stores WHERE id = ?").run(storeId);
		this.#cache.storeIds.delete(name);
		for (const [key] of this.#cache.indexIds) {
			if (key.startsWith(name + "/")) {
				this.#cache.indexIds.delete(key);
				this.#cache.indexMeta.delete(key);
			}
		}
		this.#cache.storeIndexes.delete(name);
	}

	renameObjectStore(oldName: string, newName: string): void {
		const storeId = this.#cache.storeIds.get(oldName);
		if (storeId === undefined) return;
		this.#db
			.query("UPDATE _idb_stores SET name = ? WHERE id = ?")
			.run(encodeName(newName), storeId);
		this.#db
			.query("UPDATE _idb_indexes SET store_name = ? WHERE store_id = ?")
			.run(encodeName(newName), storeId);
		this.#cache.storeIds.delete(oldName);
		this.#cache.storeIds.set(newName, storeId);
		for (const [key, indexId] of [...this.#cache.indexIds]) {
			if (key.startsWith(oldName + "/")) {
				const indexName = key.slice(oldName.length + 1);
				const newKey = `${newName}/${indexName}`;
				this.#cache.indexIds.delete(key);
				this.#cache.indexIds.set(newKey, indexId);
				const meta = this.#cache.indexMeta.get(key)!;
				this.#cache.indexMeta.delete(key);
				this.#cache.indexMeta.set(newKey, {...meta, storeName: newName});
			}
		}
		const storeIdxs = this.#cache.storeIndexes.get(oldName);
		if (storeIdxs) {
			this.#cache.storeIndexes.delete(oldName);
			for (const entry of storeIdxs) {
				entry.meta = {...entry.meta, storeName: newName};
			}
			this.#cache.storeIndexes.set(newName, storeIdxs);
		}
	}

	createIndex(meta: IndexMeta): void {
		const storeId = this.#getStoreId(meta.storeName);
		const row = this.#db
			.query(
				'INSERT INTO _idb_indexes (store_id, name, store_name, key_path, "unique", multi_entry) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
			)
			.get(
				storeId,
				encodeName(meta.name),
				encodeName(meta.storeName),
				JSON.stringify(meta.keyPath),
				meta.unique ? 1 : 0,
				meta.multiEntry ? 1 : 0,
			) as any;
		const indexId = row.id;
		const key = `${meta.storeName}/${meta.name}`;
		this.#cache.indexIds.set(key, indexId);
		this.#cache.indexMeta.set(key, meta);
		let arr = this.#cache.storeIndexes.get(meta.storeName);
		if (!arr) {
			arr = [];
			this.#cache.storeIndexes.set(meta.storeName, arr);
		}
		arr.push({id: indexId, meta});

		// Populate from existing records
		const records = this.#db
			.query("SELECT key, value FROM _idb_records WHERE store_id = ?")
			.all(storeId) as any[];
		for (const record of records) {
			let decoded: unknown;
			try {
				decoded = decodeValue(record.value);
			} catch (_error) {
				continue;
			}
			this.#addToIndex(meta, indexId, record.key, decoded);
		}
	}

	deleteIndex(storeName: string, indexName: string): void {
		const key = `${storeName}/${indexName}`;
		const indexId = this.#cache.indexIds.get(key);
		if (indexId !== undefined) {
			// Manual cascade: index entries → index
			this.#db
				.query("DELETE FROM _idb_index_entries WHERE index_id = ?")
				.run(indexId);
			this.#db.query("DELETE FROM _idb_indexes WHERE id = ?").run(indexId);
			this.#cache.indexIds.delete(key);
			this.#cache.indexMeta.delete(key);
			const arr = this.#cache.storeIndexes.get(storeName);
			if (arr) {
				const i = arr.findIndex((e) => e.id === indexId);
				if (i >= 0) arr.splice(i, 1);
			}
		}
	}

	renameIndex(storeName: string, oldName: string, newName: string): void {
		const oldKey = `${storeName}/${oldName}`;
		const indexId = this.#cache.indexIds.get(oldKey);
		if (indexId === undefined) return;
		this.#db
			.query("UPDATE _idb_indexes SET name = ? WHERE id = ?")
			.run(encodeName(newName), indexId);
		const newKey = `${storeName}/${newName}`;
		this.#cache.indexIds.delete(oldKey);
		this.#cache.indexIds.set(newKey, indexId);
		const newMeta = {...this.#cache.indexMeta.get(oldKey)!, name: newName};
		this.#cache.indexMeta.delete(oldKey);
		this.#cache.indexMeta.set(newKey, newMeta);
		const arr = this.#cache.storeIndexes.get(storeName);
		if (arr) {
			const entry = arr.find((e) => e.id === indexId);
			if (entry) entry.meta = newMeta;
		}
	}

	// ---- Data operations ----

	get(storeName: string, key: EncodedKey): StoredRecord | undefined {
		const storeId = this.#getStoreId(storeName);
		const row = this.#db
			.query(
				"SELECT key, value FROM _idb_records WHERE store_id = ? AND key = ?",
			)
			.get(storeId, key);
		if (!row) return undefined;
		return row as StoredRecord;
	}

	getAll(
		storeName: string,
		range?: KeyRangeSpec,
		count?: number,
	): StoredRecord[] {
		const storeId = this.#getStoreId(storeName);
		const {sql: rangeSql, params: rangeParams} = buildRangeConditions(range);
		const limit = count !== undefined ? ` LIMIT ${count}` : "";
		return this.#db
			.query(
				`SELECT key, value FROM _idb_records WHERE store_id = ?${rangeSql} ORDER BY key ASC${limit}`,
			)
			.all(storeId, ...rangeParams) as StoredRecord[];
	}

	getAllKeys(
		storeName: string,
		range?: KeyRangeSpec,
		count?: number,
	): EncodedKey[] {
		const storeId = this.#getStoreId(storeName);
		const {sql: rangeSql, params: rangeParams} = buildRangeConditions(range);
		const limit = count !== undefined ? ` LIMIT ${count}` : "";
		const rows = this.#db
			.query(
				`SELECT key FROM _idb_records WHERE store_id = ?${rangeSql} ORDER BY key ASC${limit}`,
			)
			.all(storeId, ...rangeParams);
		return rows.map((row: any) => row.key as Uint8Array);
	}

	put(storeName: string, key: EncodedKey, value: Uint8Array): void {
		const storeId = this.#getStoreId(storeName);
		const hasIndexes =
			(this.#cache.storeIndexes.get(storeName)?.length ?? 0) > 0;
		if (hasIndexes) {
			this.#db.exec("SAVEPOINT put_op");
			try {
				this.#removeFromIndexes(storeName, key);
				this.#db
					.query(
						"INSERT OR REPLACE INTO _idb_records (store_id, key, value) VALUES (?, ?, ?)",
					)
					.run(storeId, key, value);
				this.#addToAllIndexes(storeName, storeId, key, value);
				this.#db.exec("RELEASE put_op");
			} catch (e) {
				this.#db.exec("ROLLBACK TO put_op");
				this.#db.exec("RELEASE put_op");
				throw e;
			}
		} else {
			this.#db
				.query(
					"INSERT OR REPLACE INTO _idb_records (store_id, key, value) VALUES (?, ?, ?)",
				)
				.run(storeId, key, value);
		}
		this._generation.value++;
	}

	add(storeName: string, key: EncodedKey, value: Uint8Array): void {
		const storeId = this.#getStoreId(storeName);
		const existing = this.#db
			.query("SELECT 1 FROM _idb_records WHERE store_id = ? AND key = ?")
			.get(storeId, key);
		if (existing) {
			throw ConstraintError(
				`Key already exists in object store "${storeName}"`,
			);
		}
		const hasIndexes =
			(this.#cache.storeIndexes.get(storeName)?.length ?? 0) > 0;
		if (hasIndexes) {
			this.#db.exec("SAVEPOINT add_op");
			try {
				this.#db
					.query(
						"INSERT INTO _idb_records (store_id, key, value) VALUES (?, ?, ?)",
					)
					.run(storeId, key, value);
				this.#addToAllIndexes(storeName, storeId, key, value);
				this.#db.exec("RELEASE add_op");
			} catch (e) {
				this.#db.exec("ROLLBACK TO add_op");
				this.#db.exec("RELEASE add_op");
				throw e;
			}
		} else {
			this.#db
				.query(
					"INSERT INTO _idb_records (store_id, key, value) VALUES (?, ?, ?)",
				)
				.run(storeId, key, value);
		}
		this._generation.value++;
	}

	delete(storeName: string, range: KeyRangeSpec): void {
		const storeId = this.#getStoreId(storeName);
		const {sql: rangeSql, params: rangeParams} = buildRangeConditions(range);
		// Delete index entries for matching records using direct index IDs
		const indexes = this.#cache.storeIndexes.get(storeName);
		if (indexes && indexes.length > 0) {
			const ids = indexes.map((i) => i.id).join(",");
			this.#db
				.query(
					`DELETE FROM _idb_index_entries WHERE index_id IN (${ids}) AND primary_key IN (
					SELECT key FROM _idb_records WHERE store_id = ?${rangeSql}
				)`,
				)
				.run(storeId, ...rangeParams);
		}
		// Delete records
		this.#db
			.query(`DELETE FROM _idb_records WHERE store_id = ?${rangeSql}`)
			.run(storeId, ...rangeParams);
		this._generation.value++;
	}

	clear(storeName: string): void {
		const storeId = this.#getStoreId(storeName);
		const indexes = this.#cache.storeIndexes.get(storeName);
		if (indexes && indexes.length > 0) {
			const ids = indexes.map((i) => i.id).join(",");
			this.#db
				.query(`DELETE FROM _idb_index_entries WHERE index_id IN (${ids})`)
				.run();
		}
		this.#db.query("DELETE FROM _idb_records WHERE store_id = ?").run(storeId);
		this._generation.value++;
	}

	count(storeName: string, range?: KeyRangeSpec): number {
		const storeId = this.#getStoreId(storeName);
		const {sql: rangeSql, params: rangeParams} = buildRangeConditions(range);
		const row = this.#db
			.query(
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
			.query(
				`SELECT ie.primary_key AS key, r.value FROM _idb_index_entries ie
				JOIN _idb_records r ON r.store_id = ? AND r.key = ie.primary_key
				WHERE ie.index_id = ? AND ie.key = ?
				ORDER BY ie.primary_key ASC LIMIT 1`,
			)
			.get(storeId, indexId, key) as StoredRecord | null;
		if (!row) return undefined;
		return row;
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
		return this.#db
			.query(
				`SELECT ie.primary_key AS key, r.value FROM _idb_index_entries ie
				JOIN _idb_records r ON r.store_id = ? AND r.key = ie.primary_key
				WHERE ie.index_id = ?${rangeSql}
				ORDER BY ie.key ASC, ie.primary_key ASC${limit}`,
			)
			.all(storeId, indexId, ...rangeParams) as StoredRecord[];
	}

	indexGetAllKeys(
		storeName: string,
		indexName: string,
		range?: KeyRangeSpec,
		count?: number,
	): EncodedKey[] {
		const indexId = this.#getIndexId(storeName, indexName);
		const {sql: rangeSql, params: rangeParams} = buildRangeConditions(range);
		const limit = count !== undefined ? ` LIMIT ${count}` : "";
		return this.#db
			.query(
				`SELECT primary_key FROM _idb_index_entries WHERE index_id = ?${rangeSql}
				ORDER BY key ASC, primary_key ASC${limit}`,
			)
			.all(indexId, ...rangeParams)
			.map((row: any) => row.primary_key as Uint8Array);
	}

	indexCount(
		storeName: string,
		indexName: string,
		range?: KeyRangeSpec,
	): number {
		const indexId = this.#getIndexId(storeName, indexName);
		const {sql: rangeSql, params: rangeParams} = buildRangeConditions(range);
		const row = this.#db
			.query(
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
		const {sql: rangeSql, params: rangeParams} = buildRangeConditions(range);
		const order = directionToOrder(direction);
		const snapshot = this.#db
			.query(
				`SELECT key, value FROM _idb_records WHERE store_id = ?${rangeSql} ORDER BY key ${order} LIMIT ${CURSOR_BATCH_SIZE}`,
			)
			.all(storeId, ...rangeParams) as Array<{
			key: Uint8Array;
			value: Uint8Array;
		}>;

		if (snapshot.length === 0) return null;

		return new HybridCursor(
			this.#db,
			storeId,
			range,
			direction,
			this._generation,
			snapshot,
			snapshot.length < CURSOR_BATCH_SIZE,
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
		const snapshot = this.#db
			.query(
				`SELECT ie.key, ie.primary_key AS primaryKey, r.value FROM _idb_index_entries ie
				JOIN _idb_records r ON r.store_id = ? AND r.key = ie.primary_key
				WHERE ie.index_id = ?${rangeSql}
				ORDER BY ie.key ${order}, ie.primary_key ${pkOrder} LIMIT ${CURSOR_BATCH_SIZE}`,
			)
			.all(storeId, indexId, ...rangeParams) as Array<{
			key: Uint8Array;
			primaryKey: Uint8Array;
			value: Uint8Array;
		}>;

		if (snapshot.length === 0) return null;

		return new HybridIndexCursor(
			this.#db,
			storeId,
			indexId,
			range,
			direction,
			this._generation,
			snapshot,
			snapshot.length < CURSOR_BATCH_SIZE,
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
			.query("SELECT current_key FROM _idb_stores WHERE id = ?")
			.get(storeId) as any;
		if (row && row.current_key >= 2 ** 53) {
			throw ConstraintError("Key generator has reached its maximum value");
		}
		const updated = this.#db
			.query(
				"UPDATE _idb_stores SET current_key = current_key + 1 WHERE id = ? RETURNING current_key",
			)
			.get(storeId) as any;
		return updated.current_key;
	}

	maybeUpdateKeyGenerator(storeName: string, key: number): void {
		const storeId = this.#getStoreId(storeName);
		const newValue = Math.min(Math.floor(key), 2 ** 53);
		this.#db
			.query(
				"UPDATE _idb_stores SET current_key = ? WHERE id = ? AND current_key < ?",
			)
			.run(newValue, storeId, newValue);
	}

	getAutoIncrementCurrent(storeName: string): number {
		const storeId = this.#getStoreId(storeName);
		const row = this.#db
			.query("SELECT current_key FROM _idb_stores WHERE id = ?")
			.get(storeId);
		return row?.current_key ?? 0;
	}

	setAutoIncrementCurrent(storeName: string, value: number): void {
		const storeId = this.#getStoreId(storeName);
		this.#db
			.query("UPDATE _idb_stores SET current_key = ? WHERE id = ?")
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

	#removeFromIndexes(storeName: string, primaryKey: Uint8Array): void {
		const indexes = this.#cache.storeIndexes.get(storeName);
		if (!indexes || indexes.length === 0) return;
		if (indexes.length === 1) {
			this.#db
				.query(
					"DELETE FROM _idb_index_entries WHERE index_id = ? AND primary_key = ?",
				)
				.run(indexes[0].id, primaryKey);
		} else {
			// Batch delete: single query with IN clause (cached per unique set of index IDs)
			const ids = indexes.map((i) => i.id).join(",");
			this.#db
				.query(
					`DELETE FROM _idb_index_entries WHERE index_id IN (${ids}) AND primary_key = ?`,
				)
				.run(primaryKey);
		}
	}

	#addToAllIndexes(
		storeName: string,
		_storeId: number,
		primaryKey: Uint8Array,
		value: Uint8Array,
	): void {
		const indexes = this.#cache.storeIndexes.get(storeName);
		if (!indexes || indexes.length === 0) return;
		// Decode value once for all indexes
		let decoded: unknown;
		try {
			decoded = decodeValue(value);
		} catch (_error) {
			return;
		}
		for (const {id, meta} of indexes) {
			this.#addToIndex(meta, id, primaryKey, decoded);
		}
	}

	#addToIndex(
		meta: IndexMeta,
		indexId: number,
		primaryKey: Uint8Array,
		decodedValue: unknown,
	): void {
		let indexKeys: Uint8Array[];
		try {
			if (meta.multiEntry && typeof meta.keyPath === "string") {
				const rawValue = extractRawPropertyValue(decodedValue, meta.keyPath);
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
				const extracted = extractKeyFromValue(decodedValue, meta.keyPath);
				indexKeys = [encodeKey(extracted)];
			}
		} catch (_error) {
			return;
		}

		for (const indexKey of indexKeys) {
			if (meta.unique) {
				const existing = this.#db
					.query(
						"SELECT primary_key FROM _idb_index_entries WHERE index_id = ? AND key = ?",
					)
					.get(indexId, indexKey);
				if (existing) {
					throw ConstraintError(
						`Unique constraint violated for index "${meta.name}"`,
					);
				}
			}
			this.#db
				.query(
					"INSERT OR IGNORE INTO _idb_index_entries (index_id, key, primary_key) VALUES (?, ?, ?)",
				)
				.run(indexId, indexKey, primaryKey);
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
	#cache: MetadataCache;
	#cacheDirty: boolean;

	constructor(db: SQLiteDB, backend: SQLiteBackend, name: string) {
		this.#db = db;
		this.#backend = backend;
		this.#name = name;
		this.#closed = false;
		this.#cache = loadMetadataCache(db);
		this.#cacheDirty = false;
	}

	getMetadata(): DatabaseMeta {
		const versionRow = this.#db
			.query("SELECT value FROM _idb_meta WHERE key = 'version'")
			.get();
		const version = versionRow ? parseInt(versionRow.value, 10) : 0;

		const objectStores = new Map<string, ObjectStoreMeta>();
		const storeRows = this.#db
			.query("SELECT name, key_path, auto_increment FROM _idb_stores")
			.all();
		for (const row of storeRows) {
			const name = decodeName(row.name);
			objectStores.set(name, {
				name,
				keyPath: JSON.parse(row.key_path),
				autoIncrement: Boolean(row.auto_increment),
			});
		}

		const indexes = new Map<string, IndexMeta[]>();
		const indexRows = this.#db
			.query(
				'SELECT name, store_name, key_path, "unique", multi_entry FROM _idb_indexes',
			)
			.all();
		for (const row of indexRows) {
			const storeName = decodeName(row.store_name);
			const meta: IndexMeta = {
				name: decodeName(row.name),
				storeName,
				keyPath: JSON.parse(row.key_path),
				unique: Boolean(row.unique),
				multiEntry: Boolean(row.multi_entry),
			};
			if (!indexes.has(storeName)) {
				indexes.set(storeName, []);
			}
			indexes.get(storeName)!.push(meta);
		}

		return {name: "", version, objectStores, indexes};
	}

	setVersion(version: number): void {
		this.#db
			.query(
				"INSERT OR REPLACE INTO _idb_meta (key, value) VALUES ('version', ?)",
			)
			.run(String(version));
	}

	commitVersion(): void {
		const row = this.#db
			.query("SELECT value FROM _idb_meta WHERE key = 'version'")
			.get() as any;
		if (row) {
			this.#db
				.query(
					"INSERT OR REPLACE INTO _idb_meta (key, value) VALUES ('committed_version', ?)",
				)
				.run(row.value);
		}
	}

	beginTransaction(
		_storeNames: string[],
		mode: "readonly" | "readwrite" | "versionchange",
	): IDBBackendTransaction {
		if (mode === "versionchange") {
			// Versionchange mutates the cache — give it a fresh copy.
			// Mark connection cache dirty so next tx reloads.
			this.#cacheDirty = true;
			return new SQLiteTransaction(this.#db, mode, loadMetadataCache(this.#db));
		}
		if (this.#cacheDirty) {
			this.#cache = loadMetadataCache(this.#db);
			this.#cacheDirty = false;
		}
		return new SQLiteTransaction(this.#db, mode, this.#cache);
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
	static MAX_HANDLES: number;

	static {
		SQLiteBackend.MAX_HANDLES = 50;
	}

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
			db = openDatabase(dbPath);
			this.#initSchema(db);
			this.#handles.set(name, db);
		}
		this.#refcounts.set(name, (this.#refcounts.get(name) ?? 0) + 1);
		db.query(
			"INSERT OR REPLACE INTO _idb_meta (key, value) VALUES ('name', ?)",
		).run(encodeName(name));
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
							.query(
								"SELECT value FROM _idb_meta WHERE key = 'committed_version'",
							)
							.get();
						if (versionRow) {
							const version = parseInt(versionRow.value, 10);
							if (version > 0) {
								const nameRow = cached
									.query("SELECT value FROM _idb_meta WHERE key = 'name'")
									.get();
								results.push({
									name: nameRow ? decodeName(nameRow.value) : dbName,
									version,
								});
							}
						}
						continue;
					}
					const db = openDatabase(dbPath);
					try {
						const versionRow = db
							.query(
								"SELECT value FROM _idb_meta WHERE key = 'committed_version'",
							)
							.get();
						if (versionRow) {
							const version = parseInt(versionRow.value, 10);
							if (version > 0) {
								const nameRow = db
									.query("SELECT value FROM _idb_meta WHERE key = 'name'")
									.get();
								results.push({
									name: nameRow ? decodeName(nameRow.value) : dbName,
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

	getVersion(name: string): number {
		const cached = this.#handles.get(name);
		if (cached) {
			const row = cached
				.query("SELECT value FROM _idb_meta WHERE key = 'committed_version'")
				.get() as any;
			return row ? parseInt(row.value, 10) : 0;
		}
		const dbPath = this.#dbPath(name);
		if (!existsSync(dbPath)) return 0;
		const db = openDatabase(dbPath);
		try {
			this.#initSchema(db);
			const row = db
				.query("SELECT value FROM _idb_meta WHERE key = 'committed_version'")
				.get() as any;
			return row ? parseInt(row.value, 10) : 0;
		} finally {
			db.close();
		}
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
		db.exec(`
			CREATE TABLE IF NOT EXISTS _idb_meta (key TEXT PRIMARY KEY, value TEXT);
			CREATE TABLE IF NOT EXISTS _idb_stores (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				name TEXT NOT NULL UNIQUE,
				key_path TEXT NOT NULL,
				auto_increment INTEGER NOT NULL DEFAULT 0,
				current_key REAL NOT NULL DEFAULT 0
			);
			CREATE TABLE IF NOT EXISTS _idb_indexes (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				store_id INTEGER NOT NULL,
				name TEXT NOT NULL,
				store_name TEXT NOT NULL,
				key_path TEXT NOT NULL,
				"unique" INTEGER NOT NULL DEFAULT 0,
				multi_entry INTEGER NOT NULL DEFAULT 0,
				UNIQUE(store_id, name)
			);
			CREATE TABLE IF NOT EXISTS _idb_records (
				store_id INTEGER NOT NULL,
				key BLOB NOT NULL,
				value BLOB NOT NULL,
				PRIMARY KEY (store_id, key)
			);
			CREATE TABLE IF NOT EXISTS _idb_index_entries (
				index_id INTEGER NOT NULL,
				key BLOB NOT NULL,
				primary_key BLOB NOT NULL,
				PRIMARY KEY (index_id, key, primary_key)
			);
			CREATE INDEX IF NOT EXISTS _idb_ie_pk ON _idb_index_entries (index_id, primary_key);
		`);
	}
}
