/**
 * WPT IndexedDB tests against SQLiteBackend.
 *
 * Same harness as indexeddb-wpt.test.ts but uses SQLiteBackend.
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
import {flushTests, clearTestQueue, filterTestQueue} from "../src/harness/testharness.js";
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
	"blob-contenttype",
	"idlharness",
	"bindings-inject",
	"storage-buckets",
];

const skipTests: Record<string, string[]> = {
	"transaction-deactivation-timing.any.js": ["end of invocation"],
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
const wptFilter = process.env.WPT_FILTER;
if (wptFilter) {
	wptFiles = wptFiles.filter((f) => f.includes(wptFilter));
}

const tempDirs: string[] = [];
let dbCounter = 0;
function makeSqliteFactory(): IDBFactory {
	const dir = join(tmpdir(), `idb-wpt-sqlite-${process.pid}-${Date.now()}-${dbCounter++}`);
	mkdirSync(dir, {recursive: true});
	tempDirs.push(dir);
	return new IDBFactory(new SQLiteBackend(dir));
}

afterAll(() => {
	for (const dir of tempDirs) {
		try { rmSync(dir, {recursive: true, force: true}); } catch {}
	}
});

const sharedFactory = makeSqliteFactory();

const needsFreshFactory = new Set([
	"get-databases.any.js",
	"open-request-queue.any.js",
]);

for (const file of wptFiles) {
	const factory = needsFreshFactory.has(file)
		? makeSqliteFactory()
		: sharedFactory;
	setupIndexedDBTestGlobals({
		indexedDB: factory,
		classes: idbClasses,
		filePath: file,
	});

	loadedScripts.clear();
	clearTestQueue();

	try {
		loadMetaScripts(join(wptDir, file));

		let testCode = readFileSync(join(wptDir, file), "utf8");
		testCode = testCode.replace(/^'use strict';?\s*$/m, "");
		testCode = testCode.replace(/^(const|let) /gm, "var ");
		(0, eval)(`(function() {\n${testCode}\n})();`);

		if (skipTests[file]) {
			filterTestQueue(skipTests[file]);
		}

		const needsVeryLongTimeout =
			file === "blob-composite-blob-reads.any.js";
		const needsLongTimeout =
			file === "interleaved-cursors-large.any.js" ||
			file === "interleaved-cursors-small.any.js" ||
			file === "open-request-queue.any.js" ||
			file === "transaction-scheduling-across-databases.any.js" ||
			file === "upgrade-transaction-deactivation-timing.any.js";
		const timeout = needsVeryLongTimeout ? 120000 : needsLongTimeout ? 30000 : 5000;
		flushTests(`SQLite WPT: ${file.replace(".any.js", "")}`, {
			timeout,
			...(needsFreshFactory.has(file) ? {indexedDB: factory} : {}),
		});
	} catch (e) {
		bunTest(`SQLite WPT: ${file} (load error)`, () => {
			throw e;
		});
		clearTestQueue();
	}
}
