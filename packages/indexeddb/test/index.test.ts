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

describe("IDBIndex", () => {
	it("creates an index during upgrade", async () => {
		const db = await openDB("test", 1, (db) => {
			const store = db.createObjectStore("store", {keyPath: "id"});
			store.createIndex("byName", "name");
		});

		const tx = db.transaction("store", "readonly");
		const store = tx.objectStore("store");
		const index = store.index("byName");
		expect(index.name).toBe("byName");
		expect(index.keyPath).toBe("name");
		expect(index.unique).toBe(false);
	});

	it("creates a unique index", async () => {
		const db = await openDB("test", 1, (db) => {
			const store = db.createObjectStore("store", {keyPath: "id"});
			store.createIndex("byEmail", "email", {unique: true});
		});

		const tx = db.transaction("store", "readonly");
		const store = tx.objectStore("store");
		const index = store.index("byEmail");
		expect(index.unique).toBe(true);
	});

	it("retrieves records by index key", async () => {
		const db = await openDB("test", 1, (db) => {
			const store = db.createObjectStore("store", {keyPath: "id"});
			store.createIndex("byName", "name");
		});

		// Add data
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction("store", "readwrite");
			const store = tx.objectStore("store");
			store.put({id: 1, name: "Alice"});
			store.put({id: 2, name: "Bob"});
			store.put({id: 3, name: "Alice"});
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});

		// Query by index
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction("store", "readonly");
			const store = tx.objectStore("store");
			const index = store.index("byName");
			const req = index.get("Alice");
			req.onsuccess = () => {
				// Should return the first match
				expect(req.result).toBeDefined();
				expect(req.result.name).toBe("Alice");
				resolve();
			};
			req.onerror = () => reject(req.error);
		});
	});

	it("getAll on index", async () => {
		const db = await openDB("test", 1, (db) => {
			const store = db.createObjectStore("store", {keyPath: "id"});
			store.createIndex("byName", "name");
		});

		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction("store", "readwrite");
			const store = tx.objectStore("store");
			store.put({id: 1, name: "Alice"});
			store.put({id: 2, name: "Bob"});
			store.put({id: 3, name: "Alice"});
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});

		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction("store", "readonly");
			const store = tx.objectStore("store");
			const index = store.index("byName");
			const req = index.getAll("Alice");
			req.onsuccess = () => {
				expect(req.result.length).toBe(2);
				expect(req.result.every((r: any) => r.name === "Alice")).toBe(
					true,
				);
				resolve();
			};
			req.onerror = () => reject(req.error);
		});
	});

	it("count on index", async () => {
		const db = await openDB("test", 1, (db) => {
			const store = db.createObjectStore("store", {keyPath: "id"});
			store.createIndex("byName", "name");
		});

		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction("store", "readwrite");
			const store = tx.objectStore("store");
			store.put({id: 1, name: "Alice"});
			store.put({id: 2, name: "Bob"});
			store.put({id: 3, name: "Alice"});
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});

		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction("store", "readonly");
			const store = tx.objectStore("store");
			const index = store.index("byName");
			const req = index.count("Alice");
			req.onsuccess = () => {
				expect(req.result).toBe(2);
				resolve();
			};
			req.onerror = () => reject(req.error);
		});
	});

	it("throws for non-existent index", async () => {
		const db = await openDB("test", 1, (db) => {
			db.createObjectStore("store", {keyPath: "id"});
		});

		const tx = db.transaction("store", "readonly");
		const store = tx.objectStore("store");
		expect(() => store.index("nonexistent")).toThrow("not found");
	});
});
