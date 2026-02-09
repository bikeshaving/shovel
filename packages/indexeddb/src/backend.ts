/**
 * Abstract backend interface for IndexedDB storage.
 *
 * Storage backends implement raw key/value operations.
 * The API classes handle spec semantics (events, versioning, auto-commit).
 */

import type {
	EncodedKey,
	KeyRangeSpec,
	ObjectStoreMeta,
	IndexMeta,
	DatabaseMeta,
	CursorDirection,
	StoredRecord,
} from "./types.js";

/**
 * A cursor position in the backend.
 */
export interface IDBBackendCursor {
	/** The current primary key */
	readonly primaryKey: EncodedKey;
	/** The current key (may differ from primaryKey for index cursors) */
	readonly key: EncodedKey;
	/** The current value */
	readonly value: Uint8Array;
	/** Advance to the next position. Returns false if exhausted. */
	continue(): boolean;
}

/**
 * A backend transaction with data operations.
 */
export interface IDBBackendTransaction {
	// Schema operations (versionchange only)
	createObjectStore(meta: ObjectStoreMeta): void;
	deleteObjectStore(name: string): void;
	createIndex(meta: IndexMeta): void;
	deleteIndex(storeName: string, indexName: string): void;

	// Data operations
	get(storeName: string, key: EncodedKey): StoredRecord | undefined;
	getAll(
		storeName: string,
		range?: KeyRangeSpec,
		count?: number,
	): StoredRecord[];
	getAllKeys(
		storeName: string,
		range?: KeyRangeSpec,
		count?: number,
	): EncodedKey[];
	put(storeName: string, key: EncodedKey, value: Uint8Array): void;
	add(storeName: string, key: EncodedKey, value: Uint8Array): void;
	delete(storeName: string, range: KeyRangeSpec): void;
	clear(storeName: string): void;
	count(storeName: string, range?: KeyRangeSpec): number;

	// Index operations
	indexGet(
		storeName: string,
		indexName: string,
		key: EncodedKey,
	): StoredRecord | undefined;
	indexGetAll(
		storeName: string,
		indexName: string,
		range?: KeyRangeSpec,
		count?: number,
	): StoredRecord[];
	indexGetAllKeys(
		storeName: string,
		indexName: string,
		range?: KeyRangeSpec,
		count?: number,
	): EncodedKey[];
	indexCount(
		storeName: string,
		indexName: string,
		range?: KeyRangeSpec,
	): number;

	// Cursors
	openCursor(
		storeName: string,
		range?: KeyRangeSpec,
		direction?: CursorDirection,
	): IDBBackendCursor | null;
	openKeyCursor(
		storeName: string,
		range?: KeyRangeSpec,
		direction?: CursorDirection,
	): IDBBackendCursor | null;
	openIndexCursor(
		storeName: string,
		indexName: string,
		range?: KeyRangeSpec,
		direction?: CursorDirection,
	): IDBBackendCursor | null;
	openIndexKeyCursor(
		storeName: string,
		indexName: string,
		range?: KeyRangeSpec,
		direction?: CursorDirection,
	): IDBBackendCursor | null;

	// Auto-increment
	nextAutoIncrementKey(storeName: string): number;
	/** Update the key generator if key > current generator value (spec §2.6.3) */
	maybeUpdateKeyGenerator(storeName: string, key: number): void;

	// Lifecycle
	commit(): void;
	abort(): void;
}

/**
 * A backend connection to a specific database.
 */
export interface IDBBackendConnection {
	getMetadata(): DatabaseMeta;
	beginTransaction(
		storeNames: string[],
		mode: "readonly" | "readwrite" | "versionchange",
	): IDBBackendTransaction;
	/** Set the database version (used during versionchange transactions) */
	setVersion(version: number): void;
}

/**
 * The top-level backend factory.
 */
export interface IDBBackend {
	open(name: string, version: number): IDBBackendConnection;
	deleteDatabase(name: string): void;
	databases(): Array<{name: string; version: number}>;
	close(name: string): void;
}
