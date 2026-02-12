/**
 * IndexedDB WPT tests against MemoryBackend
 *
 * Runs the WPT-style IndexedDB test suite against the in-memory backend.
 */

import {runIndexedDBTests} from "../src/runners/indexeddb.js";
import {
	IDBFactory,
	IDBKeyRange,
	MemoryBackend,
} from "../../indexeddb/src/index.js";

runIndexedDBTests("MemoryBackend", {
	createFactory: () => new IDBFactory(new MemoryBackend()),
	IDBKeyRange,
});
