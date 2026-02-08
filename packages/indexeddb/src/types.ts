/**
 * Shared types and enums for the IndexedDB implementation.
 */

/** Key types in IndexedDB sort order */
export const enum KeyType {
	Number = 0x10,
	Date = 0x20,
	String = 0x30,
	Binary = 0x40,
	Array = 0x50,
}

/** Cursor direction */
export type CursorDirection = "next" | "nextunique" | "prev" | "prevunique";

/** Transaction mode */
export type TransactionMode = "readonly" | "readwrite" | "versionchange";

/** Encoded key (order-preserving byte representation) */
export type EncodedKey = Uint8Array;

/** A stored record with its primary key and serialized value */
export interface StoredRecord {
	key: EncodedKey;
	value: Uint8Array;
}

/** Specification for a key range query */
export interface KeyRangeSpec {
	lower?: EncodedKey;
	upper?: EncodedKey;
	lowerOpen: boolean;
	upperOpen: boolean;
}

/** Object store metadata */
export interface ObjectStoreMeta {
	name: string;
	keyPath: string | string[] | null;
	autoIncrement: boolean;
}

/** Index metadata */
export interface IndexMeta {
	name: string;
	storeName: string;
	keyPath: string | string[];
	unique: boolean;
	multiEntry: boolean;
}

/** Database metadata */
export interface DatabaseMeta {
	name: string;
	version: number;
	objectStores: Map<string, ObjectStoreMeta>;
	indexes: Map<string, IndexMeta[]>; // storeName -> indexes
}

/**
 * Create a DOMStringList-like sorted array with contains() and item() methods.
 */
export function makeDOMStringList(names: string[]): DOMStringList {
	const sorted = [...names].sort();
	return Object.assign(sorted, {
		contains(name: string) {
			return sorted.includes(name);
		},
		item(index: number) {
			return sorted[index] ?? null;
		},
	}) as unknown as DOMStringList;
}
