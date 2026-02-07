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

describe("IDBObjectStore.openCursor", () => {
	it("iterates all records", async () => {
		const db = await openDB("test", 1, (db) => {
			db.createObjectStore("store");
		});

		// Populate
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction("store", "readwrite");
			const store = tx.objectStore("store");
			store.put("a", 1);
			store.put("b", 2);
			store.put("c", 3);
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});

		// Iterate
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
		expect(results[1]).toEqual({key: 2, value: "b"});
		expect(results[2]).toEqual({key: 3, value: "c"});
	});

	it("returns null for empty store", async () => {
		const db = await openDB("test", 1, (db) => {
			db.createObjectStore("store");
		});

		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction("store", "readonly");
			const store = tx.objectStore("store");
			const req = store.openCursor();
			req.onsuccess = () => {
				expect(req.result).toBeNull();
				resolve();
			};
			req.onerror = () => reject(req.error);
		});
	});

	it("cursor with key range", async () => {
		const db = await openDB("test", 1, (db) => {
			db.createObjectStore("store");
		});

		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction("store", "readwrite");
			const store = tx.objectStore("store");
			for (let i = 1; i <= 5; i++) {
				store.put(`val${i}`, i);
			}
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});

		const {IDBKeyRange} = await import("../src/key-range.js");
		const results: number[] = [];

		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction("store", "readonly");
			const store = tx.objectStore("store");
			const range = IDBKeyRange.bound(2, 4);
			const req = store.openCursor(range);
			req.onsuccess = () => {
				const cursor = req.result;
				if (cursor) {
					results.push(cursor.key as number);
					cursor.continue();
				} else {
					resolve();
				}
			};
			req.onerror = () => reject(req.error);
		});

		expect(results).toEqual([2, 3, 4]);
	});
});

describe("IDBObjectStore.openKeyCursor", () => {
	it("iterates keys only", async () => {
		const db = await openDB("test", 1, (db) => {
			db.createObjectStore("store");
		});

		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction("store", "readwrite");
			const store = tx.objectStore("store");
			store.put("a", 1);
			store.put("b", 2);
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});

		const keys: any[] = [];
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction("store", "readonly");
			const store = tx.objectStore("store");
			const req = store.openKeyCursor();
			req.onsuccess = () => {
				const cursor = req.result;
				if (cursor) {
					keys.push(cursor.key);
					cursor.continue();
				} else {
					resolve();
				}
			};
			req.onerror = () => reject(req.error);
		});

		expect(keys).toEqual([1, 2]);
	});
});
