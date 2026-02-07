/**
 * @b9g/indexeddb - IndexedDB implementation for Shovel
 *
 * Provides a spec-compliant IndexedDB API backed by pluggable storage backends.
 */

export {IDBFactory} from "./factory.js";
export {IDBDatabase} from "./database.js";
export {IDBTransaction} from "./transaction.js";
export {IDBObjectStore} from "./object-store.js";
export {IDBRequest, IDBOpenDBRequest} from "./request.js";
export {IDBKeyRange} from "./key-range.js";
export {IDBIndex} from "./idb-index.js";
export {IDBVersionChangeEvent} from "./events.js";
export {
	encodeKey,
	decodeKey,
	compareKeys,
	validateKey,
} from "./key.js";
export {encodeValue, decodeValue} from "./structured-clone.js";
export {MemoryBackend} from "./memory.js";
export type {IDBBackend, IDBBackendConnection, IDBBackendTransaction} from "./backend.js";
