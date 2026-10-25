/**
 * WPT IndexedDB tests against SQLiteBackend.
 *
 * Each WPT file is eval'd inside its own bun:test callback, so only one
 * file's async work runs at a time — no thundering herd.
 */

import {setupIndexedDBTestGlobals} from "../src/wpt/indexeddb-shim.js";
import {
	IDBFactory,
	IDBDatabase,
	IDBTransaction,
	IDBObjectStore,
	IDBRequest,
	IDBOpenDBRequest,
	IDBKeyRange,
	IDBIndex,
	IDBCursor,
	IDBCursorWithValue,
	IDBVersionChangeEvent,
} from "../../indexeddb/src/index.js";
import {SQLiteBackend} from "../../indexeddb/src/sqlite.js";
import {
	clearTestQueue,
	filterTestQueue,
	takeTestQueue,
	createTestContext,
} from "../src/harness/testharness.js";
import {test as bunTest, afterAll} from "bun:test";
import {join} from "node:path";
import {readdirSync, readFileSync, mkdirSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";

const idbClasses = {
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
};

const wptDir = join(import.meta.dir, "../wpt/IndexedDB");

const loadedScripts = new Set<string>();

function loadWptScript(filePath: string): void {
	if (loadedScripts.has(filePath)) return;
	loadedScripts.add(filePath);

	let code = readFileSync(filePath, "utf8");
	code = code.replace(/^'use strict';?\s*$/m, "");
	code = code.replace(/^(const|let) /gm, "var ");

	const lines = code.split("\n");
	for (const line of lines) {
		const match = line.match(/^\/\/ META: script=(.+)$/);
		if (match) {
			const scriptPath = match[1].trim();
			if (!scriptPath.startsWith("/")) {
				const dir = filePath.substring(0, filePath.lastIndexOf("/"));
				loadWptScript(join(dir, scriptPath));
			}
		}
	}

	(0, eval)(code);
}

function loadMetaScripts(testFilePath: string): void {
	const content = readFileSync(testFilePath, "utf8");
	const lines = content.split("\n");

	for (const line of lines) {
		const match = line.match(/^\/\/ META: script=(.+)$/);
		if (match) {
			const scriptPath = match[1].trim();
			if (!scriptPath.startsWith("/")) {
				loadWptScript(join(wptDir, scriptPath));
			}
		}
		if (
			line.trim() &&
			!line.startsWith("//") &&
			!line.startsWith("'use strict'")
		) {
			break;
		}
	}
}

const skip = [
	"blob-contenttype", // Blob/File storage not implemented
	"idlharness", // Tests WebIDL interface shape, not behavior
	"bindings-inject", // Tests browser binding injection mechanism
	"storage-buckets", // Storage Buckets API not implemented
];

const skipTests: Record<string, string[]> = {
	// Requires browser-engine-level microtask draining between event listeners
	"transaction-deactivation-timing.any.js": ["end of invocation"],
	// Structured clone stubs — these types don't exist server-side
	"structured-clone.any.js": [
		"DOMMatrixStub",
		"DOMMatrixStub",
		"DOMPointStub",
		"DOMPointReadOnlyStub",
		"DOMRectStub",
		"DOMRectReadOnlyStub",
		"ImageDataStub",
	],
};

let wptFiles = readdirSync(wptDir)
	.filter((f) => f.endsWith(".any.js"))
	.filter((f) => !skip.some((s) => f.includes(s)))
	.sort();

// Support WPT_FILTER=pattern to run only matching files
const wptFilter = import.meta.env.WPT_FILTER;
if (wptFilter) {
	wptFiles = wptFiles.filter((f) => f.includes(wptFilter));
}

const tempDirs: string[] = [];
let dbCounter = 0;
function makeSqliteFactory(): IDBFactory {
	const dir = join(
		tmpdir(),
		`idb-wpt-sqlite-${process.pid}-${Date.now()}-${dbCounter++}`,
	);
	mkdirSync(dir, {recursive: true});
	tempDirs.push(dir);
	return new IDBFactory(new SQLiteBackend(dir));
}

afterAll(() => {
	for (const dir of tempDirs) {
		try {
			rmSync(dir, {recursive: true, force: true});
		} catch (_) {
			// Ignore cleanup errors
		}
	}
});

for (const file of wptFiles) {
	bunTest(
		`SQLite WPT: ${file.replace(".any.js", "")}`,
		async () => {
			// Each file gets its own factory — matches browser semantics where
			// each test page has its own origin/database namespace.
			const factory = makeSqliteFactory();
			setupIndexedDBTestGlobals({
				indexedDB: factory,
				classes: idbClasses,
				filePath: file,
			});

			loadedScripts.clear();
			clearTestQueue();

			loadMetaScripts(join(wptDir, file));

			let testCode = readFileSync(join(wptDir, file), "utf8");
			testCode = testCode.replace(/^'use strict';?\s*$/m, "");
			testCode = testCode.replace(/^(const|let) /gm, "var ");
			(0, eval)(`(function() {\n${testCode}\n})();`);

			if (skipTests[file]) {
				filterTestQueue(skipTests[file]);
			}

			const tests = takeTestQueue();

			// Run sub-tests sequentially — WPT promise_tests run one at a time.
			// Respect META: timeout=long (WPT convention for heavyweight tests).
			const isLong = testCode.includes("META: timeout=long");
			const subTestTimeout = isLong ? 15_000 : 5_000;
			const failures: string[] = [];
			for (const t of tests) {
				const ctx = createTestContext(t.name);
				try {
					const work = t.isAsync
						? (t.fn(ctx) as Promise<void>)
						: Promise.resolve(t.fn(ctx));
					await new Promise<void>((resolve, reject) => {
						const id = setTimeout(
							() => reject(new Error("sub-test timed out")),
							subTestTimeout,
						);
						work.then(
							() => {
								clearTimeout(id);
								resolve();
							},
							(e) => {
								clearTimeout(id);
								reject(e);
							},
						);
					});
				} catch (e: any) {
					failures.push(`${t.name}: ${e?.message ?? e}`);
				} finally {
					// Run cleanups in reverse order (close DBs, delete databases, etc.)
					for (const cleanup of ((ctx as any)._cleanups ?? []).reverse()) {
						try {
							await cleanup();
						} catch (_) {
							// Ignore cleanup errors
						}
					}
				}
			}

			if (failures.length > 0) {
				throw new Error(
					`${failures.length}/${tests.length} sub-tests failed:\n${failures.join("\n")}`,
				);
			}
		},
		{timeout: 30_000},
	);
}
