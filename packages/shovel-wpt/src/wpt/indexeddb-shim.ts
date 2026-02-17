/**
 * WPT IndexedDB test shim
 *
 * Provides the globals needed to run actual WPT IndexedDB tests
 * with a custom IDBFactory/backend implementation.
 *
 * This injects the WPT support.js helpers (createdb, indexeddb_test, etc.)
 * and the IDB globals (indexedDB, IDBKeyRange, etc.) into globalThis.
 */

import {
	promise_test,
	test,
	async_test,
	setup,
	done,
	step_timeout,
	format_value,
	type TestContext,
} from "../harness/testharness.js";
import * as assertions from "../harness/assertions.js";

export interface IndexedDBShimConfig {
	/** A pre-constructed IDBFactory instance */
	indexedDB: any;
	/** IDB class constructors to expose as globals */
	classes: {
		IDBKeyRange: any;
		IDBDatabase?: any;
		IDBTransaction?: any;
		IDBObjectStore?: any;
		IDBRequest?: any;
		IDBOpenDBRequest?: any;
		IDBIndex?: any;
		IDBCursor?: any;
		IDBCursorWithValue?: any;
		IDBVersionChangeEvent?: any;
	};
	/** Optional file path for location uniqueness across test files */
	filePath?: string;
}

/**
 * Setup globals for WPT IndexedDB tests.
 *
 * Call this before loading WPT test files to inject the IDB implementation
 * and WPT helper functions (createdb, indexeddb_test, fail, etc.).
 */
export function setupIndexedDBTestGlobals(config: IndexedDBShimConfig): void {
	const {indexedDB} = config;
	const {
		IDBKeyRange,
		IDBDatabase,
		IDBTransaction,
		IDBObjectStore,
		IDBRequest,
		IDBOpenDBRequest,
		IDBIndex,
		IDBCursor,
		IDBCursorWithValue,
		IDBVersionChangeEvent,
	} = config.classes;

	// ---- WPT support.js helpers ----

	/**
	 * add_completion_callback — called after all tests finish.
	 * Used by support.js to clean up databases.
	 */
	const completionCallbacks: Array<(tests: any[]) => void> = [];
	function add_completion_callback(fn: (tests: any[]) => void): void {
		completionCallbacks.push(fn);
	}

	/**
	 * fail — returns a step function that always fails the test.
	 */
	function fail(t: TestContext, desc: string) {
		return t.step_func(function (e: any) {
			if (e && e.message && e.target?.error) {
				assertions.assert_unreached(
					`${desc} (${e.target.error.name}: ${e.message})`,
				);
			} else if (e && e.message) {
				assertions.assert_unreached(`${desc} (${e.message})`);
			} else if (e && e.target?.readyState === "done" && e.target?.error) {
				assertions.assert_unreached(`${desc} (${e.target.error.name})`);
			} else {
				assertions.assert_unreached(desc);
			}
		});
	}

	/**
	 * createdb_for_multiple_tests — opens a database with auto-fail handlers.
	 */
	function createdb_for_multiple_tests(dbname?: string, version?: number): any {
		const resolvedName = dbname ?? `testdb-${Date.now()}${Math.random()}`;
		const rq_open = version
			? indexedDB.open(resolvedName, version)
			: indexedDB.open(resolvedName);

		let currentTest: TestContext | null = null;

		function auto_fail(evt: string, test: TestContext): void {
			if (!rq_open.manually_handled) {
				rq_open.manually_handled = {};
			}

			rq_open.addEventListener(evt, () => {
				if (currentTest !== test) return;
				test.step(() => {
					if (!rq_open.manually_handled[evt]) {
						assertions.assert_unreached(`unexpected open.${evt} event`);
					}
				});
			});

			Object.defineProperty(rq_open, `on${evt}`, {
				configurable: true,
				set(h: any) {
					rq_open.manually_handled[evt] = true;
					if (!h) {
						rq_open.addEventListener(evt, () => {});
					} else {
						rq_open.addEventListener(evt, test.step_func(h));
					}
				},
			});
		}

		Object.defineProperty(rq_open, "setTest", {
			enumerable: false,
			value: function (t: TestContext) {
				currentTest = t;
				auto_fail("upgradeneeded", t);
				auto_fail("success", t);
				auto_fail("blocked", t);
				auto_fail("error", t);
				return rq_open;
			},
		});

		return rq_open;
	}

	/**
	 * createdb — convenience wrapper around createdb_for_multiple_tests.
	 */
	function createdb(t: TestContext, dbname?: string, version?: number): any {
		const rq_open = createdb_for_multiple_tests(dbname, version);
		return rq_open.setTest(t);
	}

	/**
	 * assert_key_equals — compare two IDB keys for equality.
	 */
	function assert_key_equals(
		actual: any,
		expected: any,
		description?: string,
	): void {
		assertions.assert_equals(indexedDB.cmp(actual, expected), 0, description);
	}

	/**
	 * indexeddb_test — convenience for creating and testing a database.
	 */
	function indexeddb_test(
		upgrade_func: (t: TestContext, db: any, tx: any, open: any) => void,
		open_func:
			| ((t: TestContext, db: any, open: any) => void)
			| null
			| undefined,
		description: string,
		options?: {upgrade_will_abort?: boolean},
	): void {
		async_test((t: TestContext) => {
			const opts = Object.assign({upgrade_will_abort: false}, options);
			const dbname = `idb-test-${Date.now()}-${Math.random()}`;
			const del = indexedDB.deleteDatabase(dbname);
			del.onerror = t.unreached_func("deleteDatabase should succeed");
			const open = indexedDB.open(dbname, 1);
			open.onupgradeneeded = t.step_func(() => {
				const db = open.result;
				t.add_cleanup(() => {
					open.onerror = (e: any) => e.preventDefault?.();
					db.close();
					indexedDB.deleteDatabase(db.name);
				});
				const tx = open.transaction;
				upgrade_func(t, db, tx, open);
			});
			if (opts.upgrade_will_abort) {
				open.onsuccess = t.unreached_func("open should not succeed");
			} else {
				open.onerror = t.unreached_func("open should succeed");
				open.onsuccess = t.step_func(() => {
					const db = open.result;
					if (open_func) {
						open_func(t, db, open);
					}
				});
			}
		}, description);
	}

	/**
	 * is_transaction_active — check if a transaction is still active.
	 */
	function is_transaction_active(tx: any, store_name: string): boolean {
		try {
			const request = tx.objectStore(store_name).get(0);
			request.onerror = (e: any) => {
				e.preventDefault?.();
				e.stopPropagation?.();
			};
			return true;
		} catch (ex: any) {
			assertions.assert_equals(
				ex.name,
				"TransactionInactiveError",
				"Active check should either not throw anything, or throw TransactionInactiveError",
			);
			return false;
		}
	}

	/**
	 * keep_alive — keep a transaction alive by spinning on requests.
	 */
	function keep_alive(tx: any, store_name: string): () => void {
		let completed = false;
		tx.addEventListener("complete", () => {
			completed = true;
		});

		let keepSpinning = true;

		function spin(): void {
			if (!keepSpinning) return;
			tx.objectStore(store_name).get(0).onsuccess = spin;
		}
		spin();

		return () => {
			assertions.assert_false(
				completed,
				"Transaction completed while kept alive",
			);
			keepSpinning = false;
		};
	}

	/**
	 * barrier_func — call func after count invocations.
	 */
	function barrier_func(count: number, func: () => void): () => void {
		let n = 0;
		return () => {
			if (++n === count) func();
		};
	}

	// Provide browser-like globals for WPT test infrastructure
	// Use filePath to make location unique per test file (prevents DB name collisions)
	const locPath = config.filePath ?? "shovel-wpt-test";
	const location = {
		toString: () => locPath,
		href: locPath,
		pathname: "/" + locPath,
	};
	const document = {
		title: "WPT IndexedDB",
		getElementsByTagName(_tag: string) {
			return {length: 0};
		},
		createElement(tag: string) {
			// Minimal stub for structured-clone tests (creates <input> for FileList)
			if (tag === "input") {
				return {
					type: "",
					files: {length: 0, [Symbol.iterator]: [][Symbol.iterator]},
				};
			}
			return {};
		},
	};

	/**
	 * EventWatcher — watches events on a target and returns promises.
	 * Used by support-promises.js (requestWatcher, transactionWatcher, etc.)
	 */
	class EventWatcher {
		#target: any;

		constructor(_testCase: TestContext, target: any, _events: string[]) {
			this.#target = target;
		}

		wait_for(type: string | string[]): Promise<Event> {
			if (Array.isArray(type)) {
				if (type.length === 0)
					return Promise.resolve(undefined as any as Event);
				// Set up the first listener synchronously so it's ready before
				// any already-queued microtasks fire events on the target.
				let chain = this.wait_for(type[0]);
				for (let i = 1; i < type.length; i++) {
					const t = type[i];
					chain = chain.then(() => this.wait_for(t));
				}
				return chain;
			}

			return new Promise<Event>((resolve) => {
				const handler = (e: Event) => {
					this.#target.removeEventListener(type, handler);
					resolve(e);
				};
				this.#target.addEventListener(type, handler);
			});
		}
	}

	/**
	 * WPT expect — returns a function; call it with results.
	 * When all expected results arrive, asserts order and completes the test.
	 * NOTE: bun:test also has a global `expect` — we override it here
	 * because WPT tests use this version. Our assertions.ts imports
	 * bun:test's expect via ES import so it's unaffected.
	 */
	function wpt_expect(
		t: TestContext,
		expected: unknown[],
	): (result: unknown) => void {
		const results: unknown[] = [];
		return (result: unknown) => {
			results.push(result);
			if (results.length === expected.length) {
				assertions.assert_array_equals(results, expected);
				t.done();
			}
		};
	}

	/**
	 * FileReader polyfill — Bun doesn't have FileReader but has Blob.arrayBuffer().
	 * Only implements readAsArrayBuffer/readAsText (what WPT tests use).
	 */
	class FileReaderPolyfill extends EventTarget {
		result: ArrayBuffer | string | null = null;
		error: DOMException | null = null;
		readyState = 0; // 0=EMPTY, 1=LOADING, 2=DONE
		onloadend: ((ev: Event) => void) | null = null;
		onload: ((ev: Event) => void) | null = null;
		onerror: ((ev: Event) => void) | null = null;

		readAsArrayBuffer(blob: Blob): void {
			this.#read(blob, "arraybuffer");
		}
		readAsText(blob: Blob, _encoding?: string): void {
			this.#read(blob, "text");
		}

		#read(blob: Blob, mode: "arraybuffer" | "text"): void {
			this.readyState = 1;
			(mode === "arraybuffer" ? blob.arrayBuffer() : blob.text())
				.then((data: ArrayBuffer | string) => {
					this.readyState = 2;
					this.result = data;
					const evt = new Event("load");
					this.onload?.(evt);
					this.dispatchEvent(evt);
					const endEvt = new Event("loadend");
					this.onloadend?.(endEvt);
					this.dispatchEvent(endEvt);
				})
				.catch((err) => {
					this.readyState = 2;
					this.error = new DOMException(String(err), "NotReadableError");
					const evt = new Event("error");
					this.onerror?.(evt);
					this.dispatchEvent(evt);
					const endEvt = new Event("loadend");
					this.onloadend?.(endEvt);
					this.dispatchEvent(endEvt);
				});
		}
	}

	/**
	 * subsetTest — WPT test variant support.
	 * In browsers, limits which tests run based on URL query params.
	 * We run all tests, so just call the test function directly.
	 */
	function subsetTest(
		testFunc: (...args: any[]) => void,
		...args: any[]
	): void {
		testFunc(...args);
	}

	// Stub browser-only geometry/image types for structured-clone tests.
	// These are just enough to be constructable; the values won't survive
	// v8 serialize round-trip but the test handles that via cloneFailureTest.
	class DOMMatrixStub {
		constructor() {
			return Object.create(DOMMatrixStub.prototype);
		}
	}
	class DOMMatrixReadOnlyStub extends DOMMatrixStub {}
	class DOMPointStub {
		x = 0;
		y = 0;
		z = 0;
		w = 1;
		constructor(x?: number, y?: number, z?: number, w?: number) {
			if (x !== undefined) this.x = x;
			if (y !== undefined) this.y = y;
			if (z !== undefined) this.z = z;
			if (w !== undefined) this.w = w;
		}
	}
	class DOMPointReadOnlyStub extends DOMPointStub {}
	class DOMRectStub {
		x = 0;
		y = 0;
		width = 0;
		height = 0;
		constructor(x?: number, y?: number, w?: number, h?: number) {
			if (x !== undefined) this.x = x;
			if (y !== undefined) this.y = y;
			if (w !== undefined) this.width = w;
			if (h !== undefined) this.height = h;
		}
	}
	class DOMRectReadOnlyStub extends DOMRectStub {}
	class DOMQuadStub {
		constructor() {
			return Object.create(DOMQuadStub.prototype);
		}
	}
	class ImageDataStub {
		data: Uint8ClampedArray;
		width: number;
		height: number;
		constructor(w: number, h: number) {
			this.width = w;
			this.height = h;
			this.data = new Uint8ClampedArray(w * h * 4);
		}
	}

	// Inject globals
	Object.assign(globalThis, {
		FileReader: FileReaderPolyfill,
		subsetTest,
		// DOM geometry/image stubs for structured-clone tests
		...(typeof DOMMatrix === "undefined" ? {DOMMatrix: DOMMatrixStub} : {}),
		...(typeof DOMMatrixReadOnly === "undefined"
			? {DOMMatrixReadOnly: DOMMatrixReadOnlyStub}
			: {}),
		...(typeof DOMPoint === "undefined" ? {DOMPoint: DOMPointStub} : {}),
		...(typeof DOMPointReadOnly === "undefined"
			? {DOMPointReadOnly: DOMPointReadOnlyStub}
			: {}),
		...(typeof DOMRect === "undefined" ? {DOMRect: DOMRectStub} : {}),
		...(typeof DOMRectReadOnly === "undefined"
			? {DOMRectReadOnly: DOMRectReadOnlyStub}
			: {}),
		...(typeof DOMQuad === "undefined" ? {DOMQuad: DOMQuadStub} : {}),
		...(typeof ImageData === "undefined" ? {ImageData: ImageDataStub} : {}),
		// Core harness
		promise_test,
		test,
		async_test,
		setup,
		done,
		step_timeout,
		format_value,
		...assertions,
		// Override bun:test's expect with WPT's expect
		expect: wpt_expect,

		// IDB globals
		indexedDB,
		IDBKeyRange,
		IDBDatabase,
		IDBTransaction,
		IDBObjectStore,
		IDBRequest,
		IDBOpenDBRequest,
		IDBIndex,
		IDBCursor,
		IDBCursorWithValue,
		IDBVersionChangeEvent,

		// WPT harness infrastructure
		EventWatcher,

		// WPT support.js helpers (fallbacks if support.js isn't loaded via META)
		createdb,
		createdb_for_multiple_tests,
		indexeddb_test,
		fail,
		assert_key_equals,
		is_transaction_active,
		keep_alive,
		barrier_func,
		add_completion_callback,
		location,
		document,
	});

	// Also set on self for browser-compat patterns (support.js uses self.indexedDB)
	if (typeof self !== "undefined") {
		Object.assign(self, {
			indexedDB,
			IDBKeyRange,
			IDBDatabase,
			IDBTransaction,
			IDBObjectStore,
			IDBRequest,
			IDBOpenDBRequest,
			IDBIndex,
			IDBCursor,
			IDBCursorWithValue,
			IDBVersionChangeEvent,
			location,
			title: "WPT IndexedDB",
		});
		// Stub self.postMessage for WPT tests that use it to detach ArrayBuffers
		if (!(self as any).postMessage) {
			(self as any).postMessage = (_msg: any, _opts: any) => {
				// No-op; just for compatibility with tests that check cloneability
			};
		}
	}
}
