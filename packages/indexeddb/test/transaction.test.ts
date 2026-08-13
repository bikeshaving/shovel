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
		const db1 = await openDB("test", 1, (db) => {
			db.createObjectStore("store1");
			db.createObjectStore("store2");
		});
		db1.close();

		const db2 = await openDB("test", 2, (db) => {
			db.deleteObjectStore("store1");
		});

		const names = db2.objectStoreNames;
		expect(names).not.toContain("store1");
		expect(names).toContain("store2");
	});
});

describe("commit conformance (regression)", () => {
	it("rejects new requests after commit() — even during a pending request's handler", async () => {
		const db = await openDB("commit-active", 1, (db) => {
			db.createObjectStore("s");
		});
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction("s", "readwrite");
			const store = tx.objectStore("s");
			const req = store.put(1, "a");
			// Commit while a request is still pending. The transaction is now
			// "committing"; the pending request's success handler must not be
			// able to enqueue further work.
			tx.commit();
			req.onsuccess = () => {
				let threw: string | null = null;
				try {
					store.put(2, "b");
				} catch (e) {
					threw = (e as DOMException).name;
				}
				expect(threw).toBe("TransactionInactiveError");
			};
			tx.oncomplete = () => resolve();
			tx.onabort = () => reject(new Error("unexpected abort"));
			tx.onerror = () => reject(new Error("unexpected error"));
		});
	});

	it("a failed commit aborts the transaction (fires abort, not error)", async () => {
		// Backend that delegates to MemoryBackend but fails the next commit.
		let failNextCommit = false;
		const bind = (obj: any, prop: PropertyKey) => {
			const v = Reflect.get(obj, prop, obj);
			return typeof v === "function" ? v.bind(obj) : v;
		};
		const base = new MemoryBackend();
		const backend = new Proxy(base, {
			get(target, prop) {
				if (prop !== "open") return bind(target, prop);
				return async (name: string, version: number) => {
					const conn = await (target as any).open(name, version);
					return new Proxy(conn, {
						get(c, p) {
							if (p !== "beginTransaction") return bind(c, p);
							return (stores: string[], mode: string) => {
								const tx = (c as any).beginTransaction(stores, mode);
								return new Proxy(tx, {
									get(t, tp) {
										if (tp !== "commit") return bind(t, tp);
										return () => {
											if (failNextCommit) {
												failNextCommit = false;
												throw new DOMException("commit failed", "UnknownError");
											}
											return (t as any).commit();
										};
									},
								});
							};
						},
					});
				};
			},
		});

		const f = new IDBFactory(backend as any);
		const db = await new Promise<any>((res, rej) => {
			const r = f.open("commit-fail", 1);
			r.onupgradeneeded = () => r.result.createObjectStore("s");
			r.onsuccess = () => res(r.result);
			r.onerror = () => rej(r.error);
		});

		failNextCommit = true;
		const events: string[] = [];
		const tx = db.transaction("s", "readwrite");
		tx.objectStore("s").put(1, "k");
		await new Promise<void>((resolve) => {
			tx.oncomplete = () => {
				events.push("complete");
				resolve();
			};
			tx.onerror = () => {
				events.push("error");
				resolve();
			};
			tx.onabort = () => {
				events.push("abort");
				resolve();
			};
		});
		expect(events).toEqual(["abort"]);
		expect(tx.error).toBeInstanceOf(DOMException);
	});
});
