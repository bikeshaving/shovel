import {describe, expect, it, beforeEach, afterEach} from "bun:test";
import {IDBFactory} from "../src/factory.js";
import {SQLiteBackend} from "../src/sqlite.js";
import {mkdirSync, rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";

const testDir = join(tmpdir(), `idb-test-${process.pid}-${Date.now()}`);
let backend: SQLiteBackend;
let factory: IDBFactory;

beforeEach(() => {
	mkdirSync(testDir, {recursive: true});
	backend = new SQLiteBackend(testDir);
	factory = new IDBFactory(backend);
});

afterEach(() => {
	try {
		rmSync(testDir, {recursive: true, force: true});
	} catch {
		// Ignore cleanup errors
	}
});

function openDB(
	name: string,
	version: number,
	onUpgrade?: (db: any, oldVersion: number) => void,
): Promise<any> {
	return new Promise((resolve, reject) => {
		const request = factory.open(name, version);
		request.onupgradeneeded = (event: any) => {
			const db = request.result;
			onUpgrade?.(db, event.oldVersion);
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

describe("SQLite backend: basic operations", () => {
	it("creates and opens a database", async () => {
		const db = await openDB("test", 1, (db) => {
			db.createObjectStore("store");
		});
		expect(db.name).toBe("test");
		expect(db.version).toBe(1);
	});

	it("put and get", async () => {
		const db = await openDB("test", 1, (db) => {
			db.createObjectStore("store");
		});

		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction("store", "readwrite");
			const store = tx.objectStore("store");
			const req = store.put("hello", 1);
			req.onsuccess = () => {
				const getReq = store.get(1);
				getReq.onsuccess = () => {
					expect(getReq.result).toBe("hello");
					resolve();
				};
				getReq.onerror = () => reject(getReq.error);
			};
			req.onerror = () => reject(req.error);
		});
	});

	it("stores complex objects", async () => {
		const db = await openDB("test", 1, (db) => {
			db.createObjectStore("store");
		});

		const obj = {name: "test", nested: {value: 42}, arr: [1, 2, 3]};
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction("store", "readwrite");
			const store = tx.objectStore("store");
			const req = store.put(obj, "key1");
			req.onsuccess = () => {
				const getReq = store.get("key1");
				getReq.onsuccess = () => {
					expect(getReq.result).toEqual(obj);
					resolve();
				};
				getReq.onerror = () => reject(getReq.error);
			};
			req.onerror = () => reject(req.error);
		});
	});

	it("delete and clear", async () => {
		const db = await openDB("test", 1, (db) => {
			db.createObjectStore("store");
		});

		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction("store", "readwrite");
			const store = tx.objectStore("store");
			store.put("a", 1);
			store.put("b", 2);
			store.put("c", 3);
			const req = store.clear();
			req.onsuccess = () => {
				const countReq = store.count();
				countReq.onsuccess = () => {
					expect(countReq.result).toBe(0);
					resolve();
				};
				countReq.onerror = () => reject(countReq.error);
			};
			req.onerror = () => reject(req.error);
		});
	});

	it("getAll and getAllKeys", async () => {
		const db = await openDB("test", 1, (db) => {
			db.createObjectStore("store");
		});

		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction("store", "readwrite");
			const store = tx.objectStore("store");
			store.put("a", 1);
			store.put("b", 2);
			store.put("c", 3);
			const req = store.getAll();
			req.onsuccess = () => {
				expect(req.result).toEqual(["a", "b", "c"]);
				const keysReq = store.getAllKeys();
				keysReq.onsuccess = () => {
					expect(keysReq.result).toEqual([1, 2, 3]);
					resolve();
				};
				keysReq.onerror = () => reject(keysReq.error);
			};
			req.onerror = () => reject(req.error);
		});
	});

	it("autoIncrement", async () => {
		const db = await openDB("test", 1, (db) => {
			db.createObjectStore("store", {autoIncrement: true});
		});

		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction("store", "readwrite");
			const store = tx.objectStore("store");
			const req1 = store.add("first");
			req1.onsuccess = () => {
				expect(req1.result).toBe(1);
				const req2 = store.add("second");
				req2.onsuccess = () => {
					expect(req2.result).toBe(2);
					resolve();
				};
				req2.onerror = () => reject(req2.error);
			};
			req1.onerror = () => reject(req1.error);
		});
	});
});

describe("SQLite backend: persistence", () => {
	it("data persists after close and reopen", async () => {
		const db = await openDB("persist", 1, (db) => {
			db.createObjectStore("store");
		});

		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction("store", "readwrite");
			const store = tx.objectStore("store");
			store.put("hello", "key1");
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});

		// Close and reopen
		backend.close("persist");
		const backend2 = new SQLiteBackend(testDir);
		const factory2 = new IDBFactory(backend2);

		const db2 = await new Promise<any>((resolve, reject) => {
			const request = factory2.open("persist", 1);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});

		await new Promise<void>((resolve, reject) => {
			const tx = db2.transaction("store", "readonly");
			const store = tx.objectStore("store");
			const req = store.get("key1");
			req.onsuccess = () => {
				expect(req.result).toBe("hello");
				resolve();
			};
			req.onerror = () => reject(req.error);
		});

		backend2.close("persist");
	});
});

describe("SQLite backend: cursors", () => {
	it("iterates with cursor", async () => {
		const db = await openDB("test", 1, (db) => {
			db.createObjectStore("store");
		});

		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction("store", "readwrite");
			const store = tx.objectStore("store");
			store.put("a", 1);
			store.put("b", 2);
			store.put("c", 3);
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});

		const results: Array<{key: any; value: any}> = [];
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction("store", "readonly");
			const store = tx.objectStore("store");
			const req = store.openCursor();
			req.onsuccess = () => {
				const cursor = req.result;
				if (cursor) {
					results.push({key: cursor.key, value: cursor.value});
					cursor.continue();
				} else {
					resolve();
				}
			};
			req.onerror = () => reject(req.error);
		});

		expect(results.length).toBe(3);
		expect(results[0]).toEqual({key: 1, value: "a"});
	});
});

describe("SQLite backend: deleteDatabase", () => {
	it("removes the database", async () => {
		const db1 = await openDB("todelete", 1, (db) => {
			db.createObjectStore("store");
		});
		db1.close();

		await new Promise<void>((resolve, reject) => {
			const req = factory.deleteDatabase("todelete");
			req.onsuccess = () => resolve();
			req.onerror = () => reject(req.error);
		});

		const dbs = await factory.databases();
		expect(dbs.find((d) => d.name === "todelete")).toBeUndefined();
	});
});
