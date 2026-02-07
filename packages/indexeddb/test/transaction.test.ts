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
	onUpgrade?: (db: any) => void,
): Promise<any> {
	return new Promise((resolve, reject) => {
		const request = factory.open(name, version);
		request.onupgradeneeded = () => {
			onUpgrade?.(request.result);
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

describe("transaction auto-commit", () => {
	it("commits when no pending requests", async () => {
		const db = await openDB("test", 1, (db) => {
			db.createObjectStore("store");
		});

		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction("store", "readwrite");
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
			tx.onabort = () => reject(new Error("aborted"));

			const store = tx.objectStore("store");
			store.put("value", "key");
		});

		// Verify data persisted
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction("store", "readonly");
			const store = tx.objectStore("store");
			const req = store.get("key");
			req.onsuccess = () => {
				expect(req.result).toBe("value");
				resolve();
			};
			req.onerror = () => reject(req.error);
		});
	});

	it("fires complete event", async () => {
		const db = await openDB("test", 1, (db) => {
			db.createObjectStore("store");
		});

		const completed = await new Promise<boolean>((resolve) => {
			const tx = db.transaction("store", "readwrite");
			tx.oncomplete = () => resolve(true);

			const store = tx.objectStore("store");
			store.put("value", "key");
		});

		expect(completed).toBe(true);
	});
});

describe("transaction abort", () => {
	it("rolls back changes", async () => {
		const db = await openDB("test", 1, (db) => {
			db.createObjectStore("store");
		});

		// Put initial data
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction("store", "readwrite");
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
			const store = tx.objectStore("store");
			store.put("initial", "key");
		});

		// Start a new transaction, modify, then abort
		await new Promise<void>((resolve) => {
			const tx = db.transaction("store", "readwrite");
			const store = tx.objectStore("store");
			store.put("modified", "key");

			// Abort after the put is queued
			tx.onabort = () => resolve();
			tx.abort();
		});

		// Verify original data intact
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction("store", "readonly");
			const store = tx.objectStore("store");
			const req = store.get("key");
			req.onsuccess = () => {
				expect(req.result).toBe("initial");
				resolve();
			};
			req.onerror = () => reject(req.error);
		});
	});
});

describe("transaction scope", () => {
	it("throws for stores not in scope", async () => {
		const db = await openDB("test", 1, (db) => {
			db.createObjectStore("store1");
			db.createObjectStore("store2");
		});

		const tx = db.transaction("store1", "readonly");
		expect(() => tx.objectStore("store2")).toThrow();
	});

	it("supports multiple stores", async () => {
		const db = await openDB("test", 1, (db) => {
			db.createObjectStore("store1");
			db.createObjectStore("store2");
		});

		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(["store1", "store2"], "readwrite");
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);

			const store1 = tx.objectStore("store1");
			const store2 = tx.objectStore("store2");
			store1.put("a", 1);
			store2.put("b", 1);
		});
	});
});

describe("read-only transactions", () => {
	it("rejects writes", async () => {
		const db = await openDB("test", 1, (db) => {
			db.createObjectStore("store");
		});

		expect(() => {
			const tx = db.transaction("store", "readonly");
			const store = tx.objectStore("store");
			store.put("value", "key");
		}).toThrow();
	});
});

describe("versionchange transaction", () => {
	it("creates object stores during upgrade", async () => {
		const db = await openDB("test", 1, (db) => {
			db.createObjectStore("store1");
			db.createObjectStore("store2", {keyPath: "id"});
		});

		const names = db.objectStoreNames;
		expect(names).toContain("store1");
		expect(names).toContain("store2");
	});

	it("deletes object stores during upgrade", async () => {
		await openDB("test", 1, (db) => {
			db.createObjectStore("store1");
			db.createObjectStore("store2");
		});

		const db2 = await openDB("test", 2, (db) => {
			db.deleteObjectStore("store1");
		});

		const names = db2.objectStoreNames;
		expect(names).not.toContain("store1");
		expect(names).toContain("store2");
	});
});
