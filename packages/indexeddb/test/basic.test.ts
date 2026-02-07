import {describe, expect, it, beforeEach} from "bun:test";
import {IDBFactory} from "../src/factory.js";
import {MemoryBackend} from "../src/memory.js";

let factory: IDBFactory;

beforeEach(() => {
	factory = new IDBFactory(new MemoryBackend());
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

describe("IDBFactory.open", () => {
	it("creates a new database", async () => {
		const db = await openDB("test", 1, (db) => {
			db.createObjectStore("store");
		});
		expect(db).toBeDefined();
		expect(db.name).toBe("test");
		expect(db.version).toBe(1);
	});

	it("runs upgradeneeded for new databases", async () => {
		let upgraded = false;
		await openDB("test", 1, () => {
			upgraded = true;
		});
		expect(upgraded).toBe(true);
	});

	it("runs upgradeneeded when version increases", async () => {
		await openDB("test", 1, (db) => {
			db.createObjectStore("store");
		});

		let oldVer = -1;
		await openDB("test", 2, (db, oldVersion) => {
			oldVer = oldVersion;
			db.createObjectStore("store2");
		});
		expect(oldVer).toBe(1);
	});

	it("rejects when requested version is less than current", async () => {
		await openDB("test", 2, (db) => {
			db.createObjectStore("store");
		});

		try {
			await openDB("test", 1);
			throw new Error("Should have thrown");
		} catch (err: any) {
			expect(err.name).toBe("VersionError");
		}
	});
});

describe("IDBFactory.deleteDatabase", () => {
	it("deletes an existing database", async () => {
		await openDB("test", 1, (db) => {
			db.createObjectStore("store");
		});

		await new Promise<void>((resolve, reject) => {
			const request = factory.deleteDatabase("test");
			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error);
		});

		const dbs = await factory.databases();
		expect(dbs.find((d) => d.name === "test")).toBeUndefined();
	});
});

describe("IDBFactory.databases", () => {
	it("lists databases", async () => {
		await openDB("db1", 1, (db) => db.createObjectStore("s"));
		await openDB("db2", 2, (db) => db.createObjectStore("s"));

		const dbs = await factory.databases();
		expect(dbs).toContainEqual({name: "db1", version: 1});
		expect(dbs).toContainEqual({name: "db2", version: 2});
	});
});

describe("IDBFactory.cmp", () => {
	it("compares numbers", () => {
		expect(factory.cmp(1, 2)).toBe(-1);
		expect(factory.cmp(2, 2)).toBe(0);
		expect(factory.cmp(3, 2)).toBe(1);
	});

	it("compares strings", () => {
		expect(factory.cmp("a", "b")).toBe(-1);
		expect(factory.cmp("a", "a")).toBe(0);
		expect(factory.cmp("b", "a")).toBe(1);
	});
});

describe("IDBObjectStore CRUD", () => {
	it("put and get", async () => {
		const db = await openDB("test", 1, (db) => {
			db.createObjectStore("store");
		});

		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction("store", "readwrite");
			const store = tx.objectStore("store");
			const req = store.put("hello", 1);
			req.onsuccess = () => {
				// Now get it
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

	it("put overwrites existing", async () => {
		const db = await openDB("test", 1, (db) => {
			db.createObjectStore("store");
		});

		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction("store", "readwrite");
			const store = tx.objectStore("store");
			store.put("first", 1);
			const req = store.put("second", 1);
			req.onsuccess = () => {
				const getReq = store.get(1);
				getReq.onsuccess = () => {
					expect(getReq.result).toBe("second");
					resolve();
				};
				getReq.onerror = () => reject(getReq.error);
			};
			req.onerror = () => reject(req.error);
		});
	});

	it("add fails on duplicate", async () => {
		const db = await openDB("test", 1, (db) => {
			db.createObjectStore("store");
		});

		const result = await new Promise<string>((resolve) => {
			const tx = db.transaction("store", "readwrite");
			const store = tx.objectStore("store");
			store.add("first", 1);
			const req = store.add("second", 1);
			req.onsuccess = () => resolve("should not succeed");
			req.onerror = () => resolve("correctly errored");
			tx.onabort = () => resolve("correctly errored");
		});
		expect(result).toBe("correctly errored");
	});

	it("delete removes a record", async () => {
		const db = await openDB("test", 1, (db) => {
			db.createObjectStore("store");
		});

		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction("store", "readwrite");
			const store = tx.objectStore("store");
			store.put("hello", 1);
			const req = store.delete(1);
			req.onsuccess = () => {
				const getReq = store.get(1);
				getReq.onsuccess = () => {
					expect(getReq.result).toBeUndefined();
					resolve();
				};
				getReq.onerror = () => reject(getReq.error);
			};
			req.onerror = () => reject(req.error);
		});
	});

	it("clear removes all records", async () => {
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

	it("count counts records", async () => {
		const db = await openDB("test", 1, (db) => {
			db.createObjectStore("store");
		});

		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction("store", "readwrite");
			const store = tx.objectStore("store");
			store.put("a", 1);
			store.put("b", 2);
			store.put("c", 3);
			const req = store.count();
			req.onsuccess = () => {
				expect(req.result).toBe(3);
				resolve();
			};
			req.onerror = () => reject(req.error);
		});
	});

	it("getAll returns all matching", async () => {
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
				resolve();
			};
			req.onerror = () => reject(req.error);
		});
	});

	it("getAll with count limit", async () => {
		const db = await openDB("test", 1, (db) => {
			db.createObjectStore("store");
		});

		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction("store", "readwrite");
			const store = tx.objectStore("store");
			store.put("a", 1);
			store.put("b", 2);
			store.put("c", 3);
			const req = store.getAll(null, 2);
			req.onsuccess = () => {
				expect(req.result).toEqual(["a", "b"]);
				resolve();
			};
			req.onerror = () => reject(req.error);
		});
	});

	it("getAllKeys returns keys", async () => {
		const db = await openDB("test", 1, (db) => {
			db.createObjectStore("store");
		});

		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction("store", "readwrite");
			const store = tx.objectStore("store");
			store.put("a", 1);
			store.put("b", 2);
			const req = store.getAllKeys();
			req.onsuccess = () => {
				expect(req.result).toEqual([1, 2]);
				resolve();
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
});

describe("keyPath stores", () => {
	it("extracts key from value using keyPath", async () => {
		const db = await openDB("test", 1, (db) => {
			db.createObjectStore("store", {keyPath: "id"});
		});

		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction("store", "readwrite");
			const store = tx.objectStore("store");
			const req = store.put({id: 1, name: "test"});
			req.onsuccess = () => {
				expect(req.result).toBe(1);
				const getReq = store.get(1);
				getReq.onsuccess = () => {
					expect(getReq.result).toEqual({id: 1, name: "test"});
					resolve();
				};
				getReq.onerror = () => reject(getReq.error);
			};
			req.onerror = () => reject(req.error);
		});
	});

	it("rejects explicit key when keyPath is set", async () => {
		const db = await openDB("test", 1, (db) => {
			db.createObjectStore("store", {keyPath: "id"});
		});

		const result = await new Promise<string>((resolve) => {
			const tx = db.transaction("store", "readwrite");
			const store = tx.objectStore("store");
			const req = store.put({id: 1, name: "test"}, 999);
			req.onerror = () => resolve("correctly errored");
			req.onsuccess = () => resolve("should not succeed");
			tx.onabort = () => resolve("correctly errored");
		});
		expect(result).toBe("correctly errored");
	});
});

describe("autoIncrement", () => {
	it("generates keys automatically", async () => {
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

	it("autoIncrement with keyPath", async () => {
		const db = await openDB("test", 1, (db) => {
			db.createObjectStore("store", {keyPath: "id", autoIncrement: true});
		});

		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction("store", "readwrite");
			const store = tx.objectStore("store");
			const req = store.add({name: "test"});
			req.onsuccess = () => {
				expect(req.result).toBe(1);
				const getReq = store.get(1);
				getReq.onsuccess = () => {
					expect(getReq.result.id).toBe(1);
					expect(getReq.result.name).toBe("test");
					resolve();
				};
				getReq.onerror = () => reject(getReq.error);
			};
			req.onerror = () => reject(req.error);
		});
	});
});
