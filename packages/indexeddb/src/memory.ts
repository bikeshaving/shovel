/**
 * In-memory backend for IndexedDB.
 *
 * Stores everything in sorted arrays. Used for testing and as the default backend.
 */

import {compareKeys, encodeKey, extractKeyFromValue} from "./key.js";
import {decodeValue} from "./structured-clone.js";
import {ConstraintError, NotFoundError} from "./errors.js";
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

// ============================================================================
// Sorted array helpers
// ============================================================================

interface SortedEntry {
	key: Uint8Array;
	value: Uint8Array;
}

interface IndexEntry {
	key: Uint8Array; // index key
	primaryKey: Uint8Array;
}

function binarySearch(arr: SortedEntry[], key: Uint8Array): number {
	let lo = 0;
	let hi = arr.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if (compareKeys(arr[mid].key, key) < 0) {
			lo = mid + 1;
		} else {
			hi = mid;
		}
	}
	return lo;
}

function binarySearchIndex(arr: IndexEntry[], key: Uint8Array): number {
	let lo = 0;
	let hi = arr.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		const cmp = compareKeys(arr[mid].key, key);
		if (cmp < 0) {
			lo = mid + 1;
		} else {
			hi = mid;
		}
	}
	return lo;
}

function matchesRange(key: Uint8Array, range?: KeyRangeSpec): boolean {
	if (!range) return true;
	if (range.lower) {
		const cmp = compareKeys(key, range.lower);
		if (range.lowerOpen ? cmp <= 0 : cmp < 0) return false;
	}
	if (range.upper) {
		const cmp = compareKeys(key, range.upper);
		if (range.upperOpen ? cmp >= 0 : cmp > 0) return false;
	}
	return true;
}

// ============================================================================
// Memory Store
// ============================================================================

class MemoryStore {
	meta: ObjectStoreMeta;
	data: SortedEntry[] = [];
	autoIncrementCurrent: number = 0;

	constructor(meta: ObjectStoreMeta) {
		this.meta = meta;
	}

	clone(): MemoryStore {
		const store = new MemoryStore({...this.meta});
		store.data = this.data.map((e) => ({
			key: new Uint8Array(e.key),
			value: new Uint8Array(e.value),
		}));
		store.autoIncrementCurrent = this.autoIncrementCurrent;
		return store;
	}
}

class MemoryIndex {
	meta: IndexMeta;
	data: IndexEntry[] = [];

	constructor(meta: IndexMeta) {
		this.meta = meta;
	}

	clone(): MemoryIndex {
		const idx = new MemoryIndex({...this.meta});
		idx.data = this.data.map((e) => ({
			key: new Uint8Array(e.key),
			primaryKey: new Uint8Array(e.primaryKey),
		}));
		return idx;
	}
}

// ============================================================================
// Memory Database
// ============================================================================

interface MemoryDatabase {
	name: string;
	version: number;
	stores: Map<string, MemoryStore>;
	indexes: Map<string, MemoryIndex>; // key: "storeName/indexName"
}

// ============================================================================
// Memory Transaction
// ============================================================================

class MemoryTransaction implements IDBBackendTransaction {
	#db: MemoryDatabase;
	// Snapshots for rollback (readwrite/versionchange)
	#snapshot: {
		stores: Map<string, MemoryStore>;
		indexes: Map<string, MemoryIndex>;
		version: number;
	} | null = null;

	constructor(
		db: MemoryDatabase,
		_storeNames: string[],
		mode: "readonly" | "readwrite" | "versionchange",
	) {
		this.#db = db;

		// Save snapshot for rollback
		if (mode !== "readonly") {
			this.#snapshot = {
				stores: new Map(
					Array.from(db.stores.entries()).map(([k, v]) => [k, v.clone()]),
				),
				indexes: new Map(
					Array.from(db.indexes.entries()).map(([k, v]) => [k, v.clone()]),
				),
				version: db.version,
			};
		}
	}

	// ---- Schema operations ----

	createObjectStore(meta: ObjectStoreMeta): void {
		this.#db.stores.set(meta.name, new MemoryStore(meta));
	}

	deleteObjectStore(name: string): void {
		this.#db.stores.delete(name);
		// Delete all indexes for this store
		for (const [key] of this.#db.indexes) {
			if (key.startsWith(name + "/")) {
				this.#db.indexes.delete(key);
			}
		}
	}

	createIndex(meta: IndexMeta): void {
		const indexKey = `${meta.storeName}/${meta.name}`;
		const idx = new MemoryIndex(meta);
		this.#db.indexes.set(indexKey, idx);

		// Populate index from existing data
		const store = this.#db.stores.get(meta.storeName);
		if (store) {
			for (const entry of store.data) {
				this.#addToIndex(idx, entry.key, entry.value, meta);
			}
		}
	}

	deleteIndex(storeName: string, indexName: string): void {
		this.#db.indexes.delete(`${storeName}/${indexName}`);
	}

	// ---- Data operations ----

	get(storeName: string, key: EncodedKey): StoredRecord | undefined {
		const store = this.#getStore(storeName);
		const idx = binarySearch(store.data, key);
		if (idx < store.data.length && compareKeys(store.data[idx].key, key) === 0) {
			return store.data[idx];
		}
		return undefined;
	}

	getAll(
		storeName: string,
		range?: KeyRangeSpec,
		count?: number,
	): StoredRecord[] {
		const store = this.#getStore(storeName);
		const results: StoredRecord[] = [];
		for (const entry of store.data) {
			if (matchesRange(entry.key, range)) {
				results.push(entry);
				if (count !== undefined && results.length >= count) break;
			}
		}
		return results;
	}

	getAllKeys(
		storeName: string,
		range?: KeyRangeSpec,
		count?: number,
	): EncodedKey[] {
		const store = this.#getStore(storeName);
		const results: EncodedKey[] = [];
		for (const entry of store.data) {
			if (matchesRange(entry.key, range)) {
				results.push(entry.key);
				if (count !== undefined && results.length >= count) break;
			}
		}
		return results;
	}

	put(storeName: string, key: EncodedKey, value: Uint8Array): void {
		const store = this.#getStore(storeName);
		const idx = binarySearch(store.data, key);

		// Remove old index entries if updating
		if (idx < store.data.length && compareKeys(store.data[idx].key, key) === 0) {
			this.#removeFromIndexes(storeName, store.data[idx].key, store.data[idx].value);
			store.data[idx] = {key, value};
		} else {
			store.data.splice(idx, 0, {key, value});
		}

		// Add new index entries
		this.#addToAllIndexes(storeName, key, value);
	}

	add(storeName: string, key: EncodedKey, value: Uint8Array): void {
		const store = this.#getStore(storeName);
		const idx = binarySearch(store.data, key);
		if (idx < store.data.length && compareKeys(store.data[idx].key, key) === 0) {
			throw ConstraintError(
				`Key already exists in object store "${storeName}"`,
			);
		}
		store.data.splice(idx, 0, {key, value});
		this.#addToAllIndexes(storeName, key, value);
	}

	delete(storeName: string, range: KeyRangeSpec): void {
		const store = this.#getStore(storeName);
		const toRemove: number[] = [];
		for (let i = 0; i < store.data.length; i++) {
			if (matchesRange(store.data[i].key, range)) {
				this.#removeFromIndexes(storeName, store.data[i].key, store.data[i].value);
				toRemove.push(i);
			}
		}
		// Remove in reverse order to preserve indices
		for (let i = toRemove.length - 1; i >= 0; i--) {
			store.data.splice(toRemove[i], 1);
		}
	}

	clear(storeName: string): void {
		const store = this.#getStore(storeName);
		store.data = [];
		// Clear all indexes for this store
		for (const [key, idx] of this.#db.indexes) {
			if (key.startsWith(storeName + "/")) {
				idx.data = [];
			}
		}
	}

	count(storeName: string, range?: KeyRangeSpec): number {
		const store = this.#getStore(storeName);
		if (!range) return store.data.length;
		let count = 0;
		for (const entry of store.data) {
			if (matchesRange(entry.key, range)) count++;
		}
		return count;
	}

	// ---- Index operations ----

	indexGet(
		storeName: string,
		indexName: string,
		key: EncodedKey,
	): StoredRecord | undefined {
		const idx = this.#getIndex(storeName, indexName);
		const pos = binarySearchIndex(idx.data, key);
		if (pos < idx.data.length && compareKeys(idx.data[pos].key, key) === 0) {
			return this.get(storeName, idx.data[pos].primaryKey);
		}
		return undefined;
	}

	indexGetAll(
		storeName: string,
		indexName: string,
		range?: KeyRangeSpec,
		count?: number,
	): StoredRecord[] {
		const idx = this.#getIndex(storeName, indexName);
		const results: StoredRecord[] = [];
		for (const entry of idx.data) {
			if (matchesRange(entry.key, range)) {
				const record = this.get(storeName, entry.primaryKey);
				if (record) {
					results.push(record);
					if (count !== undefined && results.length >= count) break;
				}
			}
		}
		return results;
	}

	indexGetAllKeys(
		storeName: string,
		indexName: string,
		range?: KeyRangeSpec,
		count?: number,
	): EncodedKey[] {
		const idx = this.#getIndex(storeName, indexName);
		const results: EncodedKey[] = [];
		for (const entry of idx.data) {
			if (matchesRange(entry.key, range)) {
				results.push(entry.primaryKey);
				if (count !== undefined && results.length >= count) break;
			}
		}
		return results;
	}

	indexCount(
		storeName: string,
		indexName: string,
		range?: KeyRangeSpec,
	): number {
		const idx = this.#getIndex(storeName, indexName);
		if (!range) return idx.data.length;
		let count = 0;
		for (const entry of idx.data) {
			if (matchesRange(entry.key, range)) count++;
		}
		return count;
	}

	// ---- Cursors ----

	openCursor(
		storeName: string,
		range?: KeyRangeSpec,
		direction: CursorDirection = "next",
	): IDBBackendCursor | null {
		const store = this.#getStore(storeName);
		const entries = this.#filterAndSort(store.data, range, direction);
		if (entries.length === 0) return null;
		return new MemoryCursor(entries, 0);
	}

	openKeyCursor(
		storeName: string,
		range?: KeyRangeSpec,
		direction: CursorDirection = "next",
	): IDBBackendCursor | null {
		// Same as openCursor for non-index stores
		return this.openCursor(storeName, range, direction);
	}

	openIndexCursor(
		storeName: string,
		indexName: string,
		range?: KeyRangeSpec,
		direction: CursorDirection = "next",
	): IDBBackendCursor | null {
		const idx = this.#getIndex(storeName, indexName);
		const filtered: {key: Uint8Array; primaryKey: Uint8Array; value: Uint8Array}[] = [];

		for (const entry of idx.data) {
			if (matchesRange(entry.key, range)) {
				const record = this.get(storeName, entry.primaryKey);
				if (record) {
					filtered.push({
						key: entry.key,
						primaryKey: entry.primaryKey,
						value: record.value,
					});
				}
			}
		}

		if (direction === "prev" || direction === "prevunique") {
			filtered.reverse();
		}

		if (direction === "nextunique" || direction === "prevunique") {
			const unique: typeof filtered = [];
			let lastKey: Uint8Array | null = null;
			for (const e of filtered) {
				if (lastKey === null || compareKeys(e.key, lastKey) !== 0) {
					unique.push(e);
					lastKey = e.key;
				}
			}
			if (unique.length === 0) return null;
			return new MemoryIndexCursor(unique, 0);
		}

		if (filtered.length === 0) return null;
		return new MemoryIndexCursor(filtered, 0);
	}

	openIndexKeyCursor(
		storeName: string,
		indexName: string,
		range?: KeyRangeSpec,
		direction: CursorDirection = "next",
	): IDBBackendCursor | null {
		// Same as openIndexCursor
		return this.openIndexCursor(storeName, indexName, range, direction);
	}

	// ---- Auto-increment ----

	nextAutoIncrementKey(storeName: string): number {
		const store = this.#getStore(storeName);
		// Spec: if current >= 2^53 (maximum safe key generator value), throw ConstraintError
		if (store.autoIncrementCurrent >= 2 ** 53) {
			throw ConstraintError("Key generator has reached its maximum value");
		}
		store.autoIncrementCurrent++;
		return store.autoIncrementCurrent;
	}

	maybeUpdateKeyGenerator(storeName: string, key: number): void {
		const store = this.#getStore(storeName);
		// Spec: set current number to smallest integer >= key.
		// If that integer >= 2^53, the generator is "used up".
		// Clamp at 2^53 so nextAutoIncrementKey will throw ConstraintError.
		const newValue = Math.min(Math.floor(key), 2 ** 53);
		if (newValue > store.autoIncrementCurrent) {
			store.autoIncrementCurrent = newValue;
		}
	}

	// ---- Lifecycle ----

	commit(): void {
		// For memory backend, data is already in place
		this.#snapshot = null;
	}

	abort(): void {
		if (this.#snapshot) {
			this.#db.stores = this.#snapshot.stores;
			this.#db.indexes = this.#snapshot.indexes;
			this.#db.version = this.#snapshot.version;
			this.#snapshot = null;
		}
	}

	// ---- Private helpers ----

	#getStore(name: string): MemoryStore {
		const store = this.#db.stores.get(name);
		if (!store) {
			throw NotFoundError(`Object store "${name}" not found`);
		}
		return store;
	}

	#getIndex(storeName: string, indexName: string): MemoryIndex {
		const idx = this.#db.indexes.get(`${storeName}/${indexName}`);
		if (!idx) {
			throw NotFoundError(
				`Index "${indexName}" not found on store "${storeName}"`,
			);
		}
		return idx;
	}

	#filterAndSort(
		data: SortedEntry[],
		range: KeyRangeSpec | undefined,
		direction: CursorDirection,
	): SortedEntry[] {
		let filtered = data.filter((e) => matchesRange(e.key, range));
		if (direction === "prev" || direction === "prevunique") {
			filtered = filtered.slice().reverse();
		}
		if (direction === "nextunique" || direction === "prevunique") {
			const unique: SortedEntry[] = [];
			let lastKey: Uint8Array | null = null;
			for (const e of filtered) {
				if (lastKey === null || compareKeys(e.key, lastKey) !== 0) {
					unique.push(e);
					lastKey = e.key;
				}
			}
			return unique;
		}
		return filtered;
	}

	#addToAllIndexes(
		storeName: string,
		primaryKey: Uint8Array,
		value: Uint8Array,
	): void {
		for (const [key, idx] of this.#db.indexes) {
			if (key.startsWith(storeName + "/")) {
				this.#addToIndex(idx, primaryKey, value, idx.meta);
			}
		}
	}

	#addToIndex(
		idx: MemoryIndex,
		primaryKey: Uint8Array,
		value: Uint8Array,
		meta: IndexMeta,
	): void {
		// Decode the value to extract the index key
		let decodedValue: unknown;
		try {
			decodedValue = decodeValue(value);
		} catch {
			return; // Can't extract key — skip
		}

		let indexKeys: Uint8Array[];
		try {
			if (meta.multiEntry && typeof meta.keyPath === "string") {
				// For multiEntry, if the extracted value is an array, index each element
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
			return; // Key extraction failed — skip this record for this index
		}

		for (const indexKey of indexKeys) {
			if (meta.unique) {
				// Check uniqueness
				const existing = binarySearchIndex(idx.data, indexKey);
				if (
					existing < idx.data.length &&
					compareKeys(idx.data[existing].key, indexKey) === 0
				) {
					throw ConstraintError(
						`Unique constraint violated for index "${meta.name}"`,
					);
				}
			}

			// Insert in sorted order (by index key, then primary key)
			const pos = binarySearchIndex(idx.data, indexKey);
			// Find the exact insertion point accounting for primary key ordering
			let insertPos = pos;
			while (
				insertPos < idx.data.length &&
				compareKeys(idx.data[insertPos].key, indexKey) === 0 &&
				compareKeys(idx.data[insertPos].primaryKey, primaryKey) < 0
			) {
				insertPos++;
			}
			idx.data.splice(insertPos, 0, {key: indexKey, primaryKey});
		}
	}

	#removeFromIndexes(
		storeName: string,
		primaryKey: Uint8Array,
		_value: Uint8Array,
	): void {
		for (const [key, idx] of this.#db.indexes) {
			if (key.startsWith(storeName + "/")) {
				idx.data = idx.data.filter(
					(e) => compareKeys(e.primaryKey, primaryKey) !== 0,
				);
			}
		}
	}
}

// ============================================================================
// Cursor implementations
// ============================================================================

class MemoryCursor implements IDBBackendCursor {
	#entries: SortedEntry[];
	#pos: number;

	constructor(entries: SortedEntry[], pos: number) {
		this.#entries = entries;
		this.#pos = pos;
	}

	get primaryKey(): EncodedKey {
		return this.#entries[this.#pos].key;
	}

	get key(): EncodedKey {
		return this.#entries[this.#pos].key;
	}

	get value(): Uint8Array {
		return this.#entries[this.#pos].value;
	}

	continue(): boolean {
		this.#pos++;
		return this.#pos < this.#entries.length;
	}
}

class MemoryIndexCursor implements IDBBackendCursor {
	#entries: {key: Uint8Array; primaryKey: Uint8Array; value: Uint8Array}[];
	#pos: number;

	constructor(
		entries: {key: Uint8Array; primaryKey: Uint8Array; value: Uint8Array}[],
		pos: number,
	) {
		this.#entries = entries;
		this.#pos = pos;
	}

	get primaryKey(): EncodedKey {
		return this.#entries[this.#pos].primaryKey;
	}

	get key(): EncodedKey {
		return this.#entries[this.#pos].key;
	}

	get value(): Uint8Array {
		return this.#entries[this.#pos].value;
	}

	continue(): boolean {
		this.#pos++;
		return this.#pos < this.#entries.length;
	}
}

// ============================================================================
// Memory Connection
// ============================================================================

class MemoryConnection implements IDBBackendConnection {
	#db: MemoryDatabase;

	constructor(db: MemoryDatabase) {
		this.#db = db;
	}

	getMetadata(): DatabaseMeta {
		const objectStores = new Map<string, ObjectStoreMeta>();
		for (const [name, store] of this.#db.stores) {
			objectStores.set(name, {...store.meta});
		}

		const indexes = new Map<string, IndexMeta[]>();
		for (const [key, idx] of this.#db.indexes) {
			const storeName = key.split("/")[0];
			if (!indexes.has(storeName)) {
				indexes.set(storeName, []);
			}
			indexes.get(storeName)!.push({...idx.meta});
		}

		return {
			name: this.#db.name,
			version: this.#db.version,
			objectStores,
			indexes,
		};
	}

	beginTransaction(
		storeNames: string[],
		mode: "readonly" | "readwrite" | "versionchange",
	): IDBBackendTransaction {
		return new MemoryTransaction(this.#db, storeNames, mode);
	}
}

// ============================================================================
// Memory Backend
// ============================================================================

export class MemoryBackend implements IDBBackend {
	#databases = new Map<string, MemoryDatabase>();

	open(name: string, version: number): IDBBackendConnection {
		let db = this.#databases.get(name);
		if (!db) {
			db = {
				name,
				version,
				stores: new Map(),
				indexes: new Map(),
			};
			this.#databases.set(name, db);
		} else {
			db.version = version;
		}
		return new MemoryConnection(db);
	}

	deleteDatabase(name: string): void {
		this.#databases.delete(name);
	}

	databases(): Array<{name: string; version: number}> {
		return Array.from(this.#databases.entries()).map(([name, db]) => ({
			name,
			version: db.version,
		}));
	}

	close(_name: string): void {
		// No-op for memory backend
	}
}
