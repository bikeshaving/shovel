/**
 * IndexedDB WPT test runner
 *
 * Runs WPT-style IndexedDB tests against an IDBFactory implementation.
 * Modeled after the WPT IndexedDB test suite.
 */

import {describe, test, expect, afterEach} from "bun:test";

// ============================================================================
// Types
// ============================================================================

type IDBFactoryLike = {
	open(name: string, version?: number): any;
	deleteDatabase(name: string): any;
	databases(): Promise<Array<{name: string; version: number}>>;
	cmp(a: any, b: any): number;
};

type IDBKeyRangeLike = {
	only(value: any): any;
	lowerBound(lower: any, open?: boolean): any;
	upperBound(upper: any, open?: boolean): any;
	bound(lower: any, upper: any, lowerOpen?: boolean, upperOpen?: boolean): any;
};

/**
 * Configuration for running IndexedDB tests
 */
export interface IndexedDBTestConfig {
	/** Factory function to create a fresh IDBFactory for each test */
	createFactory: () => IDBFactoryLike;
	/** IDBKeyRange class (from @b9g/indexeddb) */
	IDBKeyRange: IDBKeyRangeLike;
	/** Optional cleanup function called after each test */
	cleanup?: () => void | Promise<void>;
}

// ============================================================================
// Helpers — promise wrappers around the event-based IDB API
// ============================================================================

type IDBDatabaseLike = {
	name: string;
	version: number;
	objectStoreNames: string[];
	transaction(
		storeNames: string | string[],
		mode?: string,
	): any;
	createObjectStore(
		name: string,
		options?: {keyPath?: string | string[] | null; autoIncrement?: boolean},
	): any;
	deleteObjectStore(name: string): void;
	close(): void;
};

/**
 * Open a database, optionally running an upgrade callback.
 */
function openDB(
	factory: IDBFactoryLike,
	name: string,
	version: number,
	onUpgrade?: (db: IDBDatabaseLike, tx: any) => void,
): Promise<IDBDatabaseLike> {
	return new Promise((resolve, reject) => {
		const request = factory.open(name, version);
		request.onupgradeneeded = (e: any) => {
			const db = e.target?.result ?? request.result;
			const tx = e.target?.transaction ?? request.transaction;
			onUpgrade?.(db, tx);
		};
		request.onsuccess = (e: any) => {
			resolve(e.target?.result ?? request.result);
		};
		request.onerror = (e: any) => {
			reject(e.target?.error ?? request.error);
		};
	});
}

/**
 * Wrap an IDBRequest in a promise.
 */
function reqToPromise(request: any): Promise<any> {
	return new Promise((resolve, reject) => {
		request.onsuccess = (e: any) =>
			resolve(e.target?.result ?? request.result);
		request.onerror = (e: any) =>
			reject(e.target?.error ?? request.error);
	});
}

/**
 * Wait for a transaction to complete.
 */
function txComplete(tx: any): Promise<void> {
	return new Promise((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onerror = (e: any) => reject(e.target?.error ?? tx.error);
		tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
	});
}

/**
 * Collect all cursor results via continue() into an array.
 */
function cursorToArray(request: any): Promise<any[]> {
	return new Promise((resolve, reject) => {
		const results: any[] = [];
		request.onsuccess = (e: any) => {
			const cursor = e.target?.result ?? request.result;
			if (cursor) {
				results.push({key: cursor.key, value: cursor.value});
				cursor.continue();
			} else {
				resolve(results);
			}
		};
		request.onerror = (e: any) =>
			reject(e.target?.error ?? request.error);
	});
}

// ============================================================================
// Runner
// ============================================================================

/**
 * Run WPT-style IndexedDB tests against a backend implementation.
 *
 * @param name Name for the test suite (e.g., "MemoryBackend")
 * @param config Test configuration
 */
export function runIndexedDBTests(
	name: string,
	config: IndexedDBTestConfig,
): void {
	const {IDBKeyRange} = config;

	let factory: IDBFactoryLike;
	let dbCounter = 0;

	/** Get a unique database name per test */
	const uniqueName = () => `wpt-idb-${++dbCounter}-${Date.now()}`;

	describe(`IndexedDB WPT Tests: ${name}`, () => {
		// Fresh factory per test
		const setup = () => {
			factory = config.createFactory();
		};

		afterEach(async () => {
			await config.cleanup?.();
		});

		// =================================================================
		// IDBFactory.open() — based on WPT idbfactory-open.any.js
		// =================================================================
		describe("IDBFactory.open()", () => {
			test("open returns an IDBOpenDBRequest", () => {
				setup();
				const request = factory.open(uniqueName(), 1);
				expect(request).toBeDefined();
				expect(request.readyState).toBe("pending");
			});

			test("open creates a new database", async () => {
				setup();
				const dbName = uniqueName();
				const db = await openDB(factory, dbName, 1);
				expect(db.name).toBe(dbName);
				expect(db.version).toBe(1);
				db.close();
			});

			test("open fires upgradeneeded for new database", async () => {
				setup();
				let upgradeNeededFired = false;
				const db = await openDB(factory, uniqueName(), 1, () => {
					upgradeNeededFired = true;
				});
				expect(upgradeNeededFired).toBe(true);
				db.close();
			});

			test("open fires upgradeneeded with correct versions", async () => {
				setup();
				let oldVersion = -1;
				let newVersion = -1;
				const dbName = uniqueName();
				const request = factory.open(dbName, 1);
				await new Promise<void>((resolve, reject) => {
					request.onupgradeneeded = (e: any) => {
						oldVersion = e.oldVersion;
						newVersion = e.newVersion;
					};
					request.onsuccess = () => resolve();
					request.onerror = () => reject(request.error);
				});
				expect(oldVersion).toBe(0);
				expect(newVersion).toBe(1);
				request.result.close();
			});

			test("open existing database without version upgrade", async () => {
				setup();
				const dbName = uniqueName();
				const db1 = await openDB(factory, dbName, 1, (db) => {
					db.createObjectStore("store");
				});
				db1.close();

				let upgradeRan = false;
				const db2 = await openDB(factory, dbName, 1, () => {
					upgradeRan = true;
				});
				expect(upgradeRan).toBe(false);
				expect(db2.objectStoreNames).toContain("store");
				db2.close();
			});

			test("open with higher version runs upgrade", async () => {
				setup();
				const dbName = uniqueName();
				const db1 = await openDB(factory, dbName, 1, (db) => {
					db.createObjectStore("store1");
				});
				db1.close();

				const db2 = await openDB(factory, dbName, 2, (db, _tx) => {
					db.createObjectStore("store2");
				});
				expect(db2.version).toBe(2);
				expect(db2.objectStoreNames).toContain("store1");
				expect(db2.objectStoreNames).toContain("store2");
				db2.close();
			});
		});

		// =================================================================
		// IDBFactory.deleteDatabase()
		// =================================================================
		describe("IDBFactory.deleteDatabase()", () => {
			test("delete a database", async () => {
				setup();
				const dbName = uniqueName();
				const db = await openDB(factory, dbName, 1, (db) => {
					db.createObjectStore("store");
				});
				db.close();

				await reqToPromise(factory.deleteDatabase(dbName));
				const dbs = await factory.databases();
				expect(dbs.find((d: any) => d.name === dbName)).toBeUndefined();
			});

			test("delete non-existent database succeeds", async () => {
				setup();
				await reqToPromise(factory.deleteDatabase("nonexistent-" + Date.now()));
			});
		});

		// =================================================================
		// IDBFactory.cmp() — based on WPT key-comparison
		// =================================================================
		describe("IDBFactory.cmp()", () => {
			test("compare equal keys returns 0", () => {
				setup();
				expect(factory.cmp(1, 1)).toBe(0);
				expect(factory.cmp("abc", "abc")).toBe(0);
			});

			test("compare less-than returns -1", () => {
				setup();
				expect(factory.cmp(1, 2)).toBe(-1);
				expect(factory.cmp("a", "b")).toBe(-1);
			});

			test("compare greater-than returns 1", () => {
				setup();
				expect(factory.cmp(2, 1)).toBe(1);
				expect(factory.cmp("b", "a")).toBe(1);
			});

			test("type ordering: number < string", () => {
				setup();
				expect(factory.cmp(1, "a")).toBe(-1);
			});

			test("type ordering: number < date", () => {
				setup();
				expect(factory.cmp(0, new Date(0))).toBe(-1);
			});

			test("type ordering: date < string", () => {
				setup();
				expect(factory.cmp(new Date(0), "a")).toBe(-1);
			});
		});

		// =================================================================
		// IDBFactory.databases()
		// =================================================================
		describe("IDBFactory.databases()", () => {
			test("lists created databases", async () => {
				setup();
				const dbName = uniqueName();
				const db = await openDB(factory, dbName, 1);
				db.close();

				const dbs = await factory.databases();
				const found = dbs.find((d: any) => d.name === dbName);
				expect(found).toBeDefined();
				expect(found!.version).toBe(1);
			});
		});

		// =================================================================
		// IDBDatabase.createObjectStore() — based on WPT
		// idbdatabase_createObjectStore.any.js
		// =================================================================
		describe("IDBDatabase.createObjectStore()", () => {
			test("create object store with name", async () => {
				setup();
				const db = await openDB(factory, uniqueName(), 1, (db) => {
					db.createObjectStore("myStore");
				});
				expect(db.objectStoreNames).toContain("myStore");
				db.close();
			});

			test("create object store with keyPath", async () => {
				setup();
				const db = await openDB(factory, uniqueName(), 1, (db) => {
					const store = db.createObjectStore("store", {
						keyPath: "id",
					});
					expect(store.keyPath).toBe("id");
					expect(store.autoIncrement).toBe(false);
				});
				db.close();
			});

			test("create object store with autoIncrement", async () => {
				setup();
				const db = await openDB(factory, uniqueName(), 1, (db) => {
					const store = db.createObjectStore("store", {
						autoIncrement: true,
					});
					expect(store.autoIncrement).toBe(true);
				});
				db.close();
			});

			test("create object store with keyPath and autoIncrement", async () => {
				setup();
				const db = await openDB(factory, uniqueName(), 1, (db) => {
					const store = db.createObjectStore("store", {
						keyPath: "id",
						autoIncrement: true,
					});
					expect(store.keyPath).toBe("id");
					expect(store.autoIncrement).toBe(true);
				});
				db.close();
			});

			test("create multiple object stores", async () => {
				setup();
				const db = await openDB(factory, uniqueName(), 1, (db) => {
					db.createObjectStore("store1");
					db.createObjectStore("store2");
					db.createObjectStore("store3");
				});
				expect(db.objectStoreNames.length).toBe(3);
				db.close();
			});

			test("duplicate object store name throws ConstraintError", async () => {
				setup();
				const db = await openDB(factory, uniqueName(), 1, (db) => {
					db.createObjectStore("dupe");
					expect(() => db.createObjectStore("dupe")).toThrow();
				});
				db.close();
			});

			test("empty string name works", async () => {
				setup();
				const db = await openDB(factory, uniqueName(), 1, (db) => {
					db.createObjectStore("");
				});
				expect(db.objectStoreNames).toContain("");
				db.close();
			});
		});

		// =================================================================
		// IDBDatabase.deleteObjectStore()
		// =================================================================
		describe("IDBDatabase.deleteObjectStore()", () => {
			test("delete an object store during upgrade", async () => {
				setup();
				const dbName = uniqueName();
				const db1 = await openDB(factory, dbName, 1, (db) => {
					db.createObjectStore("store");
				});
				db1.close();

				const db2 = await openDB(factory, dbName, 2, (db) => {
					db.deleteObjectStore("store");
				});
				expect(db2.objectStoreNames).not.toContain("store");
				db2.close();
			});
		});

		// =================================================================
		// IDBObjectStore CRUD — based on WPT idbobjectstore-*.any.js
		// =================================================================
		describe("IDBObjectStore.put() / get()", () => {
			test("put and get with out-of-line key", async () => {
				setup();
				const db = await openDB(factory, uniqueName(), 1, (db) => {
					db.createObjectStore("store");
				});

				const tx = db.transaction("store", "readwrite");
				const store = tx.objectStore("store");
				store.put("hello", 1);
				const result = await reqToPromise(store.get(1));
				expect(result).toBe("hello");
				db.close();
			});

			test("put and get with in-line key (keyPath)", async () => {
				setup();
				const db = await openDB(factory, uniqueName(), 1, (db) => {
					db.createObjectStore("store", {keyPath: "id"});
				});

				const tx = db.transaction("store", "readwrite");
				const store = tx.objectStore("store");
				store.put({id: 1, name: "Alice"});
				const result = await reqToPromise(store.get(1));
				expect(result.name).toBe("Alice");
				db.close();
			});

			test("put overwrites existing record", async () => {
				setup();
				const db = await openDB(factory, uniqueName(), 1, (db) => {
					db.createObjectStore("store");
				});

				const tx = db.transaction("store", "readwrite");
				const store = tx.objectStore("store");
				store.put("first", 1);
				store.put("second", 1);
				const result = await reqToPromise(store.get(1));
				expect(result).toBe("second");
				db.close();
			});

			test("get non-existent key returns undefined", async () => {
				setup();
				const db = await openDB(factory, uniqueName(), 1, (db) => {
					db.createObjectStore("store");
				});

				const tx = db.transaction("store", "readonly");
				const store = tx.objectStore("store");
				const result = await reqToPromise(store.get(999));
				expect(result).toBeUndefined();
				db.close();
			});

			test("put complex value", async () => {
				setup();
				const db = await openDB(factory, uniqueName(), 1, (db) => {
					db.createObjectStore("store");
				});

				const obj = {
					name: "test",
					nested: {a: 1, b: [2, 3]},
					arr: [1, "two", {three: 3}],
				};
				const tx = db.transaction("store", "readwrite");
				const store = tx.objectStore("store");
				store.put(obj, "complex");
				const result = await reqToPromise(store.get("complex"));
				expect(result.name).toBe("test");
				expect(result.nested.a).toBe(1);
				expect(result.arr[1]).toBe("two");
				db.close();
			});
		});

		describe("IDBObjectStore.add()", () => {
			test("add succeeds for new key", async () => {
				setup();
				const db = await openDB(factory, uniqueName(), 1, (db) => {
					db.createObjectStore("store");
				});

				const tx = db.transaction("store", "readwrite");
				const store = tx.objectStore("store");
				const key = await reqToPromise(store.add("value", 1));
				expect(key).toBe(1);
				db.close();
			});

			test("add throws ConstraintError for duplicate key", async () => {
				setup();
				const db = await openDB(factory, uniqueName(), 1, (db) => {
					db.createObjectStore("store");
				});

				const tx = db.transaction("store", "readwrite");
				const store = tx.objectStore("store");

				// Issue both adds in the same sync tick; the second
				// should fail with ConstraintError on its onerror.
				store.add("first", 1);
				const req2 = store.add("second", 1);
				const err = await new Promise<any>((resolve) => {
					req2.onerror = (e: any) => {
						e.preventDefault?.();
						resolve(req2.error);
					};
					req2.onsuccess = () =>
						resolve(new Error("Should not succeed"));
				});
				expect(err.name).toBe("ConstraintError");
				db.close();
			});
		});

		describe("IDBObjectStore.delete()", () => {
			test("delete a record by key", async () => {
				setup();
				const db = await openDB(factory, uniqueName(), 1, (db) => {
					db.createObjectStore("store");
				});

				const tx = db.transaction("store", "readwrite");
				const store = tx.objectStore("store");
				store.put("value", 1);
				await reqToPromise(store.delete(1));

				const result = await reqToPromise(store.get(1));
				expect(result).toBeUndefined();
				db.close();
			});

			test("delete with key range", async () => {
				setup();
				const db = await openDB(factory, uniqueName(), 1, (db) => {
					db.createObjectStore("store");
				});

				const tx = db.transaction("store", "readwrite");
				const store = tx.objectStore("store");
				store.put("a", 1);
				store.put("b", 2);
				store.put("c", 3);
				store.put("d", 4);

				const range = IDBKeyRange.bound(2, 3);
				await reqToPromise(store.delete(range));

				const count = await reqToPromise(store.count());
				expect(count).toBe(2);
				db.close();
			});
		});

		describe("IDBObjectStore.clear()", () => {
			test("clear removes all records", async () => {
				setup();
				const db = await openDB(factory, uniqueName(), 1, (db) => {
					db.createObjectStore("store");
				});

				const tx = db.transaction("store", "readwrite");
				const store = tx.objectStore("store");
				store.put("a", 1);
				store.put("b", 2);
				store.put("c", 3);
				await reqToPromise(store.clear());

				const count = await reqToPromise(store.count());
				expect(count).toBe(0);
				db.close();
			});
		});

		describe("IDBObjectStore.count()", () => {
			test("count empty store returns 0", async () => {
				setup();
				const db = await openDB(factory, uniqueName(), 1, (db) => {
					db.createObjectStore("store");
				});

				const tx = db.transaction("store", "readonly");
				const store = tx.objectStore("store");
				const count = await reqToPromise(store.count());
				expect(count).toBe(0);
				db.close();
			});

			test("count returns correct number", async () => {
				setup();
				const db = await openDB(factory, uniqueName(), 1, (db) => {
					db.createObjectStore("store");
				});

				const tx = db.transaction("store", "readwrite");
				const store = tx.objectStore("store");
				store.put("a", 1);
				store.put("b", 2);
				store.put("c", 3);

				const count = await reqToPromise(store.count());
				expect(count).toBe(3);
				db.close();
			});

			test("count with key range", async () => {
				setup();
				const db = await openDB(factory, uniqueName(), 1, (db) => {
					db.createObjectStore("store");
				});

				const tx = db.transaction("store", "readwrite");
				const store = tx.objectStore("store");
				for (let i = 1; i <= 10; i++) {
					store.put(`val${i}`, i);
				}

				const range = IDBKeyRange.bound(3, 7);
				const count = await reqToPromise(store.count(range));
				expect(count).toBe(5);
				db.close();
			});
		});

		describe("IDBObjectStore.getAll()", () => {
			test("getAll returns all records", async () => {
				setup();
				const db = await openDB(factory, uniqueName(), 1, (db) => {
					db.createObjectStore("store");
				});

				const tx = db.transaction("store", "readwrite");
				const store = tx.objectStore("store");
				store.put("a", 1);
				store.put("b", 2);
				store.put("c", 3);

				const all = await reqToPromise(store.getAll());
				expect(all.length).toBe(3);
				expect(all).toContain("a");
				expect(all).toContain("b");
				expect(all).toContain("c");
				db.close();
			});

			test("getAll with count limit", async () => {
				setup();
				const db = await openDB(factory, uniqueName(), 1, (db) => {
					db.createObjectStore("store");
				});

				const tx = db.transaction("store", "readwrite");
				const store = tx.objectStore("store");
				store.put("a", 1);
				store.put("b", 2);
				store.put("c", 3);

				const limited = await reqToPromise(store.getAll(null, 2));
				expect(limited.length).toBe(2);
				db.close();
			});

			test("getAll with key range", async () => {
				setup();
				const db = await openDB(factory, uniqueName(), 1, (db) => {
					db.createObjectStore("store");
				});

				const tx = db.transaction("store", "readwrite");
				const store = tx.objectStore("store");
				for (let i = 1; i <= 5; i++) {
					store.put(`val${i}`, i);
				}

				const range = IDBKeyRange.bound(2, 4);
				const results = await reqToPromise(store.getAll(range));
				expect(results.length).toBe(3);
				db.close();
			});
		});

		describe("IDBObjectStore.getAllKeys()", () => {
			test("getAllKeys returns all keys in order", async () => {
				setup();
				const db = await openDB(factory, uniqueName(), 1, (db) => {
					db.createObjectStore("store");
				});

				const tx = db.transaction("store", "readwrite");
				const store = tx.objectStore("store");
				store.put("c", 3);
				store.put("a", 1);
				store.put("b", 2);

				const keys = await reqToPromise(store.getAllKeys());
				expect(keys).toEqual([1, 2, 3]);
				db.close();
			});

			test("getAllKeys with count limit", async () => {
				setup();
				const db = await openDB(factory, uniqueName(), 1, (db) => {
					db.createObjectStore("store");
				});

				const tx = db.transaction("store", "readwrite");
				const store = tx.objectStore("store");
				store.put("a", 1);
				store.put("b", 2);
				store.put("c", 3);

				const keys = await reqToPromise(store.getAllKeys(null, 2));
				expect(keys).toEqual([1, 2]);
				db.close();
			});
		});

		// =================================================================
		// Auto-increment — based on WPT idbobjectstore-autoincrement*.any.js
		// =================================================================
		describe("Auto-increment", () => {
			test("auto-increment generates keys", async () => {
				setup();
				const db = await openDB(factory, uniqueName(), 1, (db) => {
					db.createObjectStore("store", {autoIncrement: true});
				});

				const tx = db.transaction("store", "readwrite");
				const store = tx.objectStore("store");
				const k1 = await reqToPromise(store.add("first"));
				const k2 = await reqToPromise(store.add("second"));
				const k3 = await reqToPromise(store.add("third"));

				expect(k1).toBe(1);
				expect(k2).toBe(2);
				expect(k3).toBe(3);
				db.close();
			});

			test("auto-increment with keyPath injects key", async () => {
				setup();
				const db = await openDB(factory, uniqueName(), 1, (db) => {
					db.createObjectStore("store", {
						keyPath: "id",
						autoIncrement: true,
					});
				});

				const tx = db.transaction("store", "readwrite");
				const store = tx.objectStore("store");
				store.add({name: "Alice"});
				store.add({name: "Bob"});

				const all = await reqToPromise(store.getAll());
				expect(all[0].id).toBeDefined();
				expect(all[1].id).toBeDefined();
				expect(all[0].name).toBe("Alice");
				expect(all[1].name).toBe("Bob");
				db.close();
			});
		});

		// =================================================================
		// IDBTransaction — based on WPT idbtransaction-*.any.js
		// =================================================================
		describe("IDBTransaction", () => {
			test("transaction auto-commits on success", async () => {
				setup();
				const db = await openDB(factory, uniqueName(), 1, (db) => {
					db.createObjectStore("store");
				});

				const tx = db.transaction("store", "readwrite");
				const store = tx.objectStore("store");
				store.put("value", 1);

				await txComplete(tx);

				// Verify data persisted via new transaction
				const tx2 = db.transaction("store", "readonly");
				const result = await reqToPromise(
					tx2.objectStore("store").get(1),
				);
				expect(result).toBe("value");
				db.close();
			});

			test("transaction abort rolls back changes", async () => {
				setup();
				const db = await openDB(factory, uniqueName(), 1, (db) => {
					db.createObjectStore("store");
				});

				// First, put some data
				const tx1 = db.transaction("store", "readwrite");
				tx1.objectStore("store").put("original", 1);
				await txComplete(tx1);

				// Now abort a transaction that modifies data
				const tx2 = db.transaction("store", "readwrite");
				tx2.objectStore("store").put("modified", 1);
				tx2.abort();

				// Verify original data remains
				const tx3 = db.transaction("store", "readonly");
				const result = await reqToPromise(
					tx3.objectStore("store").get(1),
				);
				expect(result).toBe("original");
				db.close();
			});

			test("readonly transaction cannot write", async () => {
				setup();
				const db = await openDB(factory, uniqueName(), 1, (db) => {
					db.createObjectStore("store");
				});

				const tx = db.transaction("store", "readonly");
				const store = tx.objectStore("store");

				expect(() => store.put("value", 1)).toThrow();
				db.close();
			});

			test("transaction scope restricts access", async () => {
				setup();
				const db = await openDB(factory, uniqueName(), 1, (db) => {
					db.createObjectStore("store1");
					db.createObjectStore("store2");
				});

				const tx = db.transaction("store1", "readonly");
				expect(() => tx.objectStore("store2")).toThrow();
				db.close();
			});

			test("transaction over multiple stores", async () => {
				setup();
				const db = await openDB(factory, uniqueName(), 1, (db) => {
					db.createObjectStore("store1");
					db.createObjectStore("store2");
				});

				const tx = db.transaction(
					["store1", "store2"],
					"readwrite",
				);
				tx.objectStore("store1").put("val1", 1);
				tx.objectStore("store2").put("val2", 1);
				await txComplete(tx);

				const tx2 = db.transaction(
					["store1", "store2"],
					"readonly",
				);
				const r1 = await reqToPromise(
					tx2.objectStore("store1").get(1),
				);
				const r2 = await reqToPromise(
					tx2.objectStore("store2").get(1),
				);
				expect(r1).toBe("val1");
				expect(r2).toBe("val2");
				db.close();
			});
		});

		// =================================================================
		// IDBKeyRange — based on WPT idbkeyrange*.any.js
		// =================================================================
		describe("IDBKeyRange", () => {
			test("IDBKeyRange.only()", () => {
				setup();
				const range = IDBKeyRange.only(5);
				expect(range.lower).toBe(5);
				expect(range.upper).toBe(5);
				expect(range.lowerOpen).toBe(false);
				expect(range.upperOpen).toBe(false);
				expect(range.includes(5)).toBe(true);
				expect(range.includes(4)).toBe(false);
				expect(range.includes(6)).toBe(false);
			});

			test("IDBKeyRange.lowerBound()", () => {
				setup();
				const range = IDBKeyRange.lowerBound(5);
				expect(range.lower).toBe(5);
				expect(range.lowerOpen).toBe(false);
				expect(range.includes(5)).toBe(true);
				expect(range.includes(6)).toBe(true);
				expect(range.includes(4)).toBe(false);
			});

			test("IDBKeyRange.lowerBound() open", () => {
				setup();
				const range = IDBKeyRange.lowerBound(5, true);
				expect(range.lowerOpen).toBe(true);
				expect(range.includes(5)).toBe(false);
				expect(range.includes(6)).toBe(true);
			});

			test("IDBKeyRange.upperBound()", () => {
				setup();
				const range = IDBKeyRange.upperBound(5);
				expect(range.upper).toBe(5);
				expect(range.upperOpen).toBe(false);
				expect(range.includes(5)).toBe(true);
				expect(range.includes(4)).toBe(true);
				expect(range.includes(6)).toBe(false);
			});

			test("IDBKeyRange.upperBound() open", () => {
				setup();
				const range = IDBKeyRange.upperBound(5, true);
				expect(range.upperOpen).toBe(true);
				expect(range.includes(5)).toBe(false);
				expect(range.includes(4)).toBe(true);
			});

			test("IDBKeyRange.bound()", () => {
				setup();
				const range = IDBKeyRange.bound(3, 7);
				expect(range.lower).toBe(3);
				expect(range.upper).toBe(7);
				expect(range.lowerOpen).toBe(false);
				expect(range.upperOpen).toBe(false);
				expect(range.includes(3)).toBe(true);
				expect(range.includes(5)).toBe(true);
				expect(range.includes(7)).toBe(true);
				expect(range.includes(2)).toBe(false);
				expect(range.includes(8)).toBe(false);
			});

			test("IDBKeyRange.bound() open", () => {
				setup();
				const range = IDBKeyRange.bound(3, 7, true, true);
				expect(range.lowerOpen).toBe(true);
				expect(range.upperOpen).toBe(true);
				expect(range.includes(3)).toBe(false);
				expect(range.includes(7)).toBe(false);
				expect(range.includes(4)).toBe(true);
				expect(range.includes(6)).toBe(true);
			});
		});

		// =================================================================
		// IDBIndex — based on WPT idbindex-*.any.js
		// =================================================================
		describe("IDBIndex", () => {
			test("create index and retrieve by index key", async () => {
				setup();
				const db = await openDB(factory, uniqueName(), 1, (db) => {
					const store = db.createObjectStore("store", {
						keyPath: "id",
					});
					store.createIndex("byName", "name");
				});

				const tx = db.transaction("store", "readwrite");
				const store = tx.objectStore("store");
				store.put({id: 1, name: "Alice"});
				store.put({id: 2, name: "Bob"});
				store.put({id: 3, name: "Charlie"});

				const index = store.index("byName");
				const result = await reqToPromise(index.get("Bob"));
				expect(result.id).toBe(2);
				db.close();
			});

			test("index getAll", async () => {
				setup();
				const db = await openDB(factory, uniqueName(), 1, (db) => {
					const store = db.createObjectStore("store", {
						keyPath: "id",
					});
					store.createIndex("byCategory", "category");
				});

				const tx = db.transaction("store", "readwrite");
				const store = tx.objectStore("store");
				store.put({id: 1, category: "A", name: "one"});
				store.put({id: 2, category: "B", name: "two"});
				store.put({id: 3, category: "A", name: "three"});

				const index = store.index("byCategory");
				const results = await reqToPromise(index.getAll("A"));
				expect(results.length).toBe(2);
				db.close();
			});

			test("index count", async () => {
				setup();
				const db = await openDB(factory, uniqueName(), 1, (db) => {
					const store = db.createObjectStore("store", {
						keyPath: "id",
					});
					store.createIndex("byCategory", "category");
				});

				const tx = db.transaction("store", "readwrite");
				const store = tx.objectStore("store");
				store.put({id: 1, category: "A"});
				store.put({id: 2, category: "B"});
				store.put({id: 3, category: "A"});

				const index = store.index("byCategory");
				const count = await reqToPromise(index.count("A"));
				expect(count).toBe(2);
				db.close();
			});

			test("unique index rejects duplicates", async () => {
				setup();
				const db = await openDB(factory, uniqueName(), 1, (db) => {
					const store = db.createObjectStore("store", {
						keyPath: "id",
					});
					store.createIndex("byEmail", "email", {unique: true});
				});

				const tx = db.transaction("store", "readwrite");
				const store = tx.objectStore("store");

				// Issue both puts in the same sync tick
				store.put({id: 1, email: "alice@example.com"});
				const req2 = store.put({id: 2, email: "alice@example.com"});
				const err = await new Promise<any>((resolve) => {
					req2.onerror = (e: any) => {
						e.preventDefault?.();
						resolve(req2.error);
					};
					req2.onsuccess = () =>
						resolve(new Error("Should not succeed"));
				});
				expect(err.name).toBe("ConstraintError");
				db.close();
			});

			test("deleteIndex removes the index", async () => {
				setup();
				const dbName = uniqueName();
				const db1 = await openDB(factory, dbName, 1, (db) => {
					const store = db.createObjectStore("store", {
						keyPath: "id",
					});
					store.createIndex("byName", "name");
				});
				db1.close();

				const db2 = await openDB(factory, dbName, 2, (_db, tx) => {
					const store = tx.objectStore("store");
					store.deleteIndex("byName");
				});

				const tx = db2.transaction("store", "readonly");
				const store = tx.objectStore("store");
				expect(() => store.index("byName")).toThrow();
				db2.close();
			});

			test("index getKey returns primary key", async () => {
				setup();
				const db = await openDB(factory, uniqueName(), 1, (db) => {
					const store = db.createObjectStore("store", {
						keyPath: "id",
					});
					store.createIndex("byName", "name");
				});

				const tx = db.transaction("store", "readwrite");
				const store = tx.objectStore("store");
				store.put({id: 42, name: "Alice"});

				const index = store.index("byName");
				const key = await reqToPromise(index.getKey("Alice"));
				expect(key).toBe(42);
				db.close();
			});
		});

		// =================================================================
		// IDBCursor — based on WPT idbcursor-*.any.js
		// =================================================================
		describe("IDBCursor", () => {
			test("openCursor iterates records in key order", async () => {
				setup();
				const db = await openDB(factory, uniqueName(), 1, (db) => {
					db.createObjectStore("store");
				});

				const tx = db.transaction("store", "readwrite");
				const store = tx.objectStore("store");
				store.put("c", 3);
				store.put("a", 1);
				store.put("b", 2);

				// All issued in the same tick; backend ops are synchronous
				const results = await cursorToArray(store.openCursor());
				expect(results.length).toBe(3);
				expect(results[0].key).toBe(1);
				expect(results[0].value).toBe("a");
				expect(results[1].key).toBe(2);
				expect(results[2].key).toBe(3);
				db.close();
			});

			test("openCursor on empty store returns null", async () => {
				setup();
				const db = await openDB(factory, uniqueName(), 1, (db) => {
					db.createObjectStore("store");
				});

				const tx = db.transaction("store", "readonly");
				const store = tx.objectStore("store");

				const result = await reqToPromise(store.openCursor());
				expect(result).toBeNull();
				db.close();
			});

		test("openCursor with key range", async () => {
				setup();
				const db = await openDB(factory, uniqueName(), 1, (db) => {
					db.createObjectStore("store");
				});

				const tx = db.transaction("store", "readwrite");
				const store = tx.objectStore("store");
				for (let i = 1; i <= 10; i++) {
					store.put(`val${i}`, i);
				}

				const range = IDBKeyRange.bound(3, 7);
				const results = await cursorToArray(store.openCursor(range));
				expect(results.length).toBe(5);
				expect(results[0].key).toBe(3);
				expect(results[4].key).toBe(7);
				db.close();
			});

		test("openKeyCursor iterates keys only", async () => {
				setup();
				const db = await openDB(factory, uniqueName(), 1, (db) => {
					db.createObjectStore("store");
				});

				const tx = db.transaction("store", "readwrite");
				const store = tx.objectStore("store");
				store.put("a", 1);
				store.put("b", 2);

				const keys: any[] = [];
				const request = store.openKeyCursor();
				await new Promise<void>((resolve, reject) => {
					request.onsuccess = (e: any) => {
						const cursor = e.target?.result ?? request.result;
						if (cursor) {
							keys.push(cursor.key);
							cursor.continue();
						} else {
							resolve();
						}
					};
					request.onerror = () => reject(request.error);
				});
				expect(keys).toEqual([1, 2]);
				db.close();
			});
		});

		// =================================================================
		// Version change during upgrade — based on WPT
		// abort-in-initial-upgradeneeded.any.js
		// =================================================================
		describe("Version change abort", () => {
			test("abort during upgradeneeded rolls back", async () => {
				setup();
				const dbName = uniqueName();
				const request = factory.open(dbName, 1);

				const error = await new Promise<any>((resolve) => {
					request.onupgradeneeded = (e: any) => {
						const db = e.target?.result ?? request.result;
						db.createObjectStore("store");
						const tx = e.target?.transaction ?? request.transaction;
						tx.abort();
					};
					request.onsuccess = () =>
						resolve(new Error("Should not succeed"));
					request.onerror = () => resolve(request.error);
				});

				expect(error.name).toBe("AbortError");
			});
		});

		// =================================================================
		// Data during upgrade — based on WPT
		// idbdatabase_createObjectStore.any.js
		// =================================================================
		describe("Operations during upgrade", () => {
			test("add data during upgradeneeded", async () => {
				setup();
				const db = await openDB(factory, uniqueName(), 1, (db) => {
					const store = db.createObjectStore("store");
					for (let i = 0; i < 5; i++) {
						store.add(`object_${i}`, i);
					}
				});

				const tx = db.transaction("store", "readonly");
				const store = tx.objectStore("store");
				const result = await reqToPromise(store.get(3));
				expect(result).toBe("object_3");

				const count = await reqToPromise(store.count());
				expect(count).toBe(5);
				db.close();
			});

			test("create index during upgrade, query after", async () => {
				setup();
				const db = await openDB(factory, uniqueName(), 1, (db) => {
					const store = db.createObjectStore("store", {
						keyPath: "id",
					});
					store.createIndex("byName", "name");
					store.add({id: 1, name: "Alice"});
					store.add({id: 2, name: "Bob"});
				});

				const tx = db.transaction("store", "readonly");
				const store = tx.objectStore("store");
				const index = store.index("byName");
				const result = await reqToPromise(index.get("Alice"));
				expect(result.id).toBe(1);
				db.close();
			});
		});

		// =================================================================
		// Key types — based on WPT key-comparison, idb-binary-key-roundtrip
		// =================================================================
		describe("Key types", () => {
			test("number keys", async () => {
				setup();
				const db = await openDB(factory, uniqueName(), 1, (db) => {
					db.createObjectStore("store");
				});

				const tx = db.transaction("store", "readwrite");
				const store = tx.objectStore("store");
				store.put("neg", -1);
				store.put("zero", 0);
				store.put("pos", 1);
				store.put("float", 3.14);

				const keys = await reqToPromise(store.getAllKeys());
				expect(keys).toEqual([-1, 0, 1, 3.14]);
				db.close();
			});

			test("string keys", async () => {
				setup();
				const db = await openDB(factory, uniqueName(), 1, (db) => {
					db.createObjectStore("store");
				});

				const tx = db.transaction("store", "readwrite");
				const store = tx.objectStore("store");
				store.put("v1", "apple");
				store.put("v2", "banana");
				store.put("v3", "cherry");

				const keys = await reqToPromise(store.getAllKeys());
				expect(keys).toEqual(["apple", "banana", "cherry"]);
				db.close();
			});

			test("date keys", async () => {
				setup();
				const db = await openDB(factory, uniqueName(), 1, (db) => {
					db.createObjectStore("store");
				});

				const d1 = new Date("2020-01-01");
				const d2 = new Date("2021-01-01");
				const tx = db.transaction("store", "readwrite");
				const store = tx.objectStore("store");
				store.put("later", d2);
				store.put("earlier", d1);

				const keys = await reqToPromise(store.getAllKeys());
				expect(keys.length).toBe(2);
				expect(keys[0].getTime()).toBe(d1.getTime());
				expect(keys[1].getTime()).toBe(d2.getTime());
				db.close();
			});

			test("array keys", async () => {
				setup();
				const db = await openDB(factory, uniqueName(), 1, (db) => {
					db.createObjectStore("store");
				});

				const tx = db.transaction("store", "readwrite");
				const store = tx.objectStore("store");
				store.put("v1", [1, 1]);
				store.put("v2", [1, 2]);
				store.put("v3", [2, 1]);

				const keys = await reqToPromise(store.getAllKeys());
				expect(keys).toEqual([
					[1, 1],
					[1, 2],
					[2, 1],
				]);
				db.close();
			});
		});

		// =================================================================
		// Persistence (close + reopen) — important for backend verification
		// =================================================================
		describe("Persistence", () => {
			test("data persists across close/reopen", async () => {
				setup();
				const dbName = uniqueName();
				const db1 = await openDB(factory, dbName, 1, (db) => {
					db.createObjectStore("store");
				});

				const tx1 = db1.transaction("store", "readwrite");
				tx1.objectStore("store").put("persisted", 1);
				await txComplete(tx1);
				db1.close();

				const db2 = await openDB(factory, dbName, 1);
				const tx2 = db2.transaction("store", "readonly");
				const result = await reqToPromise(
					tx2.objectStore("store").get(1),
				);
				expect(result).toBe("persisted");
				db2.close();
			});

			test("object store structure persists", async () => {
				setup();
				const dbName = uniqueName();
				const db1 = await openDB(factory, dbName, 1, (db) => {
					const store = db.createObjectStore("store", {
						keyPath: "id",
						autoIncrement: true,
					});
					store.createIndex("byName", "name");
				});
				db1.close();

				const db2 = await openDB(factory, dbName, 1);
				expect(db2.objectStoreNames).toContain("store");

				const tx = db2.transaction("store", "readonly");
				const store = tx.objectStore("store");
				expect(store.keyPath).toBe("id");
				expect(store.autoIncrement).toBe(true);
				expect(store.indexNames).toContain("byName");
				db2.close();
			});
		});
	});
}
